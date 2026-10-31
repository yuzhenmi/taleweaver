import { getBlock, getEmbedContent, getEmbedContentIds, getTemplateContent, getTemplateContentIds, docHasFootnotes, docHasLists, getListDefsForDocument } from "../state";
import type { Block, BlockId, Document, SuggestionView, OutlineSignature } from "../state";
import { computeOutlineSignature } from "../state";
import type { Style, ComputedStyle } from "../styles";
import type { AttrRegistry } from "../cascade/attr-registry";
import type { ComponentRegistry } from "../components/component-registry";
import {
  collectFootnoteAnchors,
  footnoteNumbers,
  EMPTY_FOOTNOTE_ANCHORS,
  type FootnoteAnchorRef,
  type FootnoteNumber,
} from "../footnotes";
import { collectListEvents, computeCounters } from "../numbering";
import type { CounterValue } from "../numbering/types";
import type { RenderContext } from "./block-view";
import type { RenderNode } from "./render-node";
import { renderBlockBody } from "./render-core";
import { buildCrossReferenceIndex, type CrossReferenceIndex } from "./collect-cross-references";
import {
  effectiveRenderPolicy,
  makeRenderContext,
  EMPTY_FOOTNOTE_NUMBERS,
} from "./render-footnotes";
import { renderIncremental } from "./render-incremental";

/**
 * Output of the new renderer. `root` is the main document's RenderNode tree;
 * `embedContents` carries footnote bodies etc. as a
 * parallel map keyed by BlockId, consumed by pagination. `templateContents`
 * carries header/footer template bodies as a second parallel map, rendered
 * the same way as embeds; pagination lays each body out into the header /
 * footer slot of every page its section assigns it to.
 */
export interface RenderOutput {
  readonly root: RenderNode;
  readonly embedContents: ReadonlyMap<BlockId, RenderNode>;
  readonly templateContents: ReadonlyMap<BlockId, RenderNode>;
  /**
   * The document's footnote anchors in document order, cached on the
   * render output so the NEXT incremental cycle can REUSE them — skipping the
   * O(N_blocks) `collectFootnoteAnchors` walk when no edit could have changed
   * the list (no dirty block gained/lost/moved an anchor; see
   * `footnoteAnchorsUnchanged`). Empty for a footnote-free document.
   */
  readonly footnoteAnchors: readonly FootnoteAnchorRef[];
  /**
   * The per-anchor numbering map for THIS cycle (keyed by
   * `FootnoteAnchorRef.contentBlockId`), cached alongside `footnoteAnchors`.
   * When the anchors are reused unchanged, this map is reused too (the default
   * continuous policy is a pure function of the anchor list), so the per-cycle
   * renumber diff is also skipped. Empty for a footnote-free document.
   */
  readonly footnoteNumbers: ReadonlyMap<BlockId, FootnoteNumber>;
  /**
   * The per-list-item numbering map for THIS cycle (keyed by list-item blockId),
   * cached so the NEXT incremental cycle can diff against it: an edit that
   * changes a FOLLOWING item's number (insert/delete/reorder) renumbers items
   * that are not themselves dirty, so the incremental pass adds the
   * number-changed blocks to its invalidation set (mirrors the footnote
   * renumber diff). Empty for a list-free document.
   */
  readonly listCounters: ReadonlyMap<BlockId, CounterValue>;
  /**
   * The cross-reference index (bookmarkId → host blocks, bookmarkId → its paired
   * range), handed to the NEXT incremental cycle, which updates it from its dirty
   * blocks (O(dirty), see `updateCrossReferenceIndex`) and re-renders every host
   * whose bookmark's value may have changed (a covered block edited, the pairing
   * changed, or the start block renumbered).
   */
  readonly crossReferenceIndex: CrossReferenceIndex;
  /**
   * The document outline signature for THIS cycle — the ordered heading list (id,
   * level, display text) a `table-of-contents` block derives its entries from,
   * plus the set of TOC anchor blocks. Cached so the NEXT incremental cycle can
   * (a) REUSE it O(1) when no dirty block was a heading (no outline change) and
   * (b) expand its invalidation set: when a heading changed this cycle, every TOC
   * anchor is force-rebuilt even though its own block is not in dirtyIds (a TOC
   * derives entries it does not own). Empty for a heading-free / TOC-free
   * document. Mirrors `crossReferenceIndex`.
   */
  readonly outlineSignature: OutlineSignature;
  /**
   * The change-tracking preview view this output was rendered under
   * (a `SuggestionView`). Cached so the incremental dispatch can DETECT a view switch: reused
   * prev nodes carry the prior view's suggestion projection, so a render whose
   * `suggestionView` differs from `prev.suggestionView` MUST take the full path
   * rather than the incremental one. `"suggesting"` for a default render.
   */
  readonly suggestionView: SuggestionView;
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
/**
 * Shared frozen empty list-counter map for the list-free path, full and
 * incremental (`render-incremental.ts` diffs it against the previous cycle's
 * counters and re-renders the `listRenumbered` blocks). A document
 * with no list-items computes no counters; the list-item component's
 * `ctx.counterValue` lookup then misses for every block, so no marker is baked —
 * identical to the pre-wiring behavior, minus the collection walk.
 */
export const EMPTY_LIST_COUNTERS: ReadonlyMap<BlockId, CounterValue> = new Map();

export interface RenderOptions {
  readonly prev?: RenderOutput;
  readonly prevDocument?: Document;
  readonly dirtyIds?: ReadonlySet<BlockId>;
  /**
   * An AUTHORITATIVE footnote numbering map injected by the
   * layout-driven `restart-per-page` second pass (`rebuildTrees`). When present,
   * BOTH render paths use it as `fnNumbers` INSTEAD of the policy-derived
   * computation (`effectiveRenderPolicy(state)` / the reused cache) — the
   * override is the source of truth for this cycle. It flows to BOTH the inline
   * call markers (`expandInlineItems`) and the body leading markers
   * (`makeRenderContext` → `footnoteNumber`), so the two always agree.
   *
   * This is the clean injection point for layout-derived numbers: render is the
   * level where a footnote number lives (a `TextBox.text` / a body `markerText`),
   * and `restart-per-page` numbers are only known after pagination — a contained
   * `target-counter`. When absent, behavior is unchanged.
   */
  readonly footnoteNumbersOverride?: ReadonlyMap<BlockId, FootnoteNumber>;
  /**
   * Change-tracking preview view. `"suggesting"` (default) renders
   * the literal document with the suggestion visuals; `"final"` renders as
   * if all suggestions were ACCEPTED; `"original"` as if all were REJECTED. Pure
   * derivation over inline content (no state mutation) — see
   * {@link RenderContext.suggestionView}. Live editing always uses `"suggesting"`.
   */
  readonly suggestionView?: SuggestionView;
}

/**
 * Render a Y.Doc-backed Document to a RenderNode tree.
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
  document: Document,
  componentRegistry: ComponentRegistry,
  attrRegistry: AttrRegistry,
  options?: RenderOptions,
): RenderOutput {
  // Incremental path: all three options must be provided. Otherwise
  // fall through to the full-rebuild path below (so callers that don't opt in keep working).
  if (
    options !== undefined &&
    options.prev !== undefined &&
    options.prevDocument !== undefined &&
    options.dirtyIds !== undefined &&
    // 5c-iii: a view SWITCH invalidates the prev cache (reused nodes carry the
    // prior view's suggestion projection), so fall through to the full path when
    // the requested view differs from the one `prev` was built under.
    options.prev.suggestionView === (options.suggestionView ?? "suggesting")
  ) {
    return renderIncremental(
      document,
      componentRegistry,
      attrRegistry,
      options.prev,
      options.prevDocument,
      options.dirtyIds,
      options.footnoteNumbersOverride,
      options.suggestionView ?? "suggesting",
    );
  }

  // Compute the footnote numbering map once for this render cycle and
  // thread it down so the footnote-anchor marker renders its number by id.
  // A footnote-free doc skips the O(N_blocks) `collectFootnoteAnchors`
  // walk entirely (an empty map is the identical result). `docHasFootnotes` is
  // O(1) (cached embed-content root-id set). We collect the anchor LIST here
  // (not just the numbers) so the resulting RenderOutput can CACHE it — the
  // next incremental cycle reuses both the anchors and the numbers when no edit
  // could have changed them (see `footnoteAnchorsUnchanged`).
  const fnAnchors = docHasFootnotes(document)
    ? collectFootnoteAnchors(document)
    : EMPTY_FOOTNOTE_ANCHORS;
  // An explicit override (layout-derived per-page numbers) is
  // authoritative — use it directly and skip the policy-derived computation.
  const fnNumbers = options?.footnoteNumbersOverride !== undefined
    ? options.footnoteNumbersOverride
    : fnAnchors.length > 0
      ? footnoteNumbers(fnAnchors, effectiveRenderPolicy(document))
      : EMPTY_FOOTNOTE_NUMBERS;
  // Compute the list-item numbering map once for this render cycle and
  // thread it down so each list-item bakes its marker by id. A list-free doc
  // skips the O(N_blocks) `collectListEvents` walk (`docHasLists` early-exits at
  // the first list-item; a list-free doc pays one allocation-free walk) and uses
  // the shared empty map — identical output, minus the work.
  const listEvents = docHasLists(document) ? collectListEvents(document) : [];
  const listCounters =
    listEvents.length > 0
      ? computeCounters(listEvents, getListDefsForDocument(document))
      : EMPTY_LIST_COUNTERS;
  // Build the cross-reference index for THIS cycle; the next incremental cycle
  // updates it from its dirty blocks. The full path walks every block anyway.
  const crossReferenceIndex = buildCrossReferenceIndex(document);
  // The document outline signature for THIS cycle, cached so the next incremental
  // cycle can reuse it (and expand its invalidation set when a heading changes).
  // The full path always walks every block anyway, so this adds no asymptotic
  // cost. Uses the same `suggestionView` the headings render under, so the cached
  // signature text matches exactly what a TOC entry shows.
  const outlineSignature = computeOutlineSignature(document, options?.suggestionView ?? "suggesting");
  const context: RenderContext = makeRenderContext(
    document,
    fnNumbers,
    listCounters,
    options?.suggestionView ?? "suggesting",
    crossReferenceIndex.bookmarks,
  );
  const visited = new Set<BlockId>();
  const rootBlock = getBlock(document, document.rootId);
  if (rootBlock === null) {
    throw new Error(`render: root block "${document.rootId}" not found`);
  }
  const root = renderBlock(
    rootBlock,
    null,
    undefined,
    document,
    componentRegistry,
    attrRegistry,
    context,
    visited,
    fnNumbers,
    listCounters,
  );
  const embedContents = new Map<BlockId, RenderNode>();
  for (const id of getEmbedContentIds(document)) {
    const block = getEmbedContent(document, id);
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
        document,
        componentRegistry,
        attrRegistry,
        context,
        visitedEmbed,
        fnNumbers,
        listCounters,
      ),
    );
  }
  // Template contents: rendered exactly like embed contents — each
  // header/footer template body is a self-contained subtree with no parent
  // computed style (uses initial). Its own freshly-seeded `visited` set
  // (independent walk over its own descendants). Pagination positions each
  // body in the header/footer slots of the pages that use it.
  const templateContents = new Map<BlockId, RenderNode>();
  for (const id of getTemplateContentIds(document)) {
    const block = getTemplateContent(document, id);
    if (block === null) continue; // shouldn't happen since we just enumerated the map
    const visitedTemplate = new Set<BlockId>();
    templateContents.set(
      id,
      renderBlock(
        block,
        null,
        undefined,
        document,
        componentRegistry,
        attrRegistry,
        context,
        visitedTemplate,
        fnNumbers,
        listCounters,
      ),
    );
  }
  return Object.freeze({
    root,
    embedContents,
    templateContents,
    suggestionView: options?.suggestionView ?? "suggesting",
    footnoteAnchors: fnAnchors,
    footnoteNumbers: fnNumbers,
    listCounters,
    crossReferenceIndex,
    outlineSignature,
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
 * **Leaf dispatch:** `def.leafShape === "atomic"` receives `[]`
 * directly — `expandInlineItems` is bypassed so the strut sentinel
 * cannot leak to atomic components. Inline-bearing leaves call
 * `expandInlineItems` as normal.
 */
function renderBlock(
  block: Block,
  parentComputed: ComputedStyle | null,
  parentSpecified: Partial<Style> | undefined,
  document: Document,
  componentRegistry: ComponentRegistry,
  attrRegistry: AttrRegistry,
  context: RenderContext,
  visited: Set<BlockId>,
  fnNumbers: ReadonlyMap<BlockId, FootnoteNumber>,
  numbering: ReadonlyMap<BlockId, CounterValue>,
): RenderNode {
  return renderBlockBody(
    block,
    parentComputed,
    parentSpecified,
    document,
    componentRegistry,
    attrRegistry,
    context,
    visited,
    fnNumbers,
    numbering,
    (child, computed, specified) =>
      renderBlock(
        child,
        computed,
        specified,
        document,
        componentRegistry,
        attrRegistry,
        context,
        visited,
        fnNumbers,
        numbering,
      ),
  );
}
