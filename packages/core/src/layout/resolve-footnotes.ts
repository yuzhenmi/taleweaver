/**
 * @module layout/resolve-footnotes
 *
 * Pure anchor→page assignment helpers for the footnote layout pass (FN-4).
 *
 * These two functions are the side-effect-free core that FN-4.2's
 * `resolveFootnotes` composes: given the ordered footnote anchors (from
 * `collectFootnoteAnchors`) and a `PagePlan` (from `measurePass`), they decide
 * WHICH page each footnote body belongs to. They do NOT lay out or split
 * bodies — that is `resolveFootnotes`'s job, built on top of this assignment.
 *
 * Scope note (FN-4): a footnote anchor sits in a top-level leaf whose blockId
 * IS a `rootChildren` key, so a direct `Map<topLevelKey, index>` is all the
 * assignment needs. Anchors nested inside a NON-transparent container resolve
 * to `undefined` in the index and are skipped defensively here (tracked as
 * FN-4-followup-A — not in FN-4 scope).
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
import {
  buildPagePlan,
  recordBlockMaps,
  type PagePlan,
  type PagePlanEntry,
  type SlotInsets,
} from "./measure-pass";
import { sectionStateAt, type SectionPlan } from "./section-plan";
import { isDevMode } from "./dev-mode";

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
 * NOTE: `prevResolvedPlan` (the incremental carry-forward) is FN-4.4 — omitted
 * here. The body re-layout is cached by `(body ref + content inline-size)` within
 * a single call only.
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
): PagePlan {
  // (1) Footnote-free doc ⇒ ref-equal no-op (zero cost).
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

  // Per-call body-layout cache, keyed by body ref → (content inline-size →
  // laid-out height). The incremental cascade returns the SAME body ElementBox
  // ref for an unchanged body, but within ONE call we may consult the same body
  // multiple times (convergence iterations), so the cache avoids re-layout.
  const bodyHeightCache = new WeakMap<ElementBox, Map<number, number>>();
  const bodyHeight = (body: ElementBox, contentInlineSize: number): number => {
    let perInline = bodyHeightCache.get(body);
    if (perInline === undefined) {
      perInline = new Map();
      bodyHeightCache.set(body, perInline);
    }
    const cached = perInline.get(contentInlineSize);
    if (cached !== undefined) return cached;
    const sectionContentCtx: LayoutContext = {
      ...ctx,
      containingInlineSize: contentInlineSize,
    };
    const { box } = layoutBlock(body, 0, 0, sectionContentCtx, shaper, {
      availableBlockSize: Number.MAX_SAFE_INTEGER,
      pageIndex: 0,
      resumeFrom: null,
    });
    const height = box?.blockSize ?? 0;
    perInline.set(contentInlineSize, height);
    return height;
  };

  // Sum the assigned bodies' heights + one separator rule, clamped to the
  // bounded area (D5). Returns 0 when no bodies are assigned (no slot).
  const slotHeightFor = (
    contentBlockIds: readonly BlockId[],
    contentInlineSize: number,
    pageContentBlockSize: number,
  ): number => {
    if (contentBlockIds.length === 0) return 0;
    let bodiesSum = 0;
    for (const id of contentBlockIds) {
      const body = cascadedEmbedContents.get(id);
      if (body === undefined) {
        // A footnote whose body is missing from the cascaded map would be a
        // no-MVP defect (the body silently vanishing). Dev-only throw; in prod
        // skip it (contributes 0) so layout never crashes.
        if (isDevMode()) {
          throw new Error(
            `resolveFootnotes: footnote body ${id} is absent from ` +
              `cascadedEmbedContents — the body must be cascaded before layout.`,
          );
        }
        continue;
      }
      bodiesSum += bodyHeight(body, contentInlineSize);
    }
    const rawSlot = bodiesSum + FOOTNOTE_SEPARATOR_HEIGHT;
    // D5 clamp: the slot may not consume the whole page — the body retains
    // ≥ MIN_BODY_BLOCK_SIZE. FN-5: when `rawSlot` exceeds the bound the bodies
    // are clamped (laid out fully but the reserved area is capped, so the
    // overflow visually spills); cross-page body splitting + continuation is
    // FN-5, with this clamp as the seam.
    const maxSlot = Math.max(0, pageContentBlockSize - MIN_BODY_BLOCK_SIZE);
    return Math.min(rawSlot, maxSlot);
  };

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

  // Hard page-count bound (defensive), mirroring measurePass: a correct re-fit
  // advances state every page. The footnote slot can only REDUCE the per-page
  // capacity (more pages), never remove blocks, so `metas.length * 2 + 2` still
  // bounds the page count. If exceeded, a re-fit failed to advance — throw
  // rather than loop forever.
  const maxPages = metas.length * 2 + 2;

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
      footnoteSlotHeight = slotHeightFor(contentBlockIds, contentInlineSize, pageContentBlockSize);
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
          footnoteSlotHeight = slotHeightFor(contentBlockIds, contentInlineSize, pageContentBlockSize);
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
    // recomputed from the FINAL `contentBlockIds`. If the loop exhausted its cap
    // without converging (a real multi-cycle — unreachable with correct block
    // structure per the monotonicity note above), `footnoteSlotHeight` would be
    // left over from an earlier iteration's set and disagree with the bodies that
    // actually get a slot. Catch that loudly in dev; prod stays graceful.
    if (isDevMode()) {
      const expectedSlot = slotHeightFor(
        contentBlockIds, contentInlineSize, pageContentBlockSize,
      );
      if (footnoteSlotHeight !== expectedSlot) {
        throw new Error(
          `resolveFootnotes: footnoteSlotHeight (${footnoteSlotHeight}) is ` +
            `inconsistent with the final contentBlockIds slot ` +
            `(${expectedSlot}) on page ${pageIndex} — convergence did not ` +
            `settle (a real multi-cycle broke the slot↔blocks monotonicity ` +
            `invariant).`,
        );
      }
    }

    const stopBeforeIndex = tightenCap(sectionCap, footnoteCap);

    const nextStartIndex =
      fit.resumeOut !== null && fit.resumeOut.type === "block"
        ? fit.resumeOut.resumeChildIndex
        : startIndex + fit.childrenCount;
    const sliceEnd = fit.resumeOut === null ? metas.length : nextStartIndex;
    const children: readonly RenderNode[] = rootChildren.slice(startIndex, sliceEnd);

    newEntries.push({
      pageIndex,
      blockOffset,
      blockSize: effCfg.pageBlockSize,
      pageConfig: effCfg,
      children,
      startIndex,
      resumeInto,
      resumeOut: fit.resumeOut,
      listCounterAtStart,
      activeSectionId,
      sectionPageIndex,
      // Cap re-derived at this page's startIndex (D7).
      stopBeforeIndex: stopBeforeIndex ?? null,
      // Header/footer body ids for THIS page (C.2c + D9): from the section
      // ACTIVE at the new `startIndex` (`st`), NOT the raw entry at the same page
      // NUMBER — a footnote-driven shift can move the page to a different section.
      headerBlockId: st.headerBlockId,
      footerBlockId: st.footerBlockId,
      // effectiveBottomInset UNCHANGED (D1) — the slot reservation lives only in
      // footnoteSlotHeight.
      effectiveTopInset: effTopInset,
      effectiveBottomInset: effBottomInset,
      footnoteContentBlockIds: contentBlockIds,
      footnoteSlotHeight,
      // FN-5: cross-page footnote-body continuation. ALWAYS null in FN-4 (D5
      // clamp instead of split).
      footnoteContinuation: null,
    });

    recordBlockMaps(
      children, rootChildren, metas, startIndex, pageIndex,
      resumeInto, fit.resumeOut, blockToPage, blockToSpan,
    );

    // Advance the running-sum document-y by THIS page's height + gap (C.2b-2).
    blockOffset += effCfg.pageBlockSize + effCfg.pageGap;

    if (fit.resumeOut === null) break;

    // Thread loop state forward (mirrors measurePass). Section-state (active id +
    // within-section page index) is recomputed at the next startIndex so a swept
    // page that crossed a section boundary tags the correct section.
    pageIndex++;
    startIndex = nextStartIndex;
    resumeInto = fit.resumeOut;
    listCounterAtStart = fit.listCounterAtEnd;
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
