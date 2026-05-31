import { getBlock, getEmbedContent, getEmbedContentIds, getTemplateContent, getTemplateContentIds, resolveBlock, docHasFootnotes, FOOTNOTE_ANCHOR_EMBED_TYPE } from "../state";
import type { Block, BlockId, State, ReadonlyAttrs, InlineContent } from "../state";
import type { Style, ComputedStyle } from "../styles";
import { INITIAL_COMPUTED_STYLE } from "../styles/property-meta";
import { composeComputed } from "../cascade/compose";
import { flattenLengths } from "../cascade/flatten-lengths";
import type { AttrRegistry } from "../cascade/attr-registry";
import type { ComponentRegistry } from "../components/component-registry";
import {
  collectFootnoteAnchors,
  footnoteNumbers,
  documentFootnotePolicy,
  EMPTY_FOOTNOTE_ANCHORS,
  type FootnoteAnchorRef,
  type FootnoteNumber,
  type FootnoteNumberingPolicy,
} from "../footnotes";
import type {
  BlockView,
  ContainerBlockView,
  LeafBlockView,
  RenderContext,
} from "./block-view";
import type { RenderNode } from "./render-node";
import { createTextBox, createElementBox } from "./render-node";
import { buildFootnoteMarker } from "./footnote-marker";

/**
 * FN-6.3: the EFFECTIVE footnote numbering policy for the RENDER pass. Reads the
 * document-level policy from the root block's raw attrs (`documentFootnotePolicy`
 * — the Google Docs default `{ continuous, decimal }` when unset/invalid), then
 * applies one render-only adjustment:
 *
 * **restart-per-page falls back to continuous here.** `restart-per-page`
 * numbering depends on which page each footnote lands on, which is only known
 * AFTER the `resolveFootnotes` layout pass (FN-4/FN-6.4). The render pass has no
 * `pageAssignment`, and `footnoteNumbers` THROWS for `restart-per-page` without
 * one. Substituting `continuous` renders a valid (if not yet per-page) sequence
 * instead of crashing. This is the documented FN-6.3 → FN-6.4 phasing: FN-6.3
 * lands the policy infrastructure; FN-6.4's two-pass cycle feeds per-page numbers
 * from `resolveFootnotes` into the markers. Continuous and restart-per-section are
 * state-derivable and pass through unchanged.
 */
function effectiveRenderPolicy(state: State): FootnoteNumberingPolicy {
  const policy = documentFootnotePolicy(state);
  return policy.reset === "restart-per-page"
    ? { ...policy, reset: "continuous" }
    : policy;
}

/**
 * The block `type` that opens a section (flat children of the document root).
 * FN-8's anchor-reuse guard treats a dirty `section` block as a possible
 * anchor-rescope (its enclosing `sectionId` drives restart-per-section
 * numbering), forcing a recompute. Mirrors the constant in
 * `footnotes/collect-anchors.ts`.
 */
const SECTION_BLOCK_TYPE = "section";

/**
 * FN-8: shared frozen empty numbering map for the footnote-free path. A document
 * with no footnotes (`docHasFootnotes(state) === false`) skips the O(N_blocks)
 * `collectFootnoteAnchors` walk entirely and uses `EMPTY_FOOTNOTE_ANCHORS` (from
 * the footnotes module) + this empty map instead — identical downstream behavior
 * (the walk would have returned `[]` and built an empty numbering map), minus the
 * walk.
 */
const EMPTY_FOOTNOTE_NUMBERS: ReadonlyMap<BlockId, FootnoteNumber> =
  Object.freeze(new Map<BlockId, FootnoteNumber>());

/**
 * Build the per-render-cycle `RenderContext`. `getView` / `getEmbedContent`
 * remain P7 stubs (throw on use — surfaces accidental callers immediately;
 * P10+ wires them through a per-block view cache). `footnoteNumber` is wired:
 * it reads `fnNumbers` — the SAME numbering map already computed once this
 * cycle for the call markers — so a footnote body's leading number (its
 * generated `markerText`) always matches its anchor's number. Both render
 * paths (full + incremental) construct the context through here so the body
 * number renders identically regardless of path.
 */
function makeRenderContext(
  state: State,
  fnNumbers: ReadonlyMap<BlockId, FootnoteNumber>,
): RenderContext {
  return {
    state,
    getView: (_id: BlockId): BlockView => {
      throw new Error("RenderContext.getView not yet wired — populated in P10");
    },
    getEmbedContent: (_id: BlockId): BlockView => {
      throw new Error("RenderContext.getEmbedContent not yet wired — populated in P10");
    },
    footnoteNumber: (contentBlockId: BlockId): string | undefined =>
      fnNumbers.get(contentBlockId)?.formatted,
  };
}

/**
 * Output of the new renderer. `root` is the main document's RenderNode tree;
 * `embedContents` (populated by T8) carries footnote bodies etc. as a
 * parallel map keyed by BlockId, consumed by pagination. `templateContents`
 * (C.2a) carries header/footer template bodies as a second parallel map,
 * rendered the same way as embeds; nothing positions these bodies until
 * C.2c wires templates into pagination.
 */
export interface RenderOutput {
  readonly root: RenderNode;
  readonly embedContents: ReadonlyMap<BlockId, RenderNode>;
  readonly templateContents: ReadonlyMap<BlockId, RenderNode>;
  /**
   * FN-8: the document's footnote anchors in document order, cached on the
   * render output so the NEXT incremental cycle can REUSE them — skipping the
   * O(N_blocks) `collectFootnoteAnchors` walk when no edit could have changed
   * the list (no dirty block gained/lost/moved an anchor; see
   * `footnoteAnchorsUnchanged`). Empty for a footnote-free document.
   */
  readonly footnoteAnchors: readonly FootnoteAnchorRef[];
  /**
   * FN-8: the per-anchor numbering map for THIS cycle (keyed by
   * `FootnoteAnchorRef.contentBlockId`), cached alongside `footnoteAnchors`.
   * When the anchors are reused unchanged, this map is reused too (the default
   * continuous policy is a pure function of the anchor list), so the per-cycle
   * renumber diff is also skipped. Empty for a footnote-free document.
   */
  readonly footnoteNumbers: ReadonlyMap<BlockId, FootnoteNumber>;
}

/**
 * Optional inputs that opt-in to incremental rendering. When all three
 * are supplied, render walks the layout tree reusing `prev`'s
 * RenderNode for any block whose subtree is unchanged (block-level
 * reference equality), and only rebuilds invalidated subtrees.
 *
 * The "invalidated" set is `dirtyIds ∪ ancestors(dirtyIds) ∪
 * descendants(dirtyIds)`:
 * - `dirtyIds`: blocks whose own attrs/content changed (state-module's
 *   per-operation `dirtyIds` contract).
 * - `ancestors(dirtyIds)`: their children arrays now point at
 *   recomputed children, so the ancestor's RenderNode identity
 *   changes; computed style is unchanged but the node must be
 *   re-created with the updated children array.
 * - `descendants(dirtyIds)`: their attrs may be unchanged at the
 *   state level but their cascaded `computedStyle` propagates from
 *   an ancestor whose declared style changed. Re-composing is the
 *   safe path; reusing the prev RenderNode would leave stale
 *   computed style.
 *
 * For typical edits (text content of a leaf block), `dirtyIds` is one
 * leaf block, ancestors are a small chain, descendants is empty —
 * the common-case cost is O(depth) per edit instead of O(N).
 */
export interface RenderOptions {
  readonly prev?: RenderOutput;
  readonly prevState?: State;
  readonly dirtyIds?: ReadonlySet<BlockId>;
  /**
   * FN-6.4 (slice 2): an AUTHORITATIVE footnote numbering map injected by the
   * layout-driven `restart-per-page` second pass (`rebuildTrees`). When present,
   * BOTH render paths use it as `fnNumbers` INSTEAD of the policy-derived
   * computation (`effectiveRenderPolicy(state)` / the FN-8 reused cache) — the
   * override is the source of truth for this cycle. It flows to BOTH the inline
   * call markers (`expandInlineItems`) and the body leading markers
   * (`makeRenderContext` → `footnoteNumber`), so the two always agree.
   *
   * This is the clean injection point for layout-derived numbers: render is the
   * level where a footnote number lives (a `TextBox.text` / a body `markerText`),
   * and `restart-per-page` numbers are only known after pagination — a contained
   * `target-counter`. When absent, behavior is exactly as before FN-6.4.
   */
  readonly footnoteNumbersOverride?: ReadonlyMap<BlockId, FootnoteNumber>;
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
  options?: RenderOptions,
): RenderOutput {
  // Incremental path: all three options must be provided. Otherwise
  // fall through to the full-rebuild path below (unchanged from
  // before R-D, so callers that don't opt in keep working).
  if (
    options !== undefined &&
    options.prev !== undefined &&
    options.prevState !== undefined &&
    options.dirtyIds !== undefined
  ) {
    return renderIncremental(
      state,
      componentRegistry,
      attrRegistry,
      options.prev,
      options.prevState,
      options.dirtyIds,
      options.footnoteNumbersOverride,
    );
  }

  // FN-2: compute the footnote numbering map once for this render cycle and
  // thread it down so the footnote-anchor marker renders its number by id.
  // FN-8: a footnote-free doc skips the O(N_blocks) `collectFootnoteAnchors`
  // walk entirely (an empty map is the identical result). `docHasFootnotes` is
  // O(1) (cached embed-content root-id set). We collect the anchor LIST here
  // (not just the numbers) so the resulting RenderOutput can CACHE it — the
  // next incremental cycle reuses both the anchors and the numbers when no edit
  // could have changed them (see `footnoteAnchorsUnchanged`).
  const fnAnchors = docHasFootnotes(state)
    ? collectFootnoteAnchors(state)
    : EMPTY_FOOTNOTE_ANCHORS;
  // FN-6.4: an explicit override (layout-derived per-page numbers) is
  // authoritative — use it directly and skip the policy-derived computation.
  const fnNumbers = options?.footnoteNumbersOverride !== undefined
    ? options.footnoteNumbersOverride
    : fnAnchors.length > 0
      ? footnoteNumbers(fnAnchors, effectiveRenderPolicy(state))
      : EMPTY_FOOTNOTE_NUMBERS;
  // P7 stubs RenderContext.getView / getEmbedContent. P10+ will wire them
  // through a per-block view cache. Throwing rather than returning
  // undefined surfaces accidental P7 callers immediately.
  const context: RenderContext = makeRenderContext(state, fnNumbers);
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
    fnNumbers,
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
        fnNumbers,
      ),
    );
  }
  // Template contents: rendered exactly like embed contents — each
  // header/footer template body is a self-contained subtree with no parent
  // computed style (uses initial). Its own freshly-seeded `visited` set
  // (independent walk over its own descendants). Inert until C.2c.
  const templateContents = new Map<BlockId, RenderNode>();
  for (const id of getTemplateContentIds(state)) {
    const block = getTemplateContent(state, id);
    if (block === null) continue; // shouldn't happen since we just enumerated the map
    const visitedTemplate = new Set<BlockId>();
    templateContents.set(
      id,
      renderBlock(
        block,
        null,
        undefined,
        state,
        componentRegistry,
        attrRegistry,
        context,
        visitedTemplate,
        fnNumbers,
      ),
    );
  }
  return Object.freeze({
    root,
    embedContents,
    templateContents,
    footnoteAnchors: fnAnchors,
    footnoteNumbers: fnNumbers,
  });
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
  fnNumbers: ReadonlyMap<BlockId, FootnoteNumber>,
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
        // Walk via resolveBlock (main → embed → template) so a container
        // body nested in embedContents/templateContents resolves its
        // children, which live in the same content Y.Map. For main-tree
        // blocks resolveBlock's first arm is getBlock → identical.
        const child = resolveBlock(state, childId)?.block ?? null;
        if (child === null) {
          throw new Error(`render: child "${childId}" of "${block.id}" not found in any tree`);
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
            fnNumbers,
          ),
        );
        childId = child.nextSiblingId;
      }
      return def.render(view, context, childRenderNodes);
    }

    // Exhaustiveness backstop: the container branch returns, so `def` is the
    // leaf variant here. If a third component `kind` is ever added, this line
    // fails to compile — forcing the new kind to be handled rather than silently
    // falling through to the leaf path.
    def.kind satisfies "leaf";

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
      : expandInlineItems(block.id, inline, specified, attrRegistry, fnNumbers);
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
  fnNumbers: ReadonlyMap<BlockId, FootnoteNumber>,
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
    } else if (item.embedType === FOOTNOTE_ANCHOR_EMBED_TYPE) {
      // FN-2: a footnote-anchor embed renders as the superscript call marker
      // (a small, raised number) instead of the invisible zero-width embed
      // box. Its number comes from the FN-3 numbering map, keyed by the
      // anchor's `properties.contentBlockId`. The marker is still ONE
      // inline-block = exactly one cursor stop (the IFC emits one atomic token
      // per inline-block regardless of its children), so the state-model
      // offset accounting is unchanged from a plain embed.
      const contentBlockId = item.properties.contentBlockId;
      const formatted =
        typeof contentBlockId === "string"
          ? fnNumbers.get(contentBlockId as BlockId)?.formatted
          : undefined;
      out.push(
        buildFootnoteMarker(key, itemStyle, formatted, {
          embedType: item.embedType,
          ...item.properties,
        }),
      );
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

// ─────────────────────────────────────────────────────────────────────
// Incremental render path (R-D)
// ─────────────────────────────────────────────────────────────────────

/**
 * Walk the new state's block tree, reusing prev's RenderNode for any
 * block not in the invalidation set (and present in prev's index).
 *
 * Invalidation = `dirtyIds ∪ ancestors(dirtyIds) ∪ descendants(dirtyIds)`.
 * See `RenderOptions` JSDoc for why each piece is needed.
 *
 * Embeds are re-rendered when their source block is invalidated;
 * otherwise the prev RenderNode is reused.
 */
function renderIncremental(
  state: State,
  componentRegistry: ComponentRegistry,
  attrRegistry: AttrRegistry,
  prev: RenderOutput,
  prevState: State,
  dirtyIds: ReadonlySet<BlockId>,
  footnoteNumbersOverride?: ReadonlyMap<BlockId, FootnoteNumber>,
): RenderOutput {
  // Empty-dirty short-circuit: nothing changed → return prev as-is.
  // This preserves reference equality on the top-level RenderOutput so
  // downstream consumers (cascade, layout, paint) can skip work too.
  //
  // FN-6.4: an override is the source of truth for the NUMBERS this cycle, so
  // we must NOT take the empty-dirty short-circuit when one is supplied — the
  // caller relies on the override flowing into the markers. The caller pairs an
  // override with a non-empty `dirtyIds` (the changed marker blocks), so in
  // practice this guard never even reaches `size === 0` with an override; the
  // explicit check makes the precedence unambiguous.
  if (dirtyIds.size === 0 && footnoteNumbersOverride === undefined) return prev;

  // FN-2: the footnote numbering map for THIS cycle, and the prior cycle's.
  // A footnote inserted/deleted/reordered renumbers DOWNSTREAM anchors whose
  // own blocks are NOT in `dirtyIds` (only the edited anchor's block is). Those
  // downstream anchor blocks carry a now-stale marker number in their cached
  // RenderNode, so they must be invalidated even though their content didn't
  // change. The renumber loop below diffs the two numbering maps per anchor and
  // folds both the host (call marker) and the body root (slot number) of each
  // renumbered footnote into the invalidation set.
  // Collect the new state's footnote anchors ONCE (one O(N_blocks) walk) and
  // reuse the list for both the numbering map AND the renumber diff — avoid a
  // second walk per keystroke.
  //
  // FN-8: a footnote-FREE document (the dominant per-keystroke case) skips the
  // walk entirely. `docHasFootnotes` is O(1) (cached embed-content root-id set,
  // recomputed only on a footnote insert/delete, not per keystroke), whereas
  // `collectFootnoteAnchors` is an O(N_blocks) full-document tree walk. The
  // result is identical: a footnote-free doc has no anchors and an empty
  // numbering map, so the downstream `fnAnchors.length > 0` block naturally
  // skips too. This removes the last unguarded per-keystroke walk (the
  // prevState diff at L543 was already guarded).
  // FN-8 (footnote-BEARING incremental): when the doc has footnotes but NO edit
  // this cycle could have changed the anchor list (added / removed / moved an
  // anchor-bearing block, or touched a section), REUSE the prior cycle's cached
  // anchors + numbers instead of re-walking all N blocks. The reuse is exact:
  // the anchor list is the document order of anchor-bearing blocks, and every
  // block that could change it is in `dirtyIds`, so checking each dirty block's
  // new-or-prev inline content for an anchor (plus the section guard) is a
  // complete test (`footnoteAnchorsUnchanged`).
  //
  // When anchors are reused, the numbering map is reused verbatim: the
  // state-derivable policies (continuous / restart-per-section) are pure
  // functions of the anchor list, so unchanged anchors ⇒ unchanged numbers —
  // the per-cycle renumber diff is skipped too. FN-6.3: a policy CHANGE dirties
  // the root block, and `footnoteAnchorsUnchanged` returns false when the root
  // is dirty (`dirtyIds.has(state.rootId)`), so a policy edit forces a
  // recompute under the new policy rather than reusing stale numbers.
  // (Restart-per-page numbering, FN-6.4, is NOT yet wired into render — it
  // falls back to continuous via `effectiveRenderPolicy`; once FN-6.4's two-pass
  // cycle supplies per-page numbers, layout-dependent numbers can shift WITHOUT
  // any anchor change, and that policy must NOT reuse numbers blindly.)
  const reuseAnchors = footnoteAnchorsUnchanged(state, prevState, dirtyIds, prev);
  const fnAnchors = reuseAnchors
    ? prev.footnoteAnchors
    : docHasFootnotes(state)
      ? collectFootnoteAnchors(state)
      : EMPTY_FOOTNOTE_ANCHORS;
  // FN-6.4: when an override is supplied it is authoritative for the NUMBERS
  // this cycle — it replaces BOTH the policy-derived computation AND the FN-8
  // reused cache (`prev.footnoteNumbers`). The anchor LIST is still reused or
  // recomputed as usual (the override only governs numbers, not membership).
  const fnNumbers = footnoteNumbersOverride !== undefined
    ? footnoteNumbersOverride
    : reuseAnchors
      ? prev.footnoteNumbers
      : fnAnchors.length > 0
        ? footnoteNumbers(fnAnchors, effectiveRenderPolicy(state))
        : EMPTY_FOOTNOTE_NUMBERS;

  const invalidated = computeInvalidatedBlocks(state, prevState, dirtyIds);
  // The renumber diff only matters when the NEW state has footnotes AND we did
  // NOT reuse the anchors: reused anchors ⇒ identical numbers ⇒ no marker can be
  // stale, so the diff (and its prevState walk) is skipped. A footnote-free doc
  // has an empty anchor list and skips here too — the common case pays nothing.
  if (!reuseAnchors && fnAnchors.length > 0) {
    // FN-8: the prior cycle's numbering map is already cached on `prev` — it IS
    // `footnoteNumbers(collectFootnoteAnchors(prevState), policy)`. Reuse it
    // directly instead of re-walking prevState (the renumber diff only runs when
    // an anchor changed, but even then the prevState walk is pure waste here).
    const prevFnNumbers = prev.footnoteNumbers;
    // Diff per-ANCHOR (by contentBlockId) so a host block carrying multiple
    // footnotes only re-renders the bodies that actually renumbered — a strict
    // superset check by host would over-invalidate unchanged siblings.
    for (const anchor of fnAnchors) {
      const now = fnNumbers.get(anchor.contentBlockId)?.formatted;
      const before = prevFnNumbers.get(anchor.contentBlockId)?.formatted;
      if (now === before) continue;
      if (!invalidated.has(anchor.blockId)) {
        // The renumbered anchor's HOST block needs a fresh call marker;
        // invalidating its ancestors too (so the parent's children array is
        // rebuilt with the new marker node) mirrors `computeInvalidatedBlocks`'s
        // ancestor walk.
        invalidated.add(anchor.blockId);
        addAncestorsToInvalidated(state, prevState, anchor.blockId, invalidated);
      }
      // The footnote BODY root carries the same number as a leading marker
      // (`markerText`, baked from `ctx.footnoteNumber` at render time —
      // footnote-body.ts / FN-6.2b). Without invalidating it the body slot keeps
      // the stale number while the call marker updates (e.g. insert a footnote
      // before existing ones → markers renumber but body slots don't). The body
      // root is a top-level embedContents entry reused via `invalidated.has(id)`
      // below, so no ancestor walk is needed. (Mirrors the layout-path override
      // in editor/actions/helpers.ts, which already invalidates both ids.)
      invalidated.add(anchor.contentBlockId);
    }
  }
  // Index the main tree PLUS every prev embed-content and template-content
  // body tree into ONE combined map, so a dirty body re-rendered via
  // renderBlockIncremental can reuse its UNCHANGED children by reference.
  // Without the body trees, body-internal nodes were never indexed and every
  // unchanged sibling was rebuilt fresh (defeating the O(1)-per-keystroke goal
  // for header/footer/footnote bodies).
  //
  // Key collisions ARE possible across these trees even though block ids are
  // unique at the STATE level: a body child block can ALSO be enumerated as
  // its own top-level embed/template-content entry (the full-render path
  // renders every map entry as a standalone subtree). The same block then
  // produces two distinct RenderNodes — one standalone-root, one in-body-child
  // — sharing a key. We want the IN-BODY-CHILD occurrence to win, so that
  // re-rendering the parent body reuses exactly the subtree the body had
  // before. The merge rule below ("descendant occurrences overwrite, root
  // occurrences don't overwrite") resolves this deterministically regardless
  // of Y.Map iteration order. Indexed once here (not per-body-render) to stay
  // allocation-reasonable.
  const prevByKey = new Map<string, RenderNode>();
  indexRenderNodesByKey(prev.root, prevByKey);
  for (const bodyNode of prev.embedContents.values()) {
    indexRenderNodesByKey(bodyNode, prevByKey);
  }
  for (const bodyNode of prev.templateContents.values()) {
    indexRenderNodesByKey(bodyNode, prevByKey);
  }

  const context: RenderContext = makeRenderContext(state, fnNumbers);

  const rootBlock = getBlock(state, state.rootId);
  if (rootBlock === null) {
    throw new Error(`render: root block "${state.rootId}" not found`);
  }
  const visited = new Set<BlockId>();
  const root = renderBlockIncremental(
    rootBlock,
    null,
    undefined,
    state,
    componentRegistry,
    attrRegistry,
    context,
    visited,
    invalidated,
    prevByKey,
    fnNumbers,
  );

  // Embed contents: reuse prev's RenderNode unless the embed's source
  // block is in the invalidation set, or it's a newly-added embed
  // (no prev entry).
  const embedContents = new Map<BlockId, RenderNode>();
  for (const id of getEmbedContentIds(state)) {
    const cachedEmbed = prev.embedContents.get(id);
    if (cachedEmbed !== undefined && !invalidated.has(id)) {
      embedContents.set(id, cachedEmbed);
      continue;
    }
    const block = getEmbedContent(state, id);
    if (block === null) continue;
    const embedVisited = new Set<BlockId>();
    embedContents.set(
      id,
      renderBlockIncremental(
        block,
        null,
        undefined,
        state,
        componentRegistry,
        attrRegistry,
        context,
        embedVisited,
        invalidated,
        prevByKey,
        fnNumbers,
      ),
    );
  }

  // Template contents: same reuse-vs-rerender logic as embed contents.
  // Reuse prev's RenderNode unless the template body's source block is in
  // the invalidation set, or it's a newly-added body (no prev entry).
  const templateContents = new Map<BlockId, RenderNode>();
  for (const id of getTemplateContentIds(state)) {
    const cachedTemplate = prev.templateContents.get(id);
    if (cachedTemplate !== undefined && !invalidated.has(id)) {
      templateContents.set(id, cachedTemplate);
      continue;
    }
    const block = getTemplateContent(state, id);
    if (block === null) continue;
    const templateVisited = new Set<BlockId>();
    templateContents.set(
      id,
      renderBlockIncremental(
        block,
        null,
        undefined,
        state,
        componentRegistry,
        attrRegistry,
        context,
        templateVisited,
        invalidated,
        prevByKey,
        fnNumbers,
      ),
    );
  }

  // Always carry THIS cycle's anchors + numbers (reused or recomputed) so the
  // NEXT incremental cycle can reuse them.
  return Object.freeze({
    root,
    embedContents,
    templateContents,
    footnoteAnchors: fnAnchors,
    footnoteNumbers: fnNumbers,
  });
}

/**
 * FN-8: decide whether the prior render cycle's cached footnote anchors (and
 * thus the derived continuous numbering) can be REUSED for this incremental
 * cycle, skipping the O(N_blocks) `collectFootnoteAnchors` walk.
 *
 * Reuse is allowed iff ALL of:
 *  1. the document has footnotes (`docHasFootnotes`) — a footnote-free doc has
 *     no cached anchors worth reusing and takes the empty-list short-circuit;
 *  2. NO block in `dirtyIds` carries a footnote anchor in its NEW (current
 *     state) OR PREV (prevState) inline content — the complete test for an
 *     anchor add / remove / move, since every such block is dirty and either
 *     its new content (added/moved) or its prev content (removed/moved) holds
 *     the anchor; and
 *  3. NO block in `dirtyIds` is a `section`-type block in the new OR prev state
 *     — a section change can rescope an anchor (its enclosing `sectionId`),
 *     which the restart-per-section policy depends on.
 *
 * Moving a NON-anchor block cannot reorder anchors, so it does not block reuse.
 */
function footnoteAnchorsUnchanged(
  state: State,
  prevState: State,
  dirtyIds: ReadonlySet<BlockId>,
  prev: RenderOutput,
): boolean {
  if (!docHasFootnotes(state)) return false;
  // Reuse only when `prev` actually cached anchors. Every render path (full +
  // incremental) populates `footnoteAnchors` whenever the doc has footnotes, so
  // this is true on any normal `prev`; the check doubles as the guard that we
  // have a list to reuse before scanning the dirty set.
  if (prev.footnoteAnchors.length === 0) return false;
  // FN-6.3: the numbering map also depends on the DOCUMENT-LEVEL policy, which
  // lives in the ROOT block's raw attrs (read by `documentFootnotePolicy`). A
  // policy change dirties the root but touches no anchor-bearing or section
  // block, so the per-block scan below would NOT catch it — reusing the stale
  // numbers. Force a recompute whenever the policy-bearing root is dirty (O(1)).
  if (dirtyIds.has(state.rootId)) return false;
  for (const id of dirtyIds) {
    if (blockIsSection(state, id) || blockIsSection(prevState, id)) return false;
    if (
      blockHasFootnoteAnchor(getBlock(state, id)) ||
      blockHasFootnoteAnchor(getBlock(prevState, id))
    ) {
      return false;
    }
  }
  return true;
}

/** True if `block` (a main-tree block, or null) carries a footnote-anchor embed. */
function blockHasFootnoteAnchor(block: Block | null): boolean {
  if (block === null || block.inlineContent === null) return false;
  for (const item of block.inlineContent.items) {
    if (item.kind === "embed" && item.embedType === FOOTNOTE_ANCHOR_EMBED_TYPE) {
      return true;
    }
  }
  return false;
}

/** True if the block with `id` in `state` is a `section`-type block. */
function blockIsSection(state: State, id: BlockId): boolean {
  return getBlock(state, id)?.type === SECTION_BLOCK_TYPE;
}

/**
 * Same recursion shape as `renderBlock` but consults the invalidation
 * set + prev-index first: a non-invalidated block whose RenderNode
 * exists in prev is returned as-is (reference reuse). Otherwise the
 * block is fully re-rendered, with children recursing through the
 * same incremental logic.
 */
function renderBlockIncremental(
  block: Block,
  parentComputed: ComputedStyle | null,
  parentSpecified: Partial<Style> | undefined,
  state: State,
  componentRegistry: ComponentRegistry,
  attrRegistry: AttrRegistry,
  context: RenderContext,
  visited: Set<BlockId>,
  invalidated: ReadonlySet<BlockId>,
  prevByKey: ReadonlyMap<string, RenderNode>,
  fnNumbers: ReadonlyMap<BlockId, FootnoteNumber>,
): RenderNode {
  if (!invalidated.has(block.id)) {
    const cached = prevByKey.get(block.id);
    if (cached !== undefined) return cached;
  }
  // Note re: spec deviation — the design spec
  // (`docs/superpowers/specs/2026-05-22-render-incremental-design.md`)
  // also suggests a `getBlock(state, id) === getBlock(prevState, id)`
  // belt-and-suspenders check. In practice that comparison is not
  // useful at runtime: `getBlock` returns a wrapper over the Y.Doc
  // (per `state/state.ts`); fresh State after an operation produces
  // different wrapper instances even for blocks whose underlying
  // content is unchanged. A meaningful "did this block change"
  // comparison would have to be structural (O(block-size)) and would
  // defeat the perf gain. The state module's `dirtyIds` contract (T7)
  // is the authoritative signal; the spec assumes it, and we trust
  // it here. If a future state op leaves `dirtyIds` incomplete, the
  // bug surfaces as stale rendered content — caught by integration
  // tests, not by a runtime structural compare here.

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
        // Walk via resolveBlock (main → embed → template) so a re-rendered
        // container body nested in embedContents/templateContents resolves
        // its children, which live in the same content Y.Map. For main-tree
        // blocks resolveBlock's first arm is getBlock → identical.
        const child = resolveBlock(state, childId)?.block ?? null;
        if (child === null) {
          throw new Error(`render: child "${childId}" of "${block.id}" not found in any tree`);
        }
        childRenderNodes.push(
          renderBlockIncremental(
            child,
            computed,
            specified,
            state,
            componentRegistry,
            attrRegistry,
            context,
            visited,
            invalidated,
            prevByKey,
            fnNumbers,
          ),
        );
        childId = child.nextSiblingId;
      }
      return def.render(view, context, childRenderNodes);
    }

    // Exhaustiveness backstop (see renderBlock): `def` is the leaf variant here.
    def.kind satisfies "leaf";

    const inline: InlineContent = block.inlineContent ?? { items: [] };
    const view: LeafBlockView = Object.freeze({
      id: block.id,
      type: block.type,
      attrs: block.attrs,
      computedStyle: computed,
      kind: "leaf" as const,
      inlineContent: inline,
    });
    const inlineRenderNodes: ReadonlyArray<RenderNode> = def.leafShape === "atomic"
      ? []
      : expandInlineItems(block.id, inline, specified, attrRegistry, fnNumbers);
    return def.render(view, context, inlineRenderNodes);
  } finally {
    visited.delete(block.id);
  }
}

/**
 * Compute the invalidation set: every block whose RenderNode must be
 * rebuilt (cannot be reused from prev). Includes:
 *   - dirty blocks themselves (attrs / content changed).
 *   - their ancestors (children arrays now point at recomputed
 *     children — RenderNode identity changes even though computed
 *     style is unchanged).
 *   - their descendants (cascaded style propagates down from a
 *     declared-style change; descendants' Block-level attrs may be
 *     unchanged but their computedStyle would be stale if reused).
 *
 * Ancestor walk falls back to OLD state for removed blocks (so a
 * deleted block's parent is still invalidated). Descendants walk
 * uses NEW state (deleted blocks have no descendants).
 */
function computeInvalidatedBlocks(
  state: State,
  prevState: State,
  dirtyIds: ReadonlySet<BlockId>,
): Set<BlockId> {
  const invalidated = new Set<BlockId>();
  for (const id of dirtyIds) {
    invalidated.add(id);
    // Ancestors via parentId chain.
    addAncestorsToInvalidated(state, prevState, id, invalidated);
    // Descendants in new state.
    addDescendantsToInvalidated(state, id, invalidated);
  }
  return invalidated;
}

/**
 * Add every ancestor of `id` (via the parentId chain) to `out`, stopping at
 * the first already-present ancestor (the chain above it is already covered).
 *
 * resolveBlock (main → embed → template) so the walk climbs THROUGH a
 * container body nested in embedContents/templateContents and reaches the body
 * root — main-tree behavior is byte-identical (resolveBlock's first arm is
 * getBlock). Falls back to OLD state for a removed block so a deleted block's
 * parent is still invalidated.
 */
function addAncestorsToInvalidated(
  state: State,
  prevState: State,
  id: BlockId,
  out: Set<BlockId>,
): void {
  let cursor: BlockId = id;
  while (true) {
    const block =
      resolveBlock(state, cursor)?.block ?? resolveBlock(prevState, cursor)?.block ?? null;
    if (block === null || block.parentId === null) break;
    const parentId = block.parentId;
    if (out.has(parentId)) break;
    out.add(parentId);
    cursor = parentId;
  }
}


function addDescendantsToInvalidated(
  state: State,
  id: BlockId,
  out: Set<BlockId>,
): void {
  // resolveBlock (main → embed → template) so descendants of a container
  // body nested in embedContents/templateContents are reached — main-tree
  // behavior is byte-identical (resolveBlock's first arm is getBlock).
  const block = resolveBlock(state, id)?.block ?? null;
  if (block === null) return;
  let childId = block.firstChildId;
  while (childId !== null) {
    if (!out.has(childId)) {
      out.add(childId);
      addDescendantsToInvalidated(state, childId, out);
    }
    const child = resolveBlock(state, childId)?.block ?? null;
    if (child === null) break;
    childId = child.nextSiblingId;
  }
}

/**
 * Index every RenderNode in `root`'s subtree into `out`, keyed by
 * RenderNode `key`. Block-level RenderNodes' keys are the block id (per the
 * component-dispatch contract); inline RenderNodes' keys are
 * `${blockId}/inline/${i}`. The incremental renderer only looks up by block
 * id, but indexing everything keeps the helper simple and lets future
 * consumers reuse inline-level nodes too.
 *
 * `out` is passed in so multiple trees (main root + each embed/template body)
 * can be folded into ONE combined map. Collision rule: the SUBTREE ROOT does
 * NOT overwrite an existing entry, but DESCENDANTS always overwrite. This
 * matters because the same block can appear both as its own top-level
 * embed/template-content entry (a standalone-root RenderNode) and as a child
 * inside another body (an in-body-child RenderNode). The in-body-child
 * occurrence is the one we want to reuse — so a descendant always wins, and a
 * root never clobbers a descendant already indexed by another tree. The rule
 * is order-independent: whichever tree is indexed first, the descendant
 * occurrence ends up in the map.
 */
function indexRenderNodesByKey(
  root: RenderNode,
  out: Map<string, RenderNode>,
): void {
  walk(root, true);
  function walk(node: RenderNode, isRoot: boolean): void {
    // Root: only set if absent (don't clobber a descendant from another tree).
    // Descendant: always set (a true in-body child wins over a standalone root).
    if (!isRoot || !out.has(node.key)) {
      out.set(node.key, node);
    }
    if (node.type === "element") {
      for (const child of node.children) walk(child, false);
    }
  }
}
