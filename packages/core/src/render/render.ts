import type { Block } from "../state/block";
import type { BlockId } from "../state/block-id";
import type { State } from "../state/state";
import { getBlock, getEmbedContent, getEmbedContentIds } from "../state/state";
import type { ReadonlyAttrs } from "../state/attrs";
import type { InlineContent } from "../state/inline-content";
import type { Style, ComputedStyle } from "../styles";
import { INITIAL_COMPUTED_STYLE } from "../styles/property-meta";
import { composeComputed } from "../cascade/compose";
import { flattenLengths } from "../cascade/flatten-lengths";
import type { AttrRegistry } from "../cascade/attr-registry";
import type { ComponentRegistry } from "../components/component-registry";
import type {
  BlockView,
  ContainerBlockView,
  LeafBlockView,
  RenderContext,
} from "./block-view";
import type { RenderNode } from "./render-node";
import { createTextBox, createElementBox } from "./render-node";

/**
 * Output of the new renderer. `root` is the main document's RenderNode tree;
 * `embedContents` (populated by T8) carries footnote bodies etc. as a
 * parallel map keyed by BlockId, consumed by pagination.
 */
export interface RenderOutput {
  readonly root: RenderNode;
  readonly embedContents: ReadonlyMap<BlockId, RenderNode>;
}

/**
 * Render a Y.Doc-backed State to a RenderNode tree.
 *
 * Decision B: push-model walker. For each block:
 *   1. Compose its computedStyle: attrRegistry.applyAll(attrs, ctx) →
 *      compose with parent + initial → flattenLengths against own fontSize.
 *      The `ctx.parentStyle` field carries the parent block's specified
 *      style so context-sensitive interpreters (e.g., explicit inheritance
 *      flags) can consult it.
 *   2. Build a BlockView (container or leaf) with computedStyle attached.
 *   3. Dispatch to the registered component for that type.
 *   4. Recurse into children (containers) or expand inline items (leaves)
 *      BEFORE invoking the component — components receive pre-rendered
 *      children / inline RenderNodes.
 *
 * Note: `RenderNode.computedStyle` is intentionally NOT pre-filled on
 * inline TextBoxes / ElementBoxes here. The downstream `cascadePass`
 * (called by `layout/dispatch.ts` and `layout/layout-incremental.ts`)
 * owns that field across the full tree. Pre-filling here would create
 * a fresh RenderNode identity per render (defeating reference-equality
 * caching) and would be unconditionally overwritten anyway.
 *
 * Decisions F + G: both registries are constructor-injected (no module-
 * level singletons consulted here).
 */
export function render(
  state: State,
  componentRegistry: ComponentRegistry,
  attrRegistry: AttrRegistry,
): RenderOutput {
  // P7 stubs RenderContext.getView / getEmbedContent. P10+ will wire them
  // through a per-block view cache. Throwing rather than returning
  // undefined surfaces accidental P7 callers immediately.
  const context: RenderContext = {
    state,
    getView: (_id: BlockId): BlockView => {
      throw new Error("RenderContext.getView not yet wired — populated in P10");
    },
    getEmbedContent: (_id: BlockId): BlockView => {
      throw new Error("RenderContext.getEmbedContent not yet wired — populated in P10");
    },
  };
  const visited = new Set<BlockId>();
  const rootBlock = getBlock(state, state.rootId);
  if (rootBlock === null) {
    throw new Error(`render: root block "${state.rootId}" not found`);
  }
  const root = renderBlock(
    rootBlock,
    null,
    undefined,
    state,
    componentRegistry,
    attrRegistry,
    context,
    visited,
  );
  const embedContents = new Map<BlockId, RenderNode>();
  for (const id of getEmbedContentIds(state)) {
    const block = getEmbedContent(state, id);
    if (block === null) continue; // shouldn't happen since we just enumerated the map
    // Each embed-content block renders as a fresh subtree with no parent
    // computed style (uses initial). Independent cascade context.
    //
    // The `visited` set is RESET per embed-content subtree: each is a
    // self-contained walk over its own descendants; sharing `visited`
    // across the main-tree walk and embed-content walks would prevent
    // legitimate re-entry into a body (e.g., the same id-namespace doesn't
    // imply cycles when the two trees are independent).
    const visitedEmbed = new Set<BlockId>();
    embedContents.set(
      id,
      renderBlock(
        block,
        null,
        undefined,
        state,
        componentRegistry,
        attrRegistry,
        context,
        visitedEmbed,
      ),
    );
  }
  return Object.freeze({ root, embedContents });
}

/**
 * Render a single block. Recursively renders children (containers) or
 * expands inline items (leaves) before dispatching to the component.
 *
 * **`visited` is an ACTIVE-PATH set, drained via `try/finally`.** Re-entry
 * of an id currently on the recursion stack throws (real cycle). An id
 * already drained (i.e., its subtree has finished rendering) does NOT
 * throw on subsequent encounter. The current state-module data model
 * forbids DAG topologies (a `Block` has exactly one `parentId`), so the
 * drain is a defense-in-depth measure that costs one `delete` per block
 * and protects against any future transclusion / shared-subtree work.
 *
 * **`parentSpecified`** is the parent block's translated declarable
 * style (the `Partial<Style>` that `AttrRegistry.applyAll` produced for
 * the parent). Threaded into `composeBlockStyle` so child interpreters
 * that consult `CascadeContext.parentStyle` see the right value. Root
 * call passes `undefined`. Also threaded into `expandInlineItems` so
 * inline interpreters see the containing block's specified style as
 * parent context.
 *
 * **Leaf dispatch (A5):** `def.leafShape === "atomic"` receives `[]`
 * directly — `expandInlineItems` is bypassed so the strut sentinel
 * cannot leak to atomic components. Inline-bearing leaves call
 * `expandInlineItems` as normal.
 */
function renderBlock(
  block: Block,
  parentComputed: ComputedStyle | null,
  parentSpecified: Partial<Style> | undefined,
  state: State,
  componentRegistry: ComponentRegistry,
  attrRegistry: AttrRegistry,
  context: RenderContext,
  visited: Set<BlockId>,
): RenderNode {
  if (visited.has(block.id)) {
    throw new Error(`render: cycle detected at block "${block.id}"`);
  }
  visited.add(block.id);
  try {
    const { specified, computed } = composeBlockStyle(
      block.attrs,
      parentComputed,
      parentSpecified,
      attrRegistry,
    );

    const def = componentRegistry.get(block.type);
    if (def === undefined) {
      throw new Error(`render: no component registered for block type "${block.type}"`);
    }

    if (def.kind === "container") {
      const view: ContainerBlockView = Object.freeze({
        id: block.id,
        type: block.type,
        attrs: block.attrs,
        computedStyle: computed,
        kind: "container" as const,
      });
      const childRenderNodes: RenderNode[] = [];
      let childId = block.firstChildId;
      while (childId !== null) {
        const child = getBlock(state, childId);
        if (child === null) {
          throw new Error(`render: child "${childId}" of "${block.id}" not found`);
        }
        childRenderNodes.push(
          renderBlock(
            child,
            computed,
            specified,
            state,
            componentRegistry,
            attrRegistry,
            context,
            visited,
          ),
        );
        childId = child.nextSiblingId;
      }
      return def.render(view, context, childRenderNodes);
    }

    // Leaf: build LeafBlockView, expand inline items (only for
    // inline-bearing leaves), dispatch.
    const inline: InlineContent = block.inlineContent ?? { items: [] };
    const view: LeafBlockView = Object.freeze({
      id: block.id,
      type: block.type,
      attrs: block.attrs,
      computedStyle: computed,
      kind: "leaf" as const,
      inlineContent: inline,
    });
    // A5: atomic-leaf components (image, horizontal-line, …) MUST NOT
    // receive a strut sentinel. The convention used to be "atomic
    // components ignore inlineRenderNodes by reading attrs instead"; we
    // now enforce it at the dispatch site so third-party atomic
    // components can't accidentally consume the sentinel.
    const inlineRenderNodes: ReadonlyArray<RenderNode> = def.leafShape === "atomic"
      ? []
      : expandInlineItems(block.id, inline, specified, attrRegistry);
    return def.render(view, context, inlineRenderNodes);
  } finally {
    // A2: visited tracks the ACTIVE recursion path, not the cumulative
    // set of visited blocks. Draining on every exit (including throws)
    // means the same id appearing in two disjoint subtrees is fine, and
    // a real cycle still fires the throw because the id is still on the
    // active path when we re-encounter it.
    visited.delete(block.id);
  }
}

/**
 * Compose computedStyle for a block: run the injected interpreters over
 * the block's attrs, compose against parent + initial, then flatten ems
 * against own fontSize. The full canonical cascade pipeline — matches
 * what cascadePass does for the legacy renderer's tree.
 *
 * Returns BOTH the intermediate `specified` (the Partial<Style> emitted
 * by `attrRegistry.applyAll`) and the final `computed` style. Callers
 * thread `specified` to child blocks via `CascadeContext.parentStyle`
 * so context-sensitive interpreters can consult parent declarations
 * without needing a separate cascade pass.
 */
function composeBlockStyle(
  attrs: ReadonlyAttrs,
  parentComputed: ComputedStyle | null,
  parentSpecified: Partial<Style> | undefined,
  attrRegistry: AttrRegistry,
): { specified: Partial<Style>; computed: ComputedStyle } {
  const specified: Partial<Style> = attrRegistry.applyAll(attrs, {
    parentStyle: parentSpecified,
  });
  const base = parentComputed ?? INITIAL_COMPUTED_STYLE;
  const composed = composeComputed(specified, base);
  return { specified, computed: flattenLengths(composed) };
}

/**
 * Expand inline content items into RenderNodes. Per master spec § text/span
 * removal: no `text` or `span` component dispatch — the renderer directly
 * emits TextBoxes for TextItems and ElementBoxes for EmbedItems.
 *
 * Keys are scoped under the leaf block id (`${blockId}/inline/${i}`) so
 * they're stable across re-renders of the same block but won't collide
 * with sibling-block keys (each block's keys live under its own id
 * prefix).
 *
 * `computedStyle` is intentionally NOT attached here. The downstream
 * `cascadePass` populates it for every RenderNode in the tree; pre-filling
 * would just be overwritten and would create new identities per render.
 *
 * Inline interpreters receive `{ parentStyle: blockSpecified }` so any
 * inline-attr interpreter that consults parent context (e.g., explicit
 * inheritance flags) sees the block's declared style as parent.
 */
function expandInlineItems(
  blockId: BlockId,
  content: InlineContent,
  blockSpecified: Partial<Style>,
  attrRegistry: AttrRegistry,
): RenderNode[] {
  const out: RenderNode[] = [];
  let i = 0;
  for (const item of content.items) {
    const itemStyle: Partial<Style> = attrRegistry.applyAll(item.attrs, {
      parentStyle: blockSpecified,
    });
    const key = `${blockId}/inline/${i}`;
    if (item.kind === "text") {
      // InlineItem narrows to TextItem here via the discriminated union.
      out.push(createTextBox(key, itemStyle, item.text));
    } else {
      // InlineItem narrows to EmbedItem here.
      //
      // Embeds are emitted as `display: inline-block` so the IFC's
      // token stream represents the state-model 1-unit cursor
      // contribution (per `state/block-position.ts`). With default
      // `display: inline`, an embed with no children produces no
      // tokens and the IFC's per-line offset accumulator drifts from
      // the state-model offset by 1 per embed. As `inline-block`
      // (width = intrinsic content size, typically 0 for atomic
      // embeds), the IFC emits exactly one atomic token contributing
      // 1 to the offset cursor and an `InlineBlockBox` of width 0
      // in the line — invisible visually, correct for cursor /
      // hit-test offset math.
      // Defaults FIRST so attr-interpreter-supplied values in
      // `itemStyle` (a visible embed with its own `inlineSize` /
      // alternative `display`) override the atomic-anchor fallbacks.
      const embedStyle: Partial<Style> = {
        display: "inline-block",
        // Default inline-block intrinsic sizing applies a 100px
        // fallback for empty content (per ifc.ts `inlineSizePx > 0 ?
        // inlineSizePx : 100`). Atomic embed anchors have no content
        // to size against, so default width to 0 — the embed is an
        // invisible cursor-position marker, not a visual element.
        // A visible embed component overrides this via its attr
        // interpreter.
        inlineSize: 0,
        ...itemStyle,
      };
      out.push(
        createElementBox(key, embedStyle, [], {
          embedType: item.embedType,
          ...item.properties,
        }),
      );
    }
    i++;
  }

  // Empty-paragraph strut sentinel: when an inline-bearing leaf block has
  // no inline items (e.g. an empty paragraph after the user pressed
  // Enter), the layout pipeline keys IFC dispatch off the presence of
  // inline children. To ensure the IFC is invoked — so its zero-tokens
  // path emits the strut LineBox carrying one line-height of vertical
  // space (browser-faithful empty-<p> behavior) — we emit a single empty
  // TextBox here. Its empty text produces zero tokens
  // (collectInlineTokens short-circuits on empty text), so the only
  // effect is triggering IFC dispatch. Atomic-leaf components (image,
  // horizontal-line) bypass this function entirely (see renderBlock's
  // leafShape === "atomic" branch), so they never see the sentinel.
  if (out.length === 0) {
    out.push(createTextBox(`${blockId}/inline/0`, {}, ""));
  }

  return out;
}
