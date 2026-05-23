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
 *   1. Compose its computedStyle: attrRegistry.applyAll(attrs) → compose
 *      with parent + initial → flattenLengths against own fontSize.
 *   2. Build a BlockView (container or leaf) with computedStyle attached.
 *   3. Dispatch to the registered component for that type.
 *   4. Recurse into children (containers) or expand inline items (leaves)
 *      BEFORE invoking the component — components receive pre-rendered
 *      children / inline RenderNodes.
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
  const root = renderBlock(rootBlock, null, state, componentRegistry, attrRegistry, context, visited);
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
      renderBlock(block, null, state, componentRegistry, attrRegistry, context, visitedEmbed),
    );
  }
  return Object.freeze({ root, embedContents });
}

function renderBlock(
  block: Block,
  parentComputed: ComputedStyle | null,
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

  const computed = composeBlockStyle(block.attrs, parentComputed, attrRegistry);

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
        renderBlock(child, computed, state, componentRegistry, attrRegistry, context, visited),
      );
      childId = child.nextSiblingId;
    }
    return def.render(view, context, childRenderNodes);
  }

  // Leaf: build LeafBlockView, expand inline items, dispatch.
  const inline: InlineContent = block.inlineContent ?? { items: [] };
  const view: LeafBlockView = Object.freeze({
    id: block.id,
    type: block.type,
    attrs: block.attrs,
    computedStyle: computed,
    kind: "leaf" as const,
    inlineContent: inline,
  });
  const inlineRenderNodes = expandInlineItems(block.id, inline, computed, attrRegistry);
  return def.render(view, context, inlineRenderNodes);
}

/**
 * Compose computedStyle for a block: run the injected interpreters over
 * the block's attrs, compose against parent + initial, then flatten ems
 * against own fontSize. The full canonical cascade pipeline — matches
 * what cascadePass does for the legacy renderer's tree.
 */
function composeBlockStyle(
  attrs: ReadonlyAttrs,
  parentComputed: ComputedStyle | null,
  attrRegistry: AttrRegistry,
): ComputedStyle {
  const specified: Partial<Style> = attrRegistry.applyAll(attrs);
  const base = parentComputed ?? INITIAL_COMPUTED_STYLE;
  const composed = composeComputed(specified, base);
  return flattenLengths(composed);
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
 */
function expandInlineItems(
  blockId: BlockId,
  content: InlineContent,
  blockComputed: ComputedStyle,
  attrRegistry: AttrRegistry,
): RenderNode[] {
  const out: RenderNode[] = [];
  let i = 0;
  for (const item of content.items) {
    const itemStyle: Partial<Style> = attrRegistry.applyAll(item.attrs);
    const itemComputed = flattenLengths(composeComputed(itemStyle, blockComputed));
    const key = `${blockId}/inline/${i}`;
    if (item.kind === "text") {
      // InlineItem narrows to TextItem here via the discriminated union.
      out.push(
        Object.freeze({
          ...createTextBox(key, itemStyle, item.text),
          computedStyle: itemComputed,
        }),
      );
    } else {
      // InlineItem narrows to EmbedItem here.
      out.push(
        Object.freeze({
          ...createElementBox(key, itemStyle, [], {
            embedType: item.embedType,
            ...item.properties,
          }),
          computedStyle: itemComputed,
        }),
      );
    }
    i++;
  }

  // Empty-paragraph strut sentinel: when a leaf block has no inline items
  // (e.g. an empty paragraph after the user pressed Enter), the layout
  // pipeline keys IFC dispatch off the presence of inline children. To
  // ensure the IFC is invoked — so its zero-tokens path emits the strut
  // LineBox carrying one line-height of vertical space (browser-faithful
  // empty-<p> behavior) — we emit a single empty TextBox here. Its empty
  // text produces zero tokens (collectInlineTokens short-circuits on empty
  // text), so the only effect is triggering IFC dispatch. Atomic-leaf
  // components (image, horizontal-line) ignore inlineRenderNodes entirely
  // (they read attrs and pass [] to createElementBox), so the sentinel is
  // discarded for them — only inline-bearing leaves see the strut behavior.
  if (out.length === 0) {
    out.push(
      Object.freeze({
        ...createTextBox(`${blockId}/inline/0`, {}, ""),
        computedStyle: flattenLengths(composeComputed({}, blockComputed)),
      }),
    );
  }

  return out;
}
