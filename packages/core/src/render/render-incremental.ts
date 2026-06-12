/**
 * @module render/render-incremental
 *
 * The incremental cache/invalidation engine (R-D). Walks the new state's block
 * tree reusing the prior `RenderOutput`'s RenderNode for any block whose subtree
 * is unchanged (block-level reference equality), rebuilding only invalidated
 * subtrees. The invalidation set is
 * `dirtyIds ∪ ancestors(dirtyIds) ∪ descendants(dirtyIds)` (see `render.ts`'s
 * `RenderOptions` JSDoc for why each piece is needed), plus the footnote
 * renumber diff folded in here.
 *
 * Dependency direction: imports the core-walker body (`renderBlockBody`) from
 * `render-core.ts` and the footnote glue from `render-footnotes.ts`; the only
 * thing it pulls from `render.ts` is the `RenderOutput` TYPE (`import type`,
 * erased at runtime — no value cycle). `render.ts`'s full `render()` entry
 * dispatches here for the incremental path.
 */
import {
  getBlock,
  getEmbedContent,
  getEmbedContentIds,
  getTemplateContent,
  getTemplateContentIds,
  resolveBlock,
  docHasFootnotes,
  computeOutlineSignature,
  outlineSignaturesEqual,
} from "../state";
import type { Block, BlockId, State, SuggestionView } from "../state";
import type { Style, ComputedStyle } from "../styles";
import type { AttrRegistry } from "../cascade/attr-registry";
import type { ComponentRegistry } from "../components/component-registry";
import {
  collectFootnoteAnchors,
  footnoteNumbers,
  EMPTY_FOOTNOTE_ANCHORS,
  type FootnoteNumber,
} from "../footnotes";
import type { RenderContext } from "./block-view";
import type { RenderNode } from "./render-node";
import type { RenderOutput } from "./render";
import { EMPTY_LIST_COUNTERS } from "./render";
import { renderBlockBody } from "./render-core";
import {
  buildCrossReferenceIndex,
  blockHasCrossReference,
} from "./collect-cross-references";
import {
  collectListEvents,
  computeCounters,
  listCounterRenumberedBlocks,
  type CounterValue,
} from "../numbering";
import { docHasLists, getListDefsForState } from "../state";
import {
  effectiveRenderPolicy,
  makeRenderContext,
  footnoteAnchorsUnchanged,
  EMPTY_FOOTNOTE_NUMBERS,
} from "./render-footnotes";

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
export function renderIncremental(
  state: State,
  componentRegistry: ComponentRegistry,
  attrRegistry: AttrRegistry,
  prev: RenderOutput,
  prevState: State,
  dirtyIds: ReadonlySet<BlockId>,
  footnoteNumbersOverride?: ReadonlyMap<BlockId, FootnoteNumber>,
  // Change-tracking preview view (slice 5c-iii). The incremental path assumes a
  // STABLE view across cycles (live editing is always "suggesting"); a view
  // SWITCH must go through the full `render()` path, since reused prev nodes were
  // built under the prior view. Threaded to `makeRenderContext` so a consistent-
  // view incremental render projects suggestions correctly.
  suggestionView: SuggestionView = "suggesting",
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

  // List-item markers: COMPUTE the counter map the same way render.ts's full
  // path does, so any list-item that gets re-rendered on this cycle (i.e. it's
  // in `invalidated` — e.g. the user typed inside it) bakes its CORRECT marker
  // rather than losing it. This is a render-time computation (position + defs),
  // independent of the incremental diff. The renumber DIFF that expands
  // `invalidated` to the FOLLOWING items whose numbers changed is applied
  // immediately below (mirroring the footnote renumber pass above).
  const listEvents = docHasLists(state) ? collectListEvents(state) : [];
  const listCounters =
    listEvents.length > 0
      ? computeCounters(listEvents, getListDefsForState(state))
      : EMPTY_LIST_COUNTERS;

  // List renumber diff (mirrors the footnote renumber pass above): an edit that
  // changes a FOLLOWING item's number — insert/delete/reorder/restart — affects
  // items that are NOT themselves in `dirtyIds`, so they'd otherwise be REUSED
  // from prev with a stale marker. Diff this cycle's counters against prev's and
  // force every number-changed list-item (and its ancestors, so the parent's
  // children array is rebuilt with the new marker) into the invalidation set.
  // A list-free doc has empty maps on both sides → the diff is empty → no cost.
  // Materialize the renumber set: the cross-reference expansion below needs to
  // test target membership in it (a number-mode ref to a list-item whose counter
  // shifted must re-render even though neither the ref host nor the target is in
  // dirtyIds).
  const listRenumbered = new Set<BlockId>(
    listCounterRenumberedBlocks(listCounters, prev.listCounters),
  );
  for (const blockId of listRenumbered) {
    if (invalidated.has(blockId)) continue;
    invalidated.add(blockId);
    addAncestorsToInvalidated(state, prevState, blockId, invalidated);
  }

  // Cross-reference target→hosts (XR.S4): a ref displays a target it does not
  // own, so when the target's VALUE changes this cycle the host's cached
  // RenderNode carries a stale resolved string — but the host's own block is not
  // in dirtyIds. Reuse the cached index unless a dirty block gained/lost/
  // retargeted a ref (a target edit/delete does NOT change the index, only the
  // resolved value), then invalidate every host whose target changed value:
  // targetId ∈ dirtyIds (edited / inserted / deleted-via-captureDirtyIds → text
  // mode + broken-ref transitions) OR targetId ∈ listRenumbered (number mode).
  const crossReferenceIndex = crossReferenceIndexUnchanged(state, prevState, dirtyIds)
    ? prev.crossReferenceIndex
    : buildCrossReferenceIndex(state);
  if (crossReferenceIndex.size > 0) {
    for (const [targetId, hosts] of crossReferenceIndex) {
      if (!dirtyIds.has(targetId) && !listRenumbered.has(targetId)) continue;
      for (const host of hosts) {
        if (invalidated.has(host)) continue;
        invalidated.add(host);
        addAncestorsToInvalidated(state, prevState, host, invalidated);
      }
    }
  }

  // TOC outline invalidation (mirrors the cross-reference target→hosts
  // expansion): a TOC derives its entries from the document outline, which it
  // does not own, so when a heading changed this cycle the cached TOC RenderNode
  // is stale even though the TOC block is not in dirtyIds. Reuse the cached
  // signature unless a dirty block is/was a heading; if it changed, force every
  // TOC anchor into `invalidated` so its render-core branch re-derives. Common
  // case (no heading edit) reuses the signature AND the TOC node by ref — O(1).
  const outlineChanged = outlineMightHaveChanged(state, prevState, dirtyIds);
  const outlineSignature = outlineChanged
    ? computeOutlineSignature(state, suggestionView)
    : prev.outlineSignature;
  if (
    outlineChanged &&
    outlineSignature.tocAnchorIds.size > 0 &&
    !outlineSignaturesEqual(outlineSignature, prev.outlineSignature)
  ) {
    for (const tocId of outlineSignature.tocAnchorIds) {
      if (invalidated.has(tocId)) continue;
      invalidated.add(tocId);
      addAncestorsToInvalidated(state, prevState, tocId, invalidated);
    }
  }

  const context: RenderContext = makeRenderContext(state, fnNumbers, listCounters, suggestionView);

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
    listCounters,
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
        listCounters,
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
        listCounters,
      ),
    );
  }

  // Always carry THIS cycle's anchors + numbers (reused or recomputed) so the
  // NEXT incremental cycle can reuse them.
  return Object.freeze({
    root,
    embedContents,
    templateContents,
    // 5c-iii: the incremental path runs ONLY when the view is unchanged (the
    // `render()` dispatch guard), so the output carries the same view as `prev`.
    suggestionView,
    footnoteAnchors: fnAnchors,
    footnoteNumbers: fnNumbers,
    listCounters,
    crossReferenceIndex,
    outlineSignature,
  });
}

/**
 * Whether a dirty block could have changed the document OUTLINE this cycle (a
 * heading was edited/inserted/deleted/re-leveled/re-typed/moved — every such op
 * dirties the heading block, or for a deletion captures its id). When false, no
 * heading changed, so the cached outline signature is reused and no TOC needs
 * re-derivation. Mirrors `crossReferenceIndexUnchanged`.
 */
function outlineMightHaveChanged(
  state: State,
  prevState: State,
  dirtyIds: ReadonlySet<BlockId>,
): boolean {
  for (const id of dirtyIds) {
    if (
      getBlock(state, id)?.type === "heading" ||
      getBlock(prevState, id)?.type === "heading"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the cross-reference target→hosts index can be reused from `prev`
 * unchanged. The index's CONTENT (which blocks hold refs to which targets)
 * changes only when a dirty block gained, lost, or retargeted a cross-reference
 * field — a target's own edit/delete does NOT alter the index (the host still
 * holds the same pointer; only the RESOLVED value changes, handled separately by
 * the invalidation expansion). So a cycle whose dirty blocks carry no cross-
 * reference in either new or prev state reuses the cached index without the
 * O(N_blocks) rebuild walk. Mirrors `footnoteAnchorsUnchanged`.
 */
function crossReferenceIndexUnchanged(
  state: State,
  prevState: State,
  dirtyIds: ReadonlySet<BlockId>,
): boolean {
  // Every render path (full + incremental) populates `prev.crossReferenceIndex`,
  // so there is always an index to reuse — the only question is whether a dirty
  // block changed it.
  for (const id of dirtyIds) {
    if (
      blockHasCrossReference(getBlock(state, id)) ||
      blockHasCrossReference(getBlock(prevState, id))
    ) {
      return false;
    }
  }
  return true;
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
  numbering: ReadonlyMap<BlockId, CounterValue>,
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

  return renderBlockBody(
    block,
    parentComputed,
    parentSpecified,
    state,
    componentRegistry,
    attrRegistry,
    context,
    visited,
    fnNumbers,
    numbering,
    (child, computed, specified) =>
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
        numbering,
      ),
  );
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

/**
 * Add every descendant of `id` (the whole subtree below it, via the
 * firstChild/nextSibling chain) to `out`, skipping any subtree already
 * present (its descendants are already covered).
 *
 * resolveBlock (main → embed → template) so descendants of a container body
 * nested in embedContents/templateContents are reached — main-tree behavior is
 * byte-identical (resolveBlock's first arm is getBlock). Uses NEW state only: a
 * removed block has no descendants to invalidate.
 */
function addDescendantsToInvalidated(
  state: State,
  id: BlockId,
  out: Set<BlockId>,
): void {
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
