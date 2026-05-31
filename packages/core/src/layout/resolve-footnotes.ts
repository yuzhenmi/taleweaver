/**
 * @module layout/resolve-footnotes
 *
 * The footnote layout pass. This module owns three layers:
 *
 *   1. Anchor→page ASSIGNMENT helpers (`buildBlockToTopLevelIndex`,
 *      `buildFootnotePageAssignment`): pure, side-effect-free. Given the ordered
 *      footnote anchors (from `collectFootnoteAnchors`) and a `PagePlan` (from
 *      `measurePass`), they decide WHICH page each footnote body belongs to.
 *      They do NOT lay out or split bodies.
 *
 *   2. Per-page slot FILL/SPLIT (`computeSlotLayout`, FN-5): greedy fill +
 *      line-boundary split + carry-all-overflow for ONE page's footnote slot.
 *      Given the inbound continuations (the prior page's carries) ++ the page's
 *      freshly-assigned bodies, it lays each into the bounded slot, splits the
 *      overflowing body at a line boundary, and returns the slot height + the
 *      fresh bodies that started + the ordered carries forward.
 *
 *   3. The PASS itself (`resolveFootnotes`, FN-4/FN-5): lay each page's assigned
 *      bodies into a bottom slot, reduce that page's body content area, and
 *      FORWARD-SWEEP the re-fit so later pages shift correctly — including
 *      single-page convergence (slot ⇄ which blocks fit), cross-page body
 *      SPLITTING + CONTINUATION (tail pages drain a tall footnote), the
 *      atomic-block rule for self-eviction, and the FN-4.4 incremental
 *      carry-forward reuse gate (`canReuseFootnotePage`).
 *
 * Scope note: a footnote anchor sits in a top-level leaf whose blockId IS a
 * `rootChildren` key, so a direct `Map<topLevelKey, index>` is all the
 * assignment needs. Anchors nested inside a NON-transparent container resolve
 * to `undefined` in the index and are skipped defensively (tracked as
 * FN-4-followup-A — not in scope).
 */
import type { ElementBox, RenderNode } from "../render/render-node";
import type { BlockId } from "../state";
import type { FootnoteAnchorRef } from "../footnotes";
import type { BlockFitMeta } from "./fit-core";
import { fitOnePage } from "./fit-core";
import type { LayoutContext } from "./layout-context";
import type { TextShaper } from "./text-shaper";
import type { PageConfig } from "./page-config";
import { layoutBlock } from "./bfc";
import type { BlockBox } from "./layout-box-v2";
import {
  buildPagePlan,
  EMPTY_FOOTNOTE_CONTINUATIONS,
  recordBlockMaps,
  type FootnoteContinuation,
  type PagePlan,
  type PagePlanEntry,
  type SlotInsets,
} from "./measure-pass";
import { pageConfigsEqual, sectionStateAt, type SectionPlan } from "./section-plan";
import type { BreakToken } from "./fragmentation";
import { isDevMode } from "./dev-mode";

// ---------------------------------------------------------------------------
// Test-only instrumentation: count footnote-body `layoutBlock` invocations from
// `resolveFootnotes` (the per-call body-height layout, NOT the materialize-pass
// slot render). FN-4.4's incremental carry-forward (the `prevResolvedPlan` reuse
// gate below) SKIPS laying out a page's footnote bodies + re-running the
// convergence loop for a page whose body inputs AND assigned-body refs AND
// per-page geometry are all unchanged. The incremental test asserts that an edit
// on a footnote-FREE page does NOT re-lay-out the footnote pages' bodies — i.e.
// this counter does not climb for the reused pages. Production pays one integer
// increment per body it actually lays out (negligible).
// ---------------------------------------------------------------------------

let _bodyLayoutCallCount = 0;

/** Test-only: number of footnote-body `layoutBlock` calls from `resolveFootnotes` since last reset. */
export function __getBodyLayoutCallCountForTest(): number {
  return _bodyLayoutCallCount;
}

/** Test-only: reset the footnote-body layout-call counter. */
export function __resetBodyLayoutCallCountForTest(): void {
  _bodyLayoutCallCount = 0;
}

/**
 * Height of the footnote SEPARATOR rule (FN-4): the thin horizontal line Google
 * Docs draws between the body content and the footnote slot. A fixed small value
 * (a hairline rule plus its vertical breathing room) — Google Docs uses a short
 * rule with a few px of gap above and below; ~13px (roughly one small line-box
 * of clearance) is a sensible default that keeps the bodies visually separated
 * from the main text without consuming a full line. The slot height includes
 * this once, above the stacked bodies. FN-4.3 renders the actual rule into the
 * slot at this height.
 */
export const FOOTNOTE_SEPARATOR_HEIGHT = 13;

/**
 * Minimum body content block-size the page must retain after the footnote slot
 * is reserved (FN-4, D5): the body keeps at least one line so a tall footnote
 * slot can never consume the whole page. The slot height is CLAMPED so that
 * `footnoteSlotHeight ≤ pageContentBlockSize − MIN_BODY_BLOCK_SIZE`. When bodies
 * would exceed that bound FN-4 lays out what fits and clamps (NO split — that is
 * FN-5; the clamp is the FN-5 seam). A small floor (~16px, roughly one default
 * line-height) matches "the body retains ≥1 line."
 */
export const MIN_BODY_BLOCK_SIZE = 16;

/** Hard cap on the convergence re-collect loop (D8); most pages converge in 1. */
const MAX_CONVERGENCE_ITERATIONS = 5;

/**
 * Map each top-level child's `key` (its `BlockId`) → its index in
 * `rootChildren`, in one pass. `ElementBox.key` is typed `string`; a top-level
 * child's key IS a `BlockId`, so the `key as BlockId` narrowing follows the
 * established layout convention (see `section-plan.ts`, `ifc.ts`).
 *
 * FN-4.2's convergence re-collect consumes this index to filter anchors by a
 * page's `[startIndex, startIndex + childrenCount)` slice;
 * `buildFootnotePageAssignment` uses it as the skip-when-nested guard.
 */
export function buildBlockToTopLevelIndex(
  rootChildren: readonly RenderNode[],
): Map<BlockId, number> {
  const map = new Map<BlockId, number>();
  rootChildren.forEach((child, i) => {
    map.set(child.key as BlockId, i);
  });
  return map;
}

/**
 * Assign each footnote body (`anchor.contentBlockId`) to the page that carries
 * its anchor, returning `pageIndex → contentBlockIds` in document order.
 *
 * `anchors` arrive pre-ordered in document order (from `collectFootnoteAnchors`),
 * so appending each body to its page's list preserves document order within a
 * page. For an anchor whose host block SPANS multiple pages, the body is
 * assigned to the FIRST page of the span (plan decision D4) via
 * `plan.pageSpanOfBlock(...).first` — NOT `pageIndexOfBlock`, which reports the
 * last (whole-block-progress) page.
 *
 * An anchor is SKIPPED (defensively) when:
 *   1. its `blockId` is absent from `blockToIndex` (anchor nested in a
 *      non-transparent container — FN-4-followup-A, out of FN-4 scope), or
 *   2. its host block has no resolvable page span (`pageSpanOfBlock` → `null`).
 */
export function buildFootnotePageAssignment(
  anchors: readonly FootnoteAnchorRef[],
  plan: PagePlan,
  blockToIndex: ReadonlyMap<BlockId, number>,
): Map<number, BlockId[]> {
  const result = new Map<number, BlockId[]>();
  for (const anchor of anchors) {
    // (1) Anchor not a top-level child (nested in a non-transparent container).
    // A footnote silently vanishing would be a no-MVP defect, so this is a
    // dev-only throw (graceful skip in production), matching the layout
    // module's dev-assert convention (see measurePass). FN-4 handles only
    // top-level-leaf anchors; the nested case is FN-4-followup-A — when a
    // non-transparent container that can host an anchor is added, this throw
    // forces that follow-up rather than letting the footnote disappear.
    if (!blockToIndex.has(anchor.blockId)) {
      if (isDevMode()) {
        throw new Error(
          `resolveFootnotes: footnote ${anchor.contentBlockId}: anchor block ` +
            `${anchor.blockId} is not a top-level child (nested in a ` +
            `non-transparent container). FN-4 supports top-level-leaf anchors ` +
            `only — see FN-4-followup-A.`,
        );
      }
      continue;
    }
    // (2) Resolve the FIRST page of the host block's span (D4). A top-level
    // child present in `blockToIndex` should ALWAYS have a span, so a `null`
    // here signals a structural inconsistency between rootChildren and the
    // PagePlan — a programmer error, dev-only throw (graceful skip in prod).
    const span = plan.pageSpanOfBlock(anchor.blockId);
    if (span === null) {
      if (isDevMode()) {
        throw new Error(
          `resolveFootnotes: footnote ${anchor.contentBlockId}: anchor block ` +
            `${anchor.blockId} has no resolvable page span — rootChildren / ` +
            `PagePlan inconsistency.`,
        );
      }
      continue;
    }
    const pageIndex = span.first;
    const list = result.get(pageIndex);
    if (list === undefined) {
      result.set(pageIndex, [anchor.contentBlockId]);
    } else {
      list.push(anchor.contentBlockId);
    }
  }
  return result;
}

/**
 * FN-5.3 — greedy fill + split + carry-all-overflow for ONE page's footnote
 * slot. Replaces FN-4's D5 height CLAMP with real splitting: lays the inbound
 * continuations (cross-page carries from the prior page) then the page's fresh
 * footnote bodies into the bounded slot area, in order; when a body doesn't
 * fully fit it splits at a line boundary (the IFC's `orphans/widows = 1`
 * footnote-body default makes a single line splittable, FN-5.2/E2) and carries
 * its remainder forward; once the slot is exhausted EVERY remaining item is
 * carried forward UNCHANGED (no body assigned to this page is ever lost —
 * Blocker-1).
 *
 * The slot is bounded to `pageContentBlockSize − MIN_BODY_BLOCK_SIZE −
 * FOOTNOTE_SEPARATOR_HEIGHT` (Blocker-2): the page body retains at least one
 * line beneath the slot, so a tall footnote can never starve the page content.
 *
 * Inputs:
 * @param inboundContinuations the prior page's outbound carries, IN ORDER, each
 *   `{ contentBlockId, resumeToken }` (a `null` `resumeToken` = a fully-deferred
 *   body that never started). These render at the TOP of this page's slot and
 *   are NEVER added to `slotContentBlockIds` (they render via the inbound list).
 * @param freshContentBlockIds the bodies whose anchors were freshly assigned to
 *   THIS page (document order). A fresh body that STARTS here (places ≥1 line)
 *   goes into `slotContentBlockIds`; a fresh body fully deferred (the slot
 *   overflowed before it) does NOT — it is carried in `outboundContinuations`
 *   with a `null` resume token and renders on the next page.
 * @param embedBodies the cascaded footnote-body boxes, keyed by body root id
 *   (`resolveFootnotes`'s `cascadedEmbedContents`).
 * @param pageContentBlockSize the page's body content block-size (before the
 *   slot reservation), used to bound the slot.
 * @param contentInlineSize the footnote-body content inline-size (the page
 *   content inline-size), threaded into the body-layout ctx exactly as
 *   `resolveFootnotes`'s per-body layout does.
 * @param ctx the root layout context; narrowed to `contentInlineSize` per body.
 * @param shaper the text shaper used to lay out the bodies.
 *
 * Returns `{ slotHeight, slotContentBlockIds, outboundContinuations }`:
 *   - `slotHeight` = sum of placed body heights + ONE `FOOTNOTE_SEPARATOR_HEIGHT`
 *     when ≥1 body placed, else `0` (no separator when nothing renders — E3/E4).
 *   - `slotContentBlockIds` = the FRESH bodies that STARTED on this page.
 *   - `outboundContinuations` = the ordered carries forward (partial bodies'
 *     remainders + every fully-deferred item), each a `FootnoteContinuation`.
 */
export function computeSlotLayout(
  inboundContinuations: readonly FootnoteContinuation[],
  freshContentBlockIds: readonly BlockId[],
  embedBodies: ReadonlyMap<BlockId, ElementBox>,
  pageContentBlockSize: number,
  contentInlineSize: number,
  ctx: LayoutContext,
  shaper: TextShaper,
): { slotHeight: number; slotContentBlockIds: BlockId[]; outboundContinuations: FootnoteContinuation[] } {
  // ONE ordered work-list: inbound carries (in order) then fresh bodies. Tag
  // each entry `isFresh` so only fresh-and-started ids land in
  // `slotContentBlockIds`; inbound items render via the inbound list and are
  // never re-added. The tag is dropped when an item becomes a `FootnoteContinuation`.
  interface WorkItem {
    readonly contentBlockId: BlockId;
    readonly resumeToken: BreakToken | null;
    readonly isFresh: boolean;
  }
  const workList: WorkItem[] = [];
  for (const c of inboundContinuations) {
    workList.push({ contentBlockId: c.contentBlockId, resumeToken: c.resumeToken, isFresh: false });
  }
  for (const id of freshContentBlockIds) {
    workList.push({ contentBlockId: id, resumeToken: null, isFresh: true });
  }

  // Blocker-2: reserve the body-content minimum AND the separator, so a tall
  // footnote can never consume the whole page.
  const maxSlot = Math.max(0, pageContentBlockSize - MIN_BODY_BLOCK_SIZE - FOOTNOTE_SEPARATOR_HEIGHT);
  let remaining = maxSlot;

  const placed: BlockBox[] = [];
  const placedIds: BlockId[] = [];
  const outbound: FootnoteContinuation[] = [];
  let overflowed = false;

  const bodyLayoutCtx: LayoutContext = { ...ctx, containingInlineSize: contentInlineSize };

  for (const item of workList) {
    if (overflowed) {
      // Past the split point: defer this item UNCHANGED (its resumeToken stays
      // whatever it was — a mid-body token for a not-re-placed partial inbound
      // item, or null for a never-started body). Do NOT lay it out.
      outbound.push({ contentBlockId: item.contentBlockId, resumeToken: item.resumeToken });
      continue;
    }

    const body = embedBodies.get(item.contentBlockId);
    if (body === undefined) {
      // A footnote whose body is missing from the cascaded map would be a no-MVP
      // defect (the body silently vanishing). Dev-only throw; in prod skip it
      // (contributes nothing, carries nothing) so layout never crashes — matching
      // `slotHeightFor`'s defensive convention.
      if (isDevMode()) {
        throw new Error(
          `computeSlotLayout: footnote body ${item.contentBlockId} is absent from ` +
            `embedBodies — the body must be cascaded before layout.`,
        );
      }
      continue;
    }

    _bodyLayoutCallCount++;
    const { box, breakToken } = layoutBlock(body, 0, 0, bodyLayoutCtx, shaper, {
      availableBlockSize: remaining,
      pageIndex: 0,
      resumeFrom: item.resumeToken,
    });

    // E3, nothing fit: the split point is BEFORE this item. `box === null` is the
    // direct "nothing placed" signal, but the CSS Fragmentation §3.5 C.6 overflow
    // rule force-places a body's first line onto an EMPTY fragment even when
    // `remaining` is below one line-height (each body is laid into its own fresh
    // `layoutBlock` fragment here, so it's always "empty" from C.6's view). We
    // detect that force-placed overflow by `box.blockSize > remaining` and treat
    // it as E3 too: per the plan, a footnote area below one line-height defers ALL
    // footnotes (the page body already retains MIN_BODY_BLOCK_SIZE via `maxSlot`),
    // overriding C.6's force-place. Either way the item carries forward UNCHANGED
    // and every subsequent item defers via the overflow branch above.
    if (box === null || box.blockSize > remaining) {
      outbound.push({ contentBlockId: item.contentBlockId, resumeToken: item.resumeToken });
      overflowed = true;
      continue;
    }

    // The body placed ≥1 line.
    placed.push(box);
    if (item.isFresh) placedIds.push(item.contentBlockId);
    remaining -= box.blockSize;

    if (breakToken !== null) {
      // Partial fit: the remainder carries forward; nothing else fits this page.
      outbound.push({ contentBlockId: item.contentBlockId, resumeToken: breakToken });
      overflowed = true;
    }
  }

  if (placed.length === 0) {
    // E3/E4: nothing rendered ⇒ no slot, no separator. The whole work-list is in
    // `outbound` (it flows to the next page); `slotHeight = 0` is the authoritative
    // gate `materializePage` keys on.
    return { slotHeight: 0, slotContentBlockIds: placedIds, outboundContinuations: outbound };
  }

  let bodiesSum = 0;
  for (const b of placed) bodiesSum += b.blockSize;
  return {
    slotHeight: bodiesSum + FOOTNOTE_SEPARATOR_HEIGHT,
    slotContentBlockIds: placedIds,
    outboundContinuations: outbound,
  };
}

/**
 * The footnote layout pass (FN-4.2): lay each page's assigned footnote bodies
 * into a slot at the page bottom, reduce that page's body content area by the
 * slot height, and FORWARD-SWEEP the re-fit so later pages' `startIndex`
 * shifts correctly (the same forward-carry shape as `measurePass`'s page loop).
 *
 * Footnote-free docs early-return `rawPlan` unchanged (ref-equal no-op, zero
 * cost). For a doc WITH footnotes, the algorithm (plan FN-4.2 + D1/D5/D7/D8):
 *
 *   1. Assign anchors to pages via `buildFootnotePageAssignment` (D4/D8).
 *   2. Copy entries BEFORE the first footnote page through unchanged.
 *   3. From the first footnote page forward, re-fit each page against
 *      `pageContentBlockSize − footnoteSlotHeight`, threading `startIndex` /
 *      `resumeInto` / `listCounterAtStart` from the prior re-fitted page. The
 *      slot height is the sum of the assigned bodies' laid-out heights +
 *      `FOOTNOTE_SEPARATOR_HEIGHT`, CLAMPED to the bounded area (D5). The
 *      `stopBeforeIndex` cap is RE-DERIVED via `sectionStateAt` at the new
 *      `startIndex` (D7), not copied from the stale raw entry.
 *   4. D8 convergence: after the re-fit, re-collect the page's anchors by the
 *      new `[startIndex, startIndex + childrenCount)` slice; if the assigned set
 *      changed, recompute the body layout + re-fit (cap `MAX_CONVERGENCE_ITERATIONS`).
 *
 * `effectiveBottomInset` is UNCHANGED (D1) — the footnote reservation lives only
 * in `footnoteSlotHeight`. The returned `PagePlan` is rebuilt via `buildPagePlan`
 * so its index methods (`pageIndexOfBlock`, `pageSpanOfBlock`, …) reflect the NEW
 * page boundaries.
 *
 * INCREMENTAL CARRY-FORWARD (FN-4.4): when `prevResolvedPlan` (the PRIOR cycle's
 * RESOLVED plan) is supplied, a swept page is REUSED — skipping its footnote-body
 * re-layout AND the convergence loop — when every input that determined its prior
 * resolution is provably unchanged at the CURRENT loop position (see
 * `canReuseFootnotePage`): the prior entry STARTS at this `startIndex`, its
 * `resumeInto` is structurally equal, its whole-block-progress `children` slice is
 * REFERENCE-equal to the current `rootChildren` slice, the assigned footnote
 * bodies (the `cascadedEmbedContents` lookups for the prior entry's
 * `footnoteContentBlockIds`) are REFERENCE-equal to the prior cycle's, and the
 * page's effective geometry (`pageConfig` + insets, from `sectionStateAt`) matches.
 * On a hit the prior entry's `footnoteSlotHeight` / `footnoteContentBlockIds` /
 * re-fit shape (`resumeOut`, children count) carry forward unchanged; the loop
 * state advances exactly as it would from a fresh re-fit. This mirrors
 * `measurePass`'s per-page reuse gate, so an edit on a footnote-FREE page does NOT
 * re-lay-out the unchanged footnote pages' bodies (FN-8 perf seam). Without
 * `prevResolvedPlan` every footnote page takes the full path.
 *
 * @param ctx the root layout context (writing-mode/direction/caches); narrowed
 *   to the page content inline-size per page for the body layout, exactly as
 *   `materializePage` does.
 * @param shaper the text shaper used to lay out the footnote bodies.
 * @param slotInsets per-section effective header/footer slot insets (#328),
 *   keyed by `activeSectionId` (D9). Each swept page derives its
 *   `effectiveTopInset`/`effectiveBottomInset` from the section active at the
 *   (possibly shifted) `startIndex` — `slotInsets.get(activeSectionId)` falling
 *   back to the section's raw effective page margins — EXACTLY as `measurePass`
 *   does. This makes a footnote that shifts blocks across a section boundary get
 *   the correct section's geometry. Absent/omitted for a section ⇒ raw margins.
 * @param docWidePageConfig the doc-wide `PageConfig` (D9) — the fallback when the
 *   section active at the new `startIndex` carries no `pageConfig` override
 *   (`st.pageConfig ?? docWidePageConfig`), mirroring `measurePass`'s
 *   `st.pageConfig ?? pageConfig`.
 */
export function resolveFootnotes(
  rawPlan: PagePlan,
  metas: readonly BlockFitMeta[],
  sectionPlan: SectionPlan,
  rootChildren: readonly RenderNode[],
  cascadedEmbedContents: ReadonlyMap<BlockId, ElementBox>,
  footnoteAnchors: readonly FootnoteAnchorRef[],
  ctx: LayoutContext,
  shaper: TextShaper,
  slotInsets: SlotInsets | undefined,
  docWidePageConfig: PageConfig,
  // FN-4.4: the PRIOR cycle's RESOLVED plan, for the incremental carry-forward
  // reuse gate. `undefined` for a fresh build / footnote-free prior tree.
  prevResolvedPlan?: PagePlan,
  // FN-4.4: the PRIOR cycle's cascaded footnote bodies (keyed by body root id).
  // The reuse gate compares a prior-assigned body's CURRENT ref against its prior
  // ref — ref-equal iff the body is unchanged (the cascade preserves refs). When
  // omitted (no prior tree) every page takes the full path. Defaults to an empty
  // map so a `prevResolvedPlan` without a paired prior map never spuriously
  // reuses (an absent prior body ref refuses reuse — see `canReuseFootnotePage`).
  prevCascadedEmbedContents: ReadonlyMap<BlockId, ElementBox> = new Map(),
): PagePlan {
  // (1) Footnote-free doc ⇒ ref-equal no-op (zero cost). The `prevResolvedPlan`
  // path never runs for a footnote-free doc — the early return fires first.
  if (footnoteAnchors.length === 0) return rawPlan;

  const blockToIndex = buildBlockToTopLevelIndex(rootChildren);
  const anchorsByPage = buildFootnotePageAssignment(footnoteAnchors, rawPlan, blockToIndex);

  // (3) Anchors all skipped (e.g. nested / no-span, graceful prod skip) ⇒ no
  // page carries a footnote ⇒ nothing to re-fit ⇒ ref-equal no-op.
  if (anchorsByPage.size === 0) return rawPlan;

  // First page that carries a footnote — the sweep's start. Entries before it
  // are copied through unchanged.
  let firstFootnotePage = Infinity;
  for (const pageIndex of anchorsByPage.keys()) {
    if (pageIndex < firstFootnotePage) firstFootnotePage = pageIndex;
  }
  // Defensive: assignment non-empty but no in-range page (cannot happen given
  // the map keys ARE page indices) ⇒ no-op.
  if (firstFootnotePage === Infinity) return rawPlan;

  // FN-4.4 incremental carry-forward: index the PRIOR cycle's RESOLVED entries by
  // `startIndex` so a swept page can look up its prior resolution in O(1) and skip
  // the body re-layout + convergence loop when nothing influencing it changed (see
  // `canReuseFootnotePage`). Mirrors `measurePass`'s `prevPlanIndexByStartIndex`.
  // We store the prior PLAN-INDEX (not the entry) so the reuse path can read the
  // NEXT prior entry's `listCounterAtStart` for the list-counter delta — exactly
  // as measurePass does — keeping the running counter byte-identical to a re-fit.
  //
  // FN-5.4 note: continuation-only TAIL pages all share `startIndex = metas.length`
  // (they carry no body blocks), so this map collapses them to the LAST one. That
  // is a CONSERVATIVE MISS, not a hazard: when the current loop hits an earlier
  // tail page its inbound list won't match the last prior tail page's, so
  // `canReuseFootnotePage` cond (6) refuses reuse and the page re-resolves (FN-8
  // is the perf-refinement task that would index tail pages distinctly).
  const prevResolvedIndexByStartIndex: Map<number, number> | null =
    prevResolvedPlan !== undefined ? new Map() : null;
  if (prevResolvedIndexByStartIndex !== null && prevResolvedPlan !== undefined) {
    for (let k = 0; k < prevResolvedPlan.entries.length; k++) {
      prevResolvedIndexByStartIndex.set(prevResolvedPlan.entries[k].startIndex, k);
    }
  }

  // FN-5.4: lay this page's footnote slot via `computeSlotLayout` — the greedy
  // fill + split + carry-all-overflow core that REPLACED FN-4's D5 height clamp.
  // It takes the page's INBOUND continuation list (the prior page's outbound
  // carries, rendered at the top of this slot) ++ the freshly-assigned fresh
  // bodies, lays each bounded by the remaining slot area, splits the overflowing
  // one at a line boundary, and returns `{ slotHeight, slotContentBlockIds
  // (fresh bodies STARTED here), outboundContinuations (carried forward) }`. The
  // convergence loop calls this once per iteration in place of FN-4's
  // `slotHeightFor`; the inbound list is a FIXED input per page (not part of the
  // fixpoint), so only the fresh-id set converges. Each `computeSlotLayout` lays
  // the bodies itself (bounded), so there is no separate height cache — the slot
  // height and the split/carry decisions are derived from the SAME layout.
  const slotLayoutFor = (
    inbound: readonly FootnoteContinuation[],
    freshContentBlockIds: readonly BlockId[],
    contentInlineSize: number,
    pageContentBlockSize: number,
  ): { slotHeight: number; slotContentBlockIds: BlockId[]; outboundContinuations: FootnoteContinuation[] } =>
    computeSlotLayout(
      inbound,
      freshContentBlockIds,
      cascadedEmbedContents,
      pageContentBlockSize,
      contentInlineSize,
      ctx,
      shaper,
    );

  // Re-collect a page's assigned footnotes by filtering anchors whose top-level
  // index falls in `[startIndex, startIndex + childrenCount)` (D8). Preserves
  // document order (anchors arrive pre-ordered). Used by the convergence loop;
  // the slice may differ from the raw `anchorsByPage` set after a re-fit shift.
  const collectForSlice = (startIndex: number, childrenCount: number): BlockId[] => {
    const end = startIndex + childrenCount;
    const ids: BlockId[] = [];
    for (const anchor of footnoteAnchors) {
      const idx = blockToIndex.get(anchor.blockId);
      if (idx === undefined) continue; // nested / out-of-scope (handled in dev throw at assignment time)
      if (idx >= startIndex && idx < end) ids.push(anchor.contentBlockId);
    }
    return ids;
  };

  const newEntries: PagePlanEntry[] = [];
  const blockToPage = new Map<string, number>();
  const blockToSpan = new Map<string, { first: number; last: number }>();

  // (2) Copy entries before the first footnote page through unchanged — both
  // the entry itself (ref-equal, geometry identical) AND its block-index
  // contributions (rebuilt via the SAME `recordBlockMaps` measurePass uses, so
  // the returned plan's methods are correct for these pages too).
  for (let p = 0; p < firstFootnotePage; p++) {
    const e = rawPlan.entries[p];
    newEntries.push(e);
    recordBlockMaps(
      e.children, rootChildren, metas, e.startIndex, e.pageIndex,
      e.resumeInto, e.resumeOut, blockToPage, blockToSpan,
    );
  }

  // Forward sweep from the first footnote page. Initialize the loop state from
  // that page's RAW entry (its boundary is still valid until the slot reduces
  // its space). We then thread `startIndex` / `resumeInto` / `listCounterAtStart`
  // forward from each re-fitted page, mirroring measurePass's page loop.
  const firstRaw = rawPlan.entries[firstFootnotePage];
  let startIndex = firstRaw.startIndex;
  let resumeInto = firstRaw.resumeInto;
  let listCounterAtStart = firstRaw.listCounterAtStart;
  let blockOffset = firstRaw.blockOffset;
  let pageIndex = firstFootnotePage;
  let sectionPageIndex = firstRaw.sectionPageIndex;
  let activeSectionId = firstRaw.activeSectionId;
  // FN-5.4: the INBOUND footnote continuations this page renders at the TOP of
  // its slot — the PRIOR page's `outboundContinuations`. The first footnote page
  // starts empty (no body has overflowed yet); each iteration stamps this onto
  // the emitted entry's `footnoteContinuation`, lays the slot via
  // `computeSlotLayout(inboundContinuations, freshIds, …)`, and advances it to
  // the resolved `outboundContinuations` for the next page.
  let inboundContinuations: readonly FootnoteContinuation[] = EMPTY_FOOTNOTE_CONTINUATIONS;

  // Hard page-count bound (defensive), mirroring measurePass: a correct re-fit
  // advances state every page. The footnote slot can only REDUCE the per-page
  // capacity (more pages), never remove blocks, so `metas.length * 2` bounds the
  // BODY-content pages. FN-5.4 adds continuation-only TAIL pages: a body taller
  // than an empty footnote area drains across extra pages, each placing ≥1 line.
  //
  // The tail-page bound MUST be LINE-based, not render-node-based. IFC
  // fragmentation splits at LINE boundaries, so a single splittable text node
  // (1–3 render nodes) with N lines produces ~N continuation pages — a render-
  // node count is NOT an upper bound on that chain and would FALSELY trip on a
  // long footnote in a VALID document (e.g. a 100-line footnote, 3 render nodes,
  // > 30 continuation pages). The sound bound is the footnote chain's total
  // CONTENT HEIGHT: each continuation/tail page drains ≥1 line, and every line is
  // ≥1px tall, so the number of tail pages ≤ ⌈totalFootnoteContentHeightPx⌉. We
  // compute that by laying out every referenced footnote body UNBOUNDED (its full
  // height) and summing. This is a loose-but-provably-finite ceiling that never
  // trips for a valid doc yet still catches a genuine non-progressing loop (a
  // page that placed no body content AND drained no footnote line).
  // The body's UNBOUNDED height only needs *a* finite inline-size to wrap
  // against; a different per-page inline-size (landscape section, etc.) changes
  // line wrapping but never makes the height infinite, so the doc-wide content
  // inline-size yields a sound finite ceiling for every page.
  const boundInlineSize =
    docWidePageConfig.pageInlineSize -
    docWidePageConfig.pageMargins.inlineStart -
    docWidePageConfig.pageMargins.inlineEnd;
  const heightCtx: LayoutContext = { ...ctx, containingInlineSize: boundInlineSize };
  const bodyHeightCache = new Map<BlockId, number>();
  const seenBodyRefs = new Set<BlockId>();
  let totalFootnoteContentHeight = 0;
  for (const a of footnoteAnchors) {
    if (seenBodyRefs.has(a.contentBlockId)) continue;
    seenBodyRefs.add(a.contentBlockId);
    const body = cascadedEmbedContents.get(a.contentBlockId);
    if (body === undefined) continue; // missing body: contributes 0 (dev-throws at slot layout)
    let h = bodyHeightCache.get(a.contentBlockId);
    if (h === undefined) {
      const { box } = layoutBlock(body, 0, 0, heightCtx, shaper, {
        availableBlockSize: Number.MAX_SAFE_INTEGER,
        pageIndex: 0,
        resumeFrom: null,
      });
      h = box?.blockSize ?? 0;
      bodyHeightCache.set(a.contentBlockId, h);
    }
    totalFootnoteContentHeight += h;
  }
  const maxPages = metas.length * 2 + Math.ceil(totalFootnoteContentHeight) + 2;

  for (;;) {
    if (pageIndex > maxPages) {
      throw new Error(
        `resolveFootnotes: page count exceeded safe bound (${maxPages}); a footnote ` +
          `re-fit failed to advance state.`,
      );
    }

    // Section state at the (possibly shifted) startIndex (D7 + D9). EVERYTHING
    // section-dependent — the page-break cap, the effective pageConfig, the
    // header/footer body ids, AND the effective slot insets — derives from the
    // section ACTIVE at `startIndex`, NOT from the raw entry at the same page
    // NUMBER. A footnote-driven block shift can move this page across a section
    // boundary, so its section membership (and thus its geometry) changes.
    const st = sectionStateAt(sectionPlan, startIndex);
    const sectionCap = st.nextBoundaryIndex;

    // This page's effective geometry (C.2b-2 + D9): the section's OWN pageConfig
    // (`st.pageConfig ?? docWidePageConfig`) + insets. Insets are derived EXACTLY
    // as `measurePass` does — `slotInsets.get(activeSectionId)` falling back to
    // the section's raw effective page margins. The body content area is
    // `pageBlockSize − topInset − bottomInset`; the footnote slot reduces it
    // further by `footnoteSlotHeight` (D1 — the insets themselves are UNCHANGED).
    const effCfg = st.pageConfig ?? docWidePageConfig;
    const sectionInsets = slotInsets?.get(st.activeSectionId ?? null);
    const effTopInset = sectionInsets?.top ?? effCfg.pageMargins.blockStart;
    const effBottomInset = sectionInsets?.bottom ?? effCfg.pageMargins.blockEnd;
    const pageContentBlockSize = effCfg.pageBlockSize - effTopInset - effBottomInset;
    const contentInlineSize =
      effCfg.pageInlineSize - effCfg.pageMargins.inlineStart - effCfg.pageMargins.inlineEnd;

    // FN-4.4 incremental carry-forward: try to REUSE this page's prior resolution
    // (skipping the body re-layout + convergence loop) when nothing influencing it
    // changed. On a hit we copy the prior entry's footnote slot + re-fit SHAPE and
    // skip straight to emitting the entry; on a miss we run the full path below.
    // These hold the resolved page's outputs from WHICHEVER path produced them.
    // Initialized to inert defaults so TS sees them definitely-assigned; BOTH the
    // reuse and the miss path overwrite every one before they're read below.
    let resolvedContentBlockIds: readonly BlockId[] = [];
    let resolvedSlotHeight = 0;
    // FN-5.4: the OUTBOUND footnote continuations this page carries to the next
    // (the next page's inbound). The miss path takes it from `computeSlotLayout`;
    // the reuse path reproduces it from the prior NEXT entry's inbound list (the
    // gate proves this page's inputs are identical, so the prior cycle's outbound
    // is reproduced byte-for-byte — and the prior cycle STAMPED it as the prior
    // next page's `footnoteContinuation`).
    let resolvedOutboundContinuations: readonly FootnoteContinuation[] = EMPTY_FOOTNOTE_CONTINUATIONS;
    let resolvedStopBeforeIndex: number | undefined = undefined;
    let resolvedResumeOut: BreakToken | null = null;
    // The next page's `listCounterAtStart` seed (this page's `listCounterAtEnd`).
    let resolvedListCounterAtEnd = listCounterAtStart;
    // Whole-block-progress child count placed on this page (slice length basis).
    let resolvedChildrenCount = 0;
    let reused = false;

    if (prevResolvedIndexByStartIndex !== null && prevResolvedPlan !== undefined) {
      const prevK = prevResolvedIndexByStartIndex.get(startIndex);
      const prevEntry = prevK !== undefined ? prevResolvedPlan.entries[prevK] : undefined;
      const prevNext = prevK !== undefined ? prevResolvedPlan.entries[prevK + 1] : undefined;
      if (
        prevEntry !== undefined &&
        canReuseFootnotePage(
          prevEntry, prevNext, resumeInto, effCfg, effTopInset, effBottomInset,
          rootChildren, startIndex, metas.length, sectionCap, cascadedEmbedContents,
          prevCascadedEmbedContents, inboundContinuations,
        )
      ) {
        reused = true;
        resolvedContentBlockIds = prevEntry.footnoteContentBlockIds;
        resolvedSlotHeight = prevEntry.footnoteSlotHeight;
        // The prior cycle's outbound for THIS page was stamped as the prior NEXT
        // page's inbound (`prevNext.footnoteContinuation`). The gate proved this
        // page's inbound + bodies + geometry are identical, so `computeSlotLayout`
        // would reproduce that exact outbound — read it off the prior next entry
        // (empty when the prior page ended the document; the loop breaks then).
        resolvedOutboundContinuations =
          prevNext?.footnoteContinuation ?? EMPTY_FOOTNOTE_CONTINUATIONS;
        // Re-stamp the cap from the CURRENT section cap (NOT the prior entry's
        // stale copy), matching the miss path's section-only cap (no footnote
        // tightening applies on a reuse hit — a reused page carries no fresh
        // footnote-driven atomic cap). The gate above guarantees
        // `sectionCap === prevEntry.stopBeforeIndex` here, so this equals the
        // prior value; re-stamping from the current cap is the measurePass-
        // consistent pattern (defends against any future gate relaxation), the
        // same way measurePass's reuse path stamps `st.nextBoundaryIndex`.
        resolvedStopBeforeIndex = tightenCap(sectionCap, undefined);
        resolvedResumeOut = prevEntry.resumeOut;
        resolvedChildrenCount = prevEntry.children.length;
        // The page's list-counter INCREMENT is a pure function of its (proved
        // identical) content; reading it off the prior plan as
        // `prevNext.listCounterAtStart − prevEntry.listCounterAtStart` reproduces
        // the real fit's `listCounterAtEnd`, applied to the CURRENT running seed —
        // exactly as measurePass's reuse path. When the prior page ended the
        // document (`resumeOut === null`) there is no next page, so the delta is 0
        // (the value is unused — the loop breaks below).
        const listCounterDelta =
          prevNext !== undefined ? prevNext.listCounterAtStart - prevEntry.listCounterAtStart : 0;
        resolvedListCounterAtEnd = listCounterAtStart + listCounterDelta;
      }
    }

    // D8 convergence: a footnote belongs to the page where its ANCHOR BLOCK is
    // PLACED, and the page reserves slot space for exactly those footnotes. That
    // is a fixpoint (slot ⇄ which blocks fit), reached by iterating
    // collect → slot → re-fit → re-collect until the assigned set is stable.
    //
    // Seed the candidate set from BOTH the raw page assignment AND a no-slot fit
    // (so a footnote the raw plan put on a LATER page, whose anchor block has
    // since shifted onto THIS page, is considered). Most pages converge in one
    // iteration (the neighbor-eviction case: a footnote evicts a footnote-FREE
    // neighbor — the anchor block stays, the set is stable immediately).
    //
    // Self-eviction (a footnote whose slot evicts its OWN anchor block) has NO
    // stable single-page fixpoint — placing the block forces the slot, which
    // evicts the block. It manifests as a 2-cycle (set toggles). We break it by
    // the atomic-block rule (matches Google Docs): the contested anchor block
    // travels WITH its footnote to the next page. We cap THIS page before that
    // block (`footnoteCap`), so the block + footnote are picked up together by
    // the next sweep page — neither the block nor its footnote is ever lost.
    if (reused) {
      // Reuse path: every resolved output was copied from the prior entry above.
      // Nothing further to compute — fall through to the entry emission below.
    } else {
    const seedNoSlotFit = fitOnePage(
      metas, startIndex, resumeInto,
      pageContentBlockSize, listCounterAtStart,
      sectionCap ?? undefined,
    );
    let contentBlockIds = unionIds(
      anchorsByPage.get(pageIndex) ?? [],
      collectForSlice(startIndex, seedNoSlotFit.childrenCount),
    );
    let footnoteSlotHeight = 0;
    // FN-5.4: the FINAL slot layout (fresh-started ids + outbound carries) from
    // the last `computeSlotLayout` call, used after convergence to stamp the
    // entry's `footnoteContentBlockIds` (= fresh STARTED here) + threaded forward
    // as the next page's inbound. Recomputed each iteration alongside the height.
    let slotResult: { slotHeight: number; slotContentBlockIds: BlockId[]; outboundContinuations: FootnoteContinuation[] } =
      { slotHeight: 0, slotContentBlockIds: [], outboundContinuations: [] };
    // The effective stop cap = the section cap tightened by any footnote-driven
    // atomic cap discovered on a cycle. `undefined` ⇒ no cap beyond section.
    let footnoteCap: number | undefined = undefined;
    let fit = seedNoSlotFit;
    const seen: string[] = [];
    // The `MAX_CONVERGENCE_ITERATIONS` cap is a DEFENSIVE bound, not an expected
    // operating point. The slot ⇄ blocks relationship is monotone/contracting
    // (reserving slot space can only EVICT blocks, never add them, and a smaller
    // placed set can only SHRINK the slot), so with correct block structure the
    // loop settles in ≤2 useful iterations: one to find the eviction, one to
    // detect a 2-cycle (self-eviction) and apply the atomic-block cap. >3
    // iterations are unreachable; the cap exists only to bound a hypothetical
    // future regression that broke the monotonicity invariant.
    for (let iter = 0; iter < MAX_CONVERGENCE_ITERATIONS; iter++) {
      slotResult = slotLayoutFor(
        inboundContinuations, contentBlockIds, contentInlineSize, pageContentBlockSize,
      );
      footnoteSlotHeight = slotResult.slotHeight;
      const effCap = tightenCap(sectionCap, footnoteCap);
      fit = fitOnePage(
        metas, startIndex, resumeInto,
        pageContentBlockSize - footnoteSlotHeight, listCounterAtStart,
        effCap,
      );
      const recollected = collectForSlice(startIndex, fit.childrenCount);
      if (sameIds(recollected, contentBlockIds)) break;

      const key = recollected.join("|");
      if (seen.includes(key)) {
        // 2-cycle (self-eviction): the set toggles because a footnote's anchor
        // block is the marginal one the slot evicts. Apply the atomic rule —
        // cap before the FIRST footnote anchor block in the union of the cycle's
        // sets that the slot-reduced fit cannot place, so block + footnote move
        // forward together. Recompute with the tightened cap, then settle.
        const contested = firstContestedAnchorIndex(
          unionIds(contentBlockIds, recollected),
          footnoteAnchors, blockToIndex, startIndex, fit.childrenCount,
        );
        if (contested !== undefined && (footnoteCap === undefined || contested < footnoteCap)) {
          footnoteCap = contested;
          // Drop the now-excluded footnotes and re-fit once more with the cap.
          // The slot may still evict a block WITHIN the capped range, so the
          // authoritative set is re-collected from the FINAL fitted slice (not
          // the pre-fit `[startIndex, contested)` range) — never over-claiming a
          // footnote whose block didn't end up placed.
          contentBlockIds = collectForSlice(startIndex, contested - startIndex);
          slotResult = slotLayoutFor(
            inboundContinuations, contentBlockIds, contentInlineSize, pageContentBlockSize,
          );
          footnoteSlotHeight = slotResult.slotHeight;
          fit = fitOnePage(
            metas, startIndex, resumeInto,
            pageContentBlockSize - footnoteSlotHeight, listCounterAtStart,
            tightenCap(sectionCap, footnoteCap),
          );
          contentBlockIds = collectForSlice(startIndex, fit.childrenCount);
        }
        break;
      }
      seen.push(key);
      contentBlockIds = recollected;
    }

    // Dev invariant: the stamped `footnoteSlotHeight` MUST equal the slot height
    // a FINAL `computeSlotLayout` produces from the FINAL `contentBlockIds` +
    // inbound list. If the loop exhausted its cap without converging (a real
    // multi-cycle — unreachable with correct block structure per the monotonicity
    // note above), `footnoteSlotHeight` would be left over from an earlier
    // iteration's set and disagree with the bodies that actually get a slot. Catch
    // that loudly in dev; prod stays graceful. (The final `slotResult` was already
    // computed from the FINAL `contentBlockIds` in the loop's last iteration, so a
    // fresh call here re-derives the same height — the cross-check is cheap.)
    if (isDevMode()) {
      const expected = slotLayoutFor(
        inboundContinuations, contentBlockIds, contentInlineSize, pageContentBlockSize,
      );
      if (footnoteSlotHeight !== expected.slotHeight) {
        throw new Error(
          `resolveFootnotes: footnoteSlotHeight (${footnoteSlotHeight}) is ` +
            `inconsistent with the final contentBlockIds slot ` +
            `(${expected.slotHeight}) on page ${pageIndex} — convergence did not ` +
            `settle (a real multi-cycle broke the slot↔blocks monotonicity ` +
            `invariant).`,
        );
      }
    }

    // Publish the miss path's outputs into the shared resolved* vars (the reuse
    // path published them above). `footnoteContentBlockIds` is now the FRESH
    // bodies that STARTED on this page (`slotResult.slotContentBlockIds`), NOT the
    // raw assigned set — a fresh body fully deferred is excluded here and carried
    // in `outboundContinuations` (the next page's inbound) instead (FN-5 semantic).
    resolvedContentBlockIds = slotResult.slotContentBlockIds;
    resolvedOutboundContinuations = slotResult.outboundContinuations;
    resolvedSlotHeight = footnoteSlotHeight;
    resolvedStopBeforeIndex = tightenCap(sectionCap, footnoteCap);
    resolvedResumeOut = fit.resumeOut;
    resolvedChildrenCount = fit.childrenCount;
    resolvedListCounterAtEnd = fit.listCounterAtEnd;
    } // end miss path

    const nextStartIndex =
      resolvedResumeOut !== null && resolvedResumeOut.type === "block"
        ? resolvedResumeOut.resumeChildIndex
        : startIndex + resolvedChildrenCount;
    const sliceEnd = resolvedResumeOut === null ? metas.length : nextStartIndex;
    const children: readonly RenderNode[] = rootChildren.slice(startIndex, sliceEnd);

    newEntries.push({
      pageIndex,
      blockOffset,
      blockSize: effCfg.pageBlockSize,
      pageConfig: effCfg,
      children,
      startIndex,
      resumeInto,
      resumeOut: resolvedResumeOut,
      listCounterAtStart,
      activeSectionId,
      sectionPageIndex,
      // Cap re-derived at this page's startIndex (D7) on BOTH paths: the miss
      // path tightens the section cap by any footnote atomic cap; the reuse path
      // re-stamps from the CURRENT section cap (the gate proved it equals the
      // prior entry's cap), never the prior entry's possibly-stale copy.
      stopBeforeIndex: resolvedStopBeforeIndex ?? null,
      // Header/footer body ids for THIS page (C.2c + D9): from the section
      // ACTIVE at the new `startIndex` (`st`), NOT the raw entry at the same page
      // NUMBER — a footnote-driven shift can move the page to a different section.
      headerBlockId: st.headerBlockId,
      footerBlockId: st.footerBlockId,
      // effectiveBottomInset UNCHANGED (D1) — the slot reservation lives only in
      // footnoteSlotHeight.
      effectiveTopInset: effTopInset,
      effectiveBottomInset: effBottomInset,
      footnoteContentBlockIds: resolvedContentBlockIds,
      footnoteSlotHeight: resolvedSlotHeight,
      // FN-5.4: the INBOUND footnote continuations this page renders at the TOP of
      // its slot (the PRIOR page's outbound). `materializePage` (FN-5.5) reads this
      // to lay the carried bodies' remainders before the fresh ones. Empty on a
      // page that STARTS its footnotes (no body has overflowed into it yet).
      footnoteContinuation: inboundContinuations,
    });

    recordBlockMaps(
      children, rootChildren, metas, startIndex, pageIndex,
      resumeInto, resolvedResumeOut, blockToPage, blockToSpan,
    );

    // Advance the running-sum document-y by THIS page's height + gap (C.2b-2).
    blockOffset += effCfg.pageBlockSize + effCfg.pageGap;

    // FN-5.4: the sweep continues while there is MORE to place — either body
    // content (`resolvedResumeOut !== null`) OR pending footnote continuations
    // (`resolvedOutboundContinuations` non-empty). A body taller than a whole
    // empty footnote area drains across continuation-only tail pages (no body
    // content; the carried footnote remainder rendered at the top of each slot)
    // until the chain empties — the "spans 3+ pages" edge (spec §3.3). When BOTH
    // are exhausted the document is fully laid out.
    if (resolvedResumeOut === null && resolvedOutboundContinuations.length === 0) break;

    // Thread loop state forward (mirrors measurePass). Section-state (active id +
    // within-section page index) is recomputed at the next startIndex so a swept
    // page that crossed a section boundary tags the correct section.
    pageIndex++;
    if (resolvedResumeOut !== null) {
      // Normal advance: body content continues onto the next page (which ALSO
      // renders this page's outbound footnote carries at the top of its slot).
      startIndex = nextStartIndex;
      resumeInto = resolvedResumeOut;
    } else {
      // Body content is DONE but footnotes remain: emit a continuation-only tail
      // page. It carries NO body blocks (`startIndex` at the document end, a
      // fresh `resumeInto`), only the inbound footnote remainder.
      startIndex = metas.length;
      resumeInto = null;
    }
    listCounterAtStart = resolvedListCounterAtEnd;
    // FN-5.4: thread THIS page's outbound carries forward as the NEXT page's
    // inbound continuation list (rendered at the top of its slot).
    inboundContinuations = resolvedOutboundContinuations;
    const nextSt = sectionStateAt(sectionPlan, startIndex);
    if (nextSt.activeSectionId !== activeSectionId) {
      sectionPageIndex = 0;
    } else {
      sectionPageIndex += 1;
    }
    activeSectionId = nextSt.activeSectionId;
  }

  // Rebuild a fully-functional PagePlan whose index methods reflect the NEW page
  // boundaries (the same construction measurePass uses, via buildPagePlan).
  return buildPagePlan(
    newEntries,
    rawPlan.sectionPlan,
    // Reuse the raw plan's doc-wide geometry: `pageInlineSize` (the plan-wide
    // page inline-size) + the doc-wide `pageContentBlockSize` (the coarse
    // carry-forward guard) are unaffected by footnote reservation, which only
    // reduces per-entry body space.
    rawPlan.pageInlineSize,
    rawPlan.pageContentBlockSize,
    blockToPage,
    blockToSpan,
  );
}

/** Order-sensitive equality of two footnote-id lists (document order is the contract). */
function sameIds(a: readonly BlockId[], b: readonly BlockId[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Structural break-token equality (references differ across measure cycles, so
 * `===` would always miss). Recurses through `block` tokens' nested
 * `resumeChildToken`. Mirrors the equality `measure-pass.ts` uses for its reuse
 * gate; FN-4.4's `canReuseFootnotePage` compares the prior resolved entry's
 * `resumeInto` to the current loop's `resumeInto` with it.
 */
function breakTokensEqual(a: BreakToken | null, b: BreakToken | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.type !== b.type) return false;
  if (a.type === "block" && b.type === "block") {
    return (
      a.resumeChildIndex === b.resumeChildIndex &&
      breakTokensEqual(a.resumeChildToken, b.resumeChildToken)
    );
  }
  if (a.type === "ifc" && b.type === "ifc") return a.resumeAtLine === b.resumeAtLine;
  if (a.type === "table" && b.type === "table") return a.resumeAtRow === b.resumeAtRow;
  return false;
}

/**
 * FN-4.4 incremental carry-forward reuse gate: decide whether a swept page's
 * PRIOR resolution (`prevEntry`, from the prior cycle's resolved plan) may be
 * reused at the current loop position — skipping its footnote-body re-layout AND
 * the convergence loop. Mirrors `measurePass`'s `canReusePage`, extended with the
 * footnote-specific inputs (the slot's assigned-body refs). Reuse is sound ONLY
 * when EVERY input that determined the prior page's resolution is identical now:
 *
 *   0. The CURRENT section cap (`sectionCap`, the page-break cap the re-fit was
 *      built against) equals the prior entry's `stopBeforeIndex`. A `SECTION_BREAK`
 *      can move a boundary into this page's range without touching its geometry or
 *      body refs; reusing then would emit a STALE cap and leak the wrong section's
 *      blocks onto the page. Mirrors `measurePass.canReusePage`'s cap check.
 *   1. The prior entry STARTS at this `startIndex` (the caller's O(1) index
 *      lookup guarantees this; re-checked implicitly by the slice compare).
 *   2. Its `resumeInto` is STRUCTURALLY equal to the current `resumeInto` (same
 *      continuation state INTO the page; references differ across cycles).
 *   3. The page's EFFECTIVE geometry is unchanged: `pageConfig` field-equal (deep
 *      compare — references differ across cycles) AND the grown insets
 *      (`effectiveTopInset` / `effectiveBottomInset`) equal. The body re-fit and
 *      the slot clamp both depend on the content block-size these determine, so a
 *      section-geometry or header/footer-height change must force a re-resolve.
 *   4. Every child that INFLUENCED the prior re-fit — the whole-block-progress
 *      slice AND a mid-fragment child at the resume-out index — is REFERENCE-equal
 *      to the current `rootChildren` (the cascade preserves refs for unchanged
 *      blocks). When the prior page ended the document (`resumeOut === null`) the
 *      slice must still reach the CURRENT document end (no blocks appended past
 *      it), else appended blocks would be silently dropped.
 *   5. The assigned footnote BODIES are unchanged: each `prevEntry`-assigned id's
 *      CURRENT `cascadedEmbedContents` lookup is REFERENCE-equal to the PRIOR
 *      cycle's lookup (`prevCascadedEmbedContents`). The prior cycle resolved its
 *      `footnoteSlotHeight` against the prior refs; the cascade preserves a body's
 *      ElementBox ref across cycles iff the body is UNCHANGED, so ref-equality is
 *      the exact change signal. A body edit yields a NEW cascaded ElementBox for
 *      the same id → the refs differ → re-resolve so the slot height reflects the
 *      new body. A missing body (current OR prior) refuses reuse defensively — a
 *      slot built from an absent body can't be trusted. (The TREE-level
 *      `PageFingerprint` ALSO carries the body refs, so a body edit re-materializes
 *      the page; this gate keeps the PLAN's slot HEIGHT correct in lockstep.)
 *   6. (FN-5.4 E6(a)) The INBOUND footnote continuation list is unchanged: the
 *      prior entry's `footnoteContinuation` (what it rendered at the top of its
 *      slot) equals the current `inboundContinuations` ELEMENT-WISE — same length,
 *      each element same `contentBlockId` AND structurally-equal `resumeToken` (via
 *      `breakTokensEqual`). A change to the PRIOR page's split point moves where a
 *      body resumes, changing this page's inbound; reusing then would lay the slot
 *      from a stale carry. The inbound BODIES' refs are ALSO checked (same
 *      ref-equality signal as cond 5) so a continued body's edit forces a
 *      re-resolve even when the resume token is unchanged.
 */
function canReuseFootnotePage(
  prevEntry: PagePlanEntry,
  prevNext: PagePlanEntry | undefined,
  resumeInto: BreakToken | null,
  effCfg: PageConfig,
  effTopInset: number,
  effBottomInset: number,
  rootChildren: readonly RenderNode[],
  startIndex: number,
  metasLength: number,
  sectionCap: number | null,
  cascadedEmbedContents: ReadonlyMap<BlockId, ElementBox>,
  prevCascadedEmbedContents: ReadonlyMap<BlockId, ElementBox>,
  inboundContinuations: readonly FootnoteContinuation[],
): boolean {
  // (0) Section cap unchanged. The prior entry's `stopBeforeIndex` is the cap its
  // re-fit was built against (the section cap tightened by any footnote-driven
  // atomic cap). A `SECTION_BREAK` can move a section boundary into this page's
  // range WITHOUT changing the page's geometry or body refs, so every OTHER gate
  // field would still match while the CURRENT section cap differs — reusing the
  // prior entry would emit a STALE `stopBeforeIndex` that leaks the wrong
  // section's blocks onto the page (`materializePage` threads it into
  // `bfc.layoutBlock`). Mirror `measurePass.canReusePage`'s `sectionStatesEqual`
  // cap check: refuse reuse unless the CURRENT section cap equals what the prior
  // entry was capped at. (`fitOnePage`/the convergence loop both normalize a
  // null section cap to `undefined`, so compare against `?? null`.)
  //
  // CONSERVATIVE MISS: this ALSO refuses reuse for a prior page whose cap was
  // footnote-TIGHTENED below the section cap (a self-eviction atomic-cap page),
  // since `prevEntry.stopBeforeIndex` would then be < `sectionCap` even when the
  // section is unchanged. Those rare pages simply re-resolve — an acceptable
  // conservative miss (FN-8 is the perf-refinement task), never a correctness
  // hazard.
  if ((sectionCap ?? null) !== prevEntry.stopBeforeIndex) return false;

  // (2) resumeInto structural-equality.
  if (!breakTokensEqual(prevEntry.resumeInto, resumeInto)) return false;

  // (3) Effective geometry unchanged.
  if (!pageConfigsEqual(effCfg, prevEntry.pageConfig)) return false;
  if (effTopInset !== prevEntry.effectiveTopInset) return false;
  if (effBottomInset !== prevEntry.effectiveBottomInset) return false;

  // (4) Body-input child refs unchanged (whole-block slice + mid-fragment child).
  const sliceLen = prevEntry.children.length;
  if (startIndex + sliceLen > rootChildren.length) return false;
  for (let i = 0; i < sliceLen; i++) {
    if (rootChildren[startIndex + i] !== prevEntry.children[i]) return false;
  }
  if (prevEntry.resumeOut === null) {
    // Prior page ended the document: reusable only if it still does (no append).
    if (startIndex + sliceLen !== metasLength) return false;
  } else if (prevEntry.resumeOut.type === "block") {
    // A child resuming onto the NEXT page placed content on THIS page that shaped
    // `resumeOut`. It sits at the slice end and is omitted from `children`, so
    // verify it via the prior NEXT entry's first child (the prior node at K).
    const k = prevEntry.resumeOut.resumeChildIndex;
    if (k < 0 || k >= rootChildren.length) return false;
    if (prevNext === undefined || prevNext.children.length === 0) return false;
    if (prevNext.startIndex !== k) return false;
    if (rootChildren[k] !== prevNext.children[0]) return false;
  } else {
    // Bare ifc/table resumeOut is unreachable at the top level (the doc root is a
    // block FC, so fitOnePage always wraps a leaf token in a top-level block
    // token). Refuse reuse conservatively if one ever surfaces.
    return false;
  }

  // (5) Assigned footnote BODIES unchanged: each prior-assigned id's CURRENT body
  // ref must equal the PRIOR cycle's body ref. A missing body (current OR prior)
  // refuses reuse defensively — a slot built from an absent body can't be trusted.
  for (const id of prevEntry.footnoteContentBlockIds) {
    const current = cascadedEmbedContents.get(id);
    const prior = prevCascadedEmbedContents.get(id);
    if (current === undefined || prior === undefined) return false;
    if (current !== prior) return false;
  }

  // (6) FN-5.4 E6(a): the INBOUND continuation list is unchanged. Element-wise
  // compare the prior entry's `footnoteContinuation` (what it rendered at the top
  // of its slot) against the current `inboundContinuations`: same length, each
  // element same `contentBlockId` + structurally-equal `resumeToken`. A change to
  // the PRIOR page's split point moves where a carried body resumes, changing this
  // page's inbound — reusing then would lay the slot from a stale carry. Also
  // verify the inbound BODIES' refs (the same ref-equality change signal as cond 5)
  // so a continued body's edit forces a re-resolve even at an unchanged split point.
  const prevInbound = prevEntry.footnoteContinuation;
  if (prevInbound.length !== inboundContinuations.length) return false;
  for (let i = 0; i < prevInbound.length; i++) {
    const a = prevInbound[i];
    const b = inboundContinuations[i];
    if (a.contentBlockId !== b.contentBlockId) return false;
    if (!breakTokensEqual(a.resumeToken, b.resumeToken)) return false;
    const current = cascadedEmbedContents.get(b.contentBlockId);
    const prior = prevCascadedEmbedContents.get(a.contentBlockId);
    if (current === undefined || prior === undefined) return false;
    if (current !== prior) return false;
  }

  return true;
}

/**
 * Union of two footnote-id lists preserving `a`'s order, then appending any of
 * `b` not already present (document order is preserved within each since both
 * arrive pre-ordered and disjoint additions append). Used to seed the
 * convergence candidate set and to gather a 2-cycle's contested footnotes.
 */
function unionIds(a: readonly BlockId[], b: readonly BlockId[]): BlockId[] {
  const out = [...a];
  for (const id of b) if (!out.includes(id)) out.push(id);
  return out;
}

/**
 * Tighten the section cap by the footnote cap: an EXCLUSIVE upper bound on the
 * top-level child index this page may place is the MIN of the two (whichever
 * stops the page earlier). `undefined` ⇒ no cap. Mirrors `fitOnePage`'s
 * stopBeforeIndex contract.
 */
function tightenCap(sectionCap: number | null, footnoteCap: number | undefined): number | undefined {
  if (sectionCap === null && footnoteCap === undefined) return undefined;
  if (sectionCap === null) return footnoteCap;
  if (footnoteCap === undefined) return sectionCap;
  return Math.min(sectionCap, footnoteCap);
}

/**
 * The top-level index of the FIRST footnote anchor (among `candidateIds`) whose
 * anchor block is NOT inside the page's fitted slice `[startIndex, startIndex +
 * childrenCount)`. That block is the contested one in a self-eviction 2-cycle —
 * its footnote slot evicts the block itself — so the page is capped before it,
 * and the block + footnote travel forward together (the atomic-block rule).
 * `undefined` when every candidate's block is already placed (no contest).
 */
function firstContestedAnchorIndex(
  candidateIds: readonly BlockId[],
  footnoteAnchors: readonly FootnoteAnchorRef[],
  blockToIndex: ReadonlyMap<BlockId, number>,
  startIndex: number,
  childrenCount: number,
): number | undefined {
  const placedEnd = startIndex + childrenCount;
  let contested: number | undefined = undefined;
  for (const anchor of footnoteAnchors) {
    if (!candidateIds.includes(anchor.contentBlockId)) continue;
    const idx = blockToIndex.get(anchor.blockId);
    if (idx === undefined) continue;
    // The block is OUTSIDE the placed slice — its footnote was reserved but the
    // block didn't fit. Cap before the EARLIEST such block (must be > startIndex
    // so the page still places ≥1 block — `fitOnePage` normalizes a cap ≤
    // startIndex to no-cap, but capping at the page's first block would loop).
    if (idx >= placedEnd && idx > startIndex && (contested === undefined || idx < contested)) {
      contested = idx;
    }
  }
  return contested;
}
