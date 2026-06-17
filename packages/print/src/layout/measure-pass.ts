// packages/core/src/layout/measure-pass.ts
//
// The measure pass (virtualized-layout Phase 1). Given the top-level
// `BlockFitMeta[]` for a document and a `PageConfig`, repeatedly invoke the
// pure `fitOnePage` to compute a `PagePlan`: which top-level children land on
// each page, each page's document-y offset, the resume tokens INTO / OUT of
// each page, and the per-page ordered-list counter seed. No box allocation —
// the plan is plain data; the positioned `PageBox`es are materialized lazily
// in a later phase.
//
// Design: docs/superpowers/specs/2026-05-24-virtualized-layout-design.md
// Plan:   docs/superpowers/plans/2026-05-24-virtualized-layout-phase1.md

import type { RenderNode, ElementBox } from "@taleweaver/core";
import type { BlockId } from "@taleweaver/core";
import type { BreakToken } from "./fragmentation";
import { breakTokensEqual, innerBfcToken } from "./fragmentation";
import type { BlockFitMeta } from "./fit-core";
import { fitOnePage } from "./fit-core";
import type { PlacedFloat, PushedFloat } from "./float-context";
import { fitColumnsOnPage, balanceColumnHeight, type ColumnsFitResult } from "./column-fit";
import { isDevMode } from "@taleweaver/core";
import type { PageConfig } from "./page-config";
import { columnConfigsEqual, type ColumnConfig } from "@taleweaver/core";
import { computeTrackInlineSize } from "./column-config";
import {
  pageConfigsEqual,
  sectionStateAt,
  hasMultiColumnRegion,
  type SectionPlan,
  type SectionStateAt,
} from "./section-plan";
import type { FootnoteAnchorRef } from "@taleweaver/core";

// ---------------------------------------------------------------------------
// Test-only instrumentation: count `fitOnePage` invocations from `measurePass`.
//
// The incremental carry-forward (the `prevPlan` reuse below) SKIPS `fitOnePage`
// for a page whose boundary is provably unchanged. The perf test asserts that an
// append-at-end rebuild drives only O(1..few) `fitOnePage` calls (the trailing
// dirty page + a defensive recount), NOT one per page. `fitOnePage`'s OWN logic
// is untouched; this counter wraps the call site here so it never perturbs the
// pure fit-core. Production pays one integer increment per page it actually
// re-fits (negligible).
// ---------------------------------------------------------------------------

/**
 * Sentinel for the section-tracking running var BEFORE the first page is seen.
 * `null` is a VALID `activeSectionId` (the implicit leading section), so it
 * cannot double as "uninitialized" — a distinct symbol lets the reset condition
 * be a plain `activeSectionId !== currentActiveSectionId` with no special-case
 * `pageIndex === 0` coupling (the first page always differs from the sentinel).
 */
const UNINITIALIZED_SECTION = Symbol("uninitialized-section");

/**
 * Shared empty footnote-id array stamped onto every entry `measurePass` builds
 * (FN-4 D2). `measurePass` is footnote-unaware; `resolveFootnotes` (FN-4.2)
 * rewrites the footnote-bearing pages with their real assignment. A single
 * frozen instance keeps the no-footnote path allocation-free.
 */
const EMPTY_FOOTNOTE_IDS: readonly BlockId[] = Object.freeze([]);

/**
 * One footnote body's cross-page continuation OUT of a page (FN-5): the body
 * `contentBlockId` and the `resumeToken` to resume its layout on the next page,
 * or `null` when the body completes on this page. FN-5 footnote-body splitting
 * fills a list of these; FN-4 always stamps the empty list (it clamps rather
 * than splits — D5).
 */
export interface FootnoteContinuation {
  readonly contentBlockId: BlockId;
  readonly resumeToken: BreakToken | null;
}

/**
 * Shared empty footnote-continuation list stamped onto every entry by the
 * footnote-unaware passes (FN-5 E1). A single frozen instance keeps the
 * no-continuation path allocation-free, mirroring `EMPTY_FOOTNOTE_IDS`.
 */
export const EMPTY_FOOTNOTE_CONTINUATIONS: readonly FootnoteContinuation[] = Object.freeze([]);

/**
 * Shared empty incoming-active-floats list stamped onto every entry by the
 * float-unaware construction sites (VL float fast-path Task 2). A single frozen
 * instance keeps the no-float path allocation-free, mirroring
 * `EMPTY_FOOTNOTE_IDS` / `EMPTY_FOOTNOTE_CONTINUATIONS`. The float carry pass
 * (Task 3) rewrites the entries whose content-top sits under a prior page's
 * float shadow with the real cumulative-frame list.
 */
export const NO_INCOMING_FLOATS: readonly PlacedFloat[] = Object.freeze([]);

/**
 * Shared empty list for the cross-page PUSHED-float carry (#528 T3). A pushed
 * float is one that did not fit its page's remaining block space and is deferred
 * to the next page (`PushedFloat`). INERT in T3: no producer pushes and no
 * consumer places, so this default is the value on EVERY page — output is
 * byte-identical. T4 adds the producer (BFC float branch) + consumer
 * (landing-page placement); the carry plumbing below is already in place.
 */
export const NO_INCOMING_PUSHED_FLOATS: readonly PushedFloat[] = Object.freeze([]);

let _fitOnePageCallCount = 0;

/** Test-only: number of `fitOnePage` calls from `measurePass` since last reset. */
export function __getFitOnePageCallCountForTest(): number {
  return _fitOnePageCallCount;
}

/** Test-only: reset the `fitOnePage` call counter. */
export function __resetFitOnePageCallCountForTest(): void {
  _fitOnePageCallCount = 0;
}

/** One page's boundary decision (plain data; no positioned boxes). */
export interface PagePlanEntry {
  readonly pageIndex: number;
  /**
   * Document-y of this page's top edge. A RUNNING SUM over the per-page heights
   * before it (C.2b-2) — pages are no longer uniform-height once a section
   * carries a geometry override. For a doc whose every page resolves to the
   * doc-wide config this reduces to `pageIndex * (pageBlockSize + pageGap)`.
   */
  readonly blockOffset: number;
  /** This page's block-size — its EFFECTIVE config's `pageBlockSize` (C.2b-2). */
  readonly blockSize: number;
  /**
   * The EFFECTIVE page geometry for THIS page (C.2b-2): the active section's
   * boundary `pageConfig` if it overrides the doc-wide config, else the doc-wide
   * `pageConfig` measurePass was called with. Drives `blockSize`, this page's
   * content block-size (the value passed to `fitOnePage`), the running-sum gap,
   * and the per-entry reuse gate. Consumers (T3 materialization) read the page's
   * inline-size / margins off it.
   */
  readonly pageConfig: PageConfig;
  /**
   * The EFFECTIVE multi-column config for THIS page (multi-column wiring T1): the
   * active section's `columnConfig` override if any, else the doc-wide
   * `sectionPlan.effectiveDefaultColumns`. Mirrors `pageConfig` — always the
   * resolved value. INERT in T1 (no consumer reads it yet); T2 joins it to the
   * page-reuse / fingerprint gate, T3 dispatches `fitColumnsOnPage` on it, T5
   * materializes the `MultiColumnBox` from it.
   */
  readonly columnConfig: ColumnConfig;
  /**
   * The per-column content distribution for THIS page (multi-column wiring T3),
   * from `fitColumnsOnPage`. OPTIONAL — set ONLY on multicol pages
   * (`columnConfig.columnCount > 1`); `undefined` for single-column pages (which
   * keep the bare `fitOnePage` path, byte-identical to pre-T3). T5 materializes
   * the `MultiColumnBox` from `columnFit.columns`. Its `pageResumeOut` (a
   * `ColumnBreakToken`) is the SAME token this entry's `resumeOut` stores and the
   * page loop threads to the next multicol page.
   */
  readonly columnFit?: ColumnsFitResult;
  /**
   * The ACTUAL per-column rendered height for THIS page (multi-column wiring T4) —
   * the block-size Task 5's `materializePage` lays each column into. ALWAYS
   * present: `effContentBlockSize` (the full page body block-size) for
   * single-column pages and for non-final multicol (FILL) pages; the BALANCED
   * height (`balanceColumnHeight`, < the page body) on a multicol section's FINAL
   * page, so its columns are evened (CSS `column-fill: balance`, Google-Docs
   * parity). Joins the `PageFingerprint` so a balance change re-materializes.
   */
  readonly balancedColumnHeight: number;
  /** Cascaded top-level child references that begin/continue on this page. */
  readonly children: readonly RenderNode[];
  /** Index of the first top-level child on this page (into the doc's children). */
  readonly startIndex: number;
  /** Resume state INTO this page; `null` ⇒ a fresh page boundary. */
  readonly resumeInto: BreakToken | null;
  /** Resume state OUT of this page; `null` ⇒ this is the last page. */
  readonly resumeOut: BreakToken | null;
  /** Ordered-list counter value seeding this page's markers. */
  readonly listCounterAtStart: number;
  /**
   * The `section` block id that OWNS this page (the active section at the page's
   * first flattened child, per the `SectionPlan`), or `null` when this page
   * belongs to the implicit section-less leading run. Carried for C.2c
   * (per-section headers/footers/geometry); the C.2b-1 measure pass only tags
   * it — getPage / materialization does not consume it yet.
   */
  readonly activeSectionId: BlockId | null;
  /**
   * 0-based index of this page WITHIN its active section: the first page of each
   * section is 0 and it increments per page until the section ends, then resets
   * to 0 at the next section's first page. (Reset is keyed on the
   * `activeSectionId` changing — NOT on `resumeInto === null`, since a section's
   * first page resumes from the forced break and so has a non-null `resumeInto`.)
   * Carried for C.2c (e.g. "first page of section" header variants).
   */
  readonly sectionPageIndex: number;
  /**
   * The section page-break cap applied to THIS page's fit (`st.nextBoundaryIndex`):
   * an EXCLUSIVE upper bound on the top-level child index the page may place — so
   * a block belonging to the NEXT section starts a fresh page instead of leaking
   * onto this one. `null` when the page's active section has no next boundary
   * (last/only section) ⇒ no cap. The positioning pass (`materializePage`) threads
   * this into `bfc.layoutBlock`'s `FragmentationContext.stopBeforeIndex` so the
   * positioned page honors the SAME cap the plan's `fitOnePage` used — without it,
   * positioning would refill the leftover room with the next section's blocks.
   */
  readonly stopBeforeIndex: number | null;
  /**
   * The id of the `templateContents` body that lays out into THIS page's HEADER
   * slot (C.2c): the active section's (or doc-root implicit section's)
   * `headerBlockId`, from `sectionStateAt` at the page's first flattened child.
   * `undefined` when the active section/doc declares no header. The measure pass
   * only TAGS it here — a later task reads it to lay the body into the slot.
   */
  readonly headerBlockId?: BlockId;
  /** The footer-slot body id for THIS page; symmetric to `headerBlockId` (C.2c). */
  readonly footerBlockId?: BlockId;
  /**
   * The EFFECTIVE top inset for THIS page (#328 growing slot): `max(effective
   * page-margin blockStart, header body NATURAL height)`. The body content area
   * begins at this offset, so a header taller than its margin band PUSHES the
   * body down rather than overflowing into it. Equals the effective page
   * margin's `blockStart` when there is no header (or the header fits the
   * margin) — keeping the no-slot path byte-identical. Drives the fit's content
   * block-size, the materialized body origin, and the per-entry reuse gate.
   */
  readonly effectiveTopInset: number;
  /**
   * The EFFECTIVE bottom inset for THIS page (#328): `max(effective page-margin
   * blockEnd, footer body NATURAL height)`. The body content area ends at
   * `pageBlockSize − effectiveBottomInset`; the footer grows UPWARD. Symmetric
   * to `effectiveTopInset`.
   */
  readonly effectiveBottomInset: number;
  /**
   * Footnote bodies (FN-4, D2) assigned to THIS page, in document order — the
   * `contentBlockId`s of the footnote anchors whose host block lands on this
   * page. `measurePass` ALWAYS stamps `[]` (it is footnote-unaware); the
   * `resolveFootnotes` pass (FN-4.2) rewrites the footnote-bearing pages with
   * the real assignment. An empty array ⇒ no footnote slot on this page.
   */
  readonly footnoteContentBlockIds: readonly BlockId[];
  /**
   * The laid-out footnote slot height for THIS page (FN-4, D2): the sum of the
   * assigned bodies' heights + the separator rule, clamped to the bounded area
   * (D5). `measurePass` ALWAYS stamps `0`; `resolveFootnotes` rewrites it. The
   * footnote slot reduces the body content area by this amount, so the body
   * re-fits against `pageContentBlockSize − footnoteSlotHeight`.
   */
  readonly footnoteSlotHeight: number;
  /**
   * The footnote-body continuations OUT of THIS page (FN-4, D2): one entry per
   * footnote body that overflowed the slot and continues onto the next page.
   * ALWAYS empty in FN-4 (`measurePass` and `resolveFootnotes` stamp
   * `EMPTY_FOOTNOTE_CONTINUATIONS`; `resolveFootnotes` clamps rather than splits
   * — D5); FN-5 fills it when cross-page footnote-body splitting lands. Widened
   * to a list now so FN-5 never re-touches the entry type (E1).
   */
  readonly footnoteContinuation: readonly FootnoteContinuation[];
  /**
   * Coherent float+pagination: the in-flow block-size THIS page consumed
   * (EXCLUDING out-of-flow floats) — the measure-pass analog of paginate's
   * `LayoutResult.inFlowConsumed`. The measure loop accumulates these (gapless) to
   * thread each page's CUMULATIVE flow base into `fitOnePage` as the IFC
   * `paraFlowStart` seed, so the measure-pass resume tokens match the materialize
   * pass field-for-field. Position-INDEPENDENT (a pure function of the fit), so
   * the reuse path carries it from the prior entry. For a single-column page it is
   * the fit's `consumedBlockSize`; for a multicol page it is the page-body height
   * actually consumed (the tallest column's content), which for token-agreement
   * purposes need only match across passes on non-float docs.
   */
  readonly inFlowConsumed: number;
  /**
   * Coherent float+pagination: the cumulative in-flow flow offset of THIS page's
   * content top (Σ prior pages' `inFlowConsumed`) — the running `pageFlowBase` AS
   * IT IS when this entry is pushed (BEFORE this page's own `+= pageConsumed`
   * advance). This is the EXACT value the measure pass passes to `fitColumnsOnPage`
   * as the multicol `contentFlowBase` (and to `fitOnePage` for single-column),
   * which seeds each column's IFC `paraFlowStart` stamp. The MATERIALIZE pass
   * threads the SAME value into its per-column `layoutBlock` call so the resume
   * tokens agree field-for-field (otherwise the dev-mode drift guard fires on a
   * float doc). Position-INDEPENDENT (a pure function of the fits), so the reuse
   * path stamps the CURRENT running value (not the cached entry's, which can be
   * stale if an earlier page changed).
   */
  readonly pageFlowBase: number;
  /**
   * Floats (cumulative frame) still active at THIS page's content-top — placed on
   * a PRIOR page whose block-bottom exceeds this page's `pageFlowBase`. Empty ⇒ no
   * incoming float shadow (the byte-identical default for non-float docs and the
   * first page). `materializePage` seeds the page `FloatEnvironment` from this
   * VERBATIM (cumulative, NO translation); the page's OWN floats are re-placed by
   * its `layoutBlock`. Joins the `PageFingerprint` reuse gate so a changed float
   * invalidates exactly the downstream pages its shadow touches.
   */
  readonly incomingActiveFloats: readonly PlacedFloat[];
  /**
   * Floats PUSHED into THIS page from the prior page (#528 T3): floats that did
   * not fit the prior page's remaining block space and were deferred to land
   * here, re-laid-out at this page's content-top. Carries only the float node +
   * side (`PushedFloat`); the landing geometry is recomputed on this page. Empty
   * ⇒ no pushed floats (the byte-identical default for the first page and for
   * every page in T3, since no producer pushes yet). T4's producer fills it on
   * pages following an overflowed float and its consumer places them here. Joins
   * the `PageFingerprint` reuse gate so a changed pushed float invalidates the
   * landing page.
   */
  readonly incomingPushedFloats: readonly PushedFloat[];
}

/** The document's full pagination plan. */
export interface PagePlan {
  readonly entries: readonly PagePlanEntry[];
  /**
   * The `SectionPlan` this plan was fitted against — the section boundaries that
   * forced this plan's page breaks. REQUIRED (every plan `measurePass` returns
   * carries the input `sectionPlan`, `IMPLICIT_SECTION_PLAN` for section-less
   * callers). The incremental carry-forward reuse gate reads `prevPlan.sectionPlan`
   * to compare a page's section status across cycles, so a `SECTION_BREAK` (which
   * leaves body refs unchanged) still invalidates the pages it reshaped.
   */
  readonly sectionPlan: SectionPlan;
  /**
   * Total document height: the running sum over the per-page block-sizes +
   * inter-page gaps (the last page's `blockOffset + pageBlockSize`, no trailing
   * gap). Per-page heights need not be uniform once a section overrides its
   * geometry (C.2b-2); for a no-override doc this equals `pageCount × pageBlockSize
   * + (pageCount-1) × pageGap`.
   */
  readonly totalBlockSize: number;
  readonly pageInlineSize: number;
  /**
   * The DOC-WIDE page CONTENT block-size this plan was fitted at
   * (`pageBlockSize − margins.blockStart − margins.blockEnd`, from the doc-wide
   * `pageConfig` param — NOT any section override). This is used ONLY as the
   * COARSE whole-plan carry-forward reuse guard: if it changes between cycles,
   * the ENTIRE prior plan is discarded and every page refits from scratch.
   *
   * It does NOT describe the size every boundary was fitted against — that was
   * only true before per-section geometry. A section-overriding page fits at its
   * OWN effective content block-size (derived from `PagePlanEntry.pageConfig`,
   * the boundary's override), so its boundary was NOT computed against this
   * value. The per-entry reuse gate (`canReusePage`) compares each page's
   * effective `pageConfig` independently; this field is solely the doc-wide
   * mismatch tripwire that invalidates the whole plan when the base geometry
   * (doc-wide block-size / margins) changes.
   */
  readonly pageContentBlockSize: number;
  /**
   * Pixel document-y → page index. Binary search over the entries' half-open
   * intervals `[entry.blockOffset, nextEntry.blockOffset)`; the FINAL page
   * extends to `totalBlockSize` (no trailing pageGap on the last page). `y` is
   * clamped to `[0, last]`, so any out-of-range value resolves to page 0 or the
   * last page rather than -1.
   */
  pageIndexAtBlockOffset(y: number): number;
  /**
   * Top-level block key → the page whose `children` slice contains that block;
   * `-1` if the key is absent (or `rootChildren` was omitted at build time). A
   * block that SPANS pages appears only in the entry where it makes whole-block
   * progress (the entry whose slice contains it per `measurePass`'s
   * `[startIndex, nextStartIndex)` rule), which is not necessarily the page
   * where the block visually starts.
   */
  pageIndexOfBlock(blockKey: string): number;
  /**
   * Top-level block key → the inclusive `{ first, last }` page-index span the
   * block OCCUPIES (every page it renders any content on, including the pages
   * where a spanning block is only mid-fragment); `null` if the key is absent
   * (or `rootChildren` was omitted at build time).
   *
   * Unlike `pageIndexOfBlock` — which returns ONLY the whole-block-progress page
   * (the last page) and so misses the earlier pages a spanning block continues
   * across — this reports the true visual extent. A single-page block has
   * `first === last`. `last` equals `pageIndexOfBlock(blockKey)` for any present
   * block. Consumers that walk pages backward from the block's last page MUST
   * floor the walk at `first` so they never materialize or resolve against a
   * page the block does not occupy.
   */
  pageSpanOfBlock(blockKey: string): { readonly first: number; readonly last: number } | null;
  /**
   * Header/footer SLOT body root id → the FIRST page whose slot renders that
   * body; `-1` if the id is no page's header/footer (e.g. a normal main-tree
   * block, or an unused template body). The SAME body renders identically into
   * EVERY page's slot, so this deliberately reports the FIRST carrier — the
   * deterministic instance a slot caret resolves to (C.2c T6). Per-page caret
   * instances are a tracked follow-up (#323). Built from each entry's
   * `headerBlockId` / `footerBlockId`; empty when no page declares either.
   */
  pageIndexOfTemplateBlock(blockId: BlockId): number;
  /**
   * Footnote-body root id → the FIRST page whose footnote slot renders that body
   * FRESH (i.e. the page the body STARTS on); `-1` if the id is no page's
   * footnote body. A footnote body lives in the `embedContents` tree, so it is
   * neither a top-level main child (`pageIndexOfBlock` → -1) nor a header/footer
   * body (`pageIndexOfTemplateBlock` → -1); this is the only plan-level page
   * resolver for a footnote-body caret. Built from each entry's
   * `footnoteContentBlockIds` (the FRESH-started bodies on that page); a body
   * that splits across pages appears only on its FRESH page here, and consumers
   * walk forward through later pages' slots to find a continuation-line offset.
   * `measurePass` is footnote-unaware (it stamps `footnoteContentBlockIds: []`),
   * so a footnote-free doc maps nothing here — byte-identical to before footnotes
   * existed; only the `resolveFootnotes` pass populates it.
   */
  pageIndexOfFootnoteBlock(blockId: BlockId): number;
}

/**
 * Per-section effective slot insets (#328 growing slot). Keyed by the section's
 * `activeSectionId` (the value `sectionStateAt` returns; `null` for the implicit
 * section-less leading run) — NOT the header/footer body id. Each value is the
 * section's `{ top, bottom }` content inset, already `max`'d against the raw
 * page margins: `top = max(margin.blockStart, headerHeight)`,
 * `bottom = max(margin.blockEnd, footerHeight)`. The producer computes these by
 * laying out each section's cascaded header/footer body at that section's own
 * effective content inline-size (so a landscape section's header wraps at its
 * own width). When a section is ABSENT from this map — or the map is omitted
 * entirely — `measurePass` falls back to the raw effective page margins, so a
 * doc with no header/footer is byte-identical.
 */
export type SlotInsets = ReadonlyMap<BlockId | null, { readonly top: number; readonly bottom: number }>;

/**
 * Measures ONE page of a single-column float doc by running the real `layoutBlock`
 * (the SAME call `materializePage` makes) and discarding the geometry — returns
 * only the plan outputs. Injected by the producer (closing over the cascaded root
 * + ctx + shaper + hyphenator). The callback builds a fresh per-page
 * `FloatEnvironment`, `seedPlaced`s each `incomingFloats` entry (the cumulative
 * frame of floats still active at this page's content-top), runs `layoutBlock`
 * with that env at the per-page origin (`inlineOrigin`/`blockOrigin` — the SAME
 * values `materializePage` passes, so the measure and materialize `layoutBlock`
 * calls are byte-identical), and returns the break token, the in-flow consumed
 * height, the per-page child count, the advanced list counter, and the env's full
 * placed-float list (incoming + this page's own, all cumulative).
 *
 * GUARD: only ever passed for SINGLE-COLUMN float docs (the producer gate routes
 * float+multicol / float+footnote / absolute docs to the legacy path), so the
 * multicol branch must NOT consult it — see the dev-assertion there.
 */
export interface FloatPageMeasureArgs {
  readonly startIndex: number;
  readonly resumeInto: BreakToken | null;
  readonly pageFlowBase: number;
  readonly incomingFloats: readonly PlacedFloat[];
  // #528 T3: floats pushed into this page from the prior page, to be re-placed at
  // this page's content-top. INERT in T3 (always empty — no producer yet);
  // threaded through so T4 only adds the producer + the landing placement.
  readonly incomingPushedFloats: readonly PushedFloat[];
  readonly contentBlockSize: number;
  readonly stopBeforeIndex: number | undefined;
  readonly listCounterAtStart: number;
  // PR2-B: the page's per-page inline + block content origin — the SAME values
  // `materializePage` passes to its single-column `layoutBlock`
  // (`effMargins.inlineStart` / `effTopInset`), so the measure and materialize
  // calls are the IDENTICAL `layoutBlock` invocation (equivalence by
  // construction even with a growing header / section geometry override).
  readonly inlineOrigin: number;
  readonly blockOrigin: number;
}
export interface FloatPageMeasureResult {
  readonly resumeOut: BreakToken | null;
  readonly inFlowConsumed: number;
  readonly childrenCount: number;
  readonly listCounterAtEnd: number;
  readonly placedFloats: readonly PlacedFloat[];
  // #528 T3: floats this page could NOT fit and deferred to the next page. INERT
  // in T3 (always empty — no producer pushes yet); the carry below threads it to
  // the next page's `incomingPushedFloats`. T4's BFC float branch fills it.
  readonly pushedFloats: readonly PushedFloat[];
}
export type FloatPageMeasurer = (args: FloatPageMeasureArgs) => FloatPageMeasureResult;

/**
 * Compute the `PagePlan` for a document from its top-level block metas. Pure;
 * allocation-free apart from the plan structure itself.
 *
 * First-on-fragment top margins are handled entirely by the CSS Fragmentation
 * §5.4 truncation inside `fitOnePage` (the first child of every fragment has
 * its top margin zeroed). In the paginated path — the only mode the measure
 * pass runs in — that truncation runs BEFORE bfc's `noTopBoundary` first-child
 * suppression, so the latter is always a no-op; we do not model it here.
 *
 * INCREMENTAL CARRY-FORWARD: when `prevPlan` is supplied (and `rootChildren` is
 * present — the ref-equality proof needs it), a prior page entry is reused —
 * SKIPPING `fitOnePage` — whenever it is provably unchanged at the current loop
 * position (same `startIndex`, structurally-equal `resumeInto`, ref-equal
 * influencing children; see `canReusePage`). This mirrors `paginateRoot`'s old
 * L-PERF-C page reuse: an append / no-shift edit reuses every prior page ⇒
 * O(dirty + pages-scan), restoring O(1)-amortized build/typing-at-end. A
 * top-edit in an exact-fill document shifts every `startIndex` / `resumeInto`,
 * so nothing reuses and the whole plan re-fits — inherent, and cheap (pure
 * arithmetic over metas). Without `prevPlan` the from-scratch path is unchanged
 * (the equivalence oracle never passes it).
 *
 * SECTION PAGE BREAKS (C.2b-1): `sectionPlan` is consumed to force a page break
 * before the flattened child that begins each new section. At the top of every
 * page the active section's NEXT boundary (`sectionStateAt(sectionPlan,
 * startIndex).nextBoundaryIndex`) is passed to `fitOnePage` as its
 * `stopBeforeIndex` cap — so the page never places a block belonging to the next
 * section; that block starts a fresh page instead. Section-less callers pass
 * `IMPLICIT_SECTION_PLAN` (a single boundary at index 0 ⇒ `nextBoundaryIndex` is
 * always null ⇒ NO cap ever ⇒ byte-identical to the pre-section behavior). Each
 * entry is tagged with its `activeSectionId` + `sectionPageIndex` (for C.2c).
 * The reuse gate additionally compares section status (`sectionStatesEqual`) so a
 * `SECTION_BREAK` invalidates only the pages it reshaped.
 *
 * @param prevPlan the prior cycle's `PagePlan` for the carry-forward reuse, or
 *   `undefined` for a fresh build / boundary-only caller.
 */
export function measurePass(
  metas: readonly BlockFitMeta[],
  pageConfig: PageConfig,
  sectionPlan: SectionPlan,
  rootChildren?: readonly RenderNode[],
  prevPlan?: PagePlan,
  // Per-section effective slot insets (#328). Absent/missing for a section ⇒
  // fall back to the section's raw effective page margins ⇒ byte-identical.
  slotInsets?: SlotInsets,
  // Builds the per-child fit metas at an arbitrary inline width (closure over the
  // cascaded root + shaper, memoized by `buildBlockFitMetas`'s own cache).
  // REQUIRED for correct multicol pagination — the multicol branch rebuilds metas
  // at the column TRACK width so the planned ColumnFit matches `materializePage`'s
  // narrow-track layout. Absent ⇒ multicol falls back to the full-width `metas`
  // (the legacy, drift-prone behavior; only safe for width-independent
  // fixed-height content, e.g. some unit tests).
  buildMetasAtWidth?: (inlineSize: number) => readonly BlockFitMeta[],
  // VL float fast-path (Task 3): when present, every single-column page is
  // measured by running the real `layoutBlock` via this callback (discarding
  // geometry, keeping only the plan outputs) instead of the pure `fitOnePage`.
  // The producer supplies it ONLY for single-column float docs (its gate routes
  // float+multicol / float+footnote / absolute to the legacy path), so it is
  // never consulted on the multicol branch (dev-asserted there). Absent ⇒ the
  // existing `fitOnePage` path, byte-identical to pre-float behavior.
  floatPageMeasurer?: FloatPageMeasurer,
): PagePlan {
  const margins = pageConfig.pageMargins;
  const pageContentBlockSize =
    pageConfig.pageBlockSize - margins.blockStart - margins.blockEnd;

  if (pageContentBlockSize <= 0) {
    throw new Error(
      `measurePass: pageMargins.blockStart (${margins.blockStart}) + pageMargins.blockEnd (${margins.blockEnd}) must be less than pageBlockSize (${pageConfig.pageBlockSize}).`,
    );
  }

  // --- Incremental carry-forward setup (matches paginateRoot's L-PERF-C). ---
  // Index the prior plan's entries by `startIndex` for O(1) reuse lookup. A
  // prior entry is reused at the current loop state `(startIndex, resumeInto)`
  // ONLY when it is provably unchanged at that position (see the reuse block in
  // the loop). Reuse requires `rootChildren` (ref-equality of the slice is the
  // proof); when omitted (boundary-only callers / no prior plan) we always
  // re-fit. We index the prior PLAN-INDEX (not the entry itself) so we can read
  // the prior page's `listCounterAtEnd` off the NEXT prior entry's
  // `listCounterAtStart` — that value was computed by the real `fitOnePage`, so
  // reusing it keeps the running counter byte-identical to the from-scratch run
  // (including a mid-fragment list-item child's partial contribution, which a
  // naive whole-child recount would miss).
  //
  // GUARD: the prior plan's boundaries were fitted at
  // `prevPlan.pageContentBlockSize`. `canReusePage` only proves the CONTENT
  // (child refs / resume tokens) is unchanged — it does NOT re-derive the
  // boundary against the current page geometry. So if the page content
  // block-size differs from the prior cycle (a `pageBlockSize` / margins
  // change), every reused boundary could be stale. Refuse the prior plan
  // entirely (force a full from-scratch re-fit) on a mismatch by leaving the
  // reuse lookup null. Today's API never triggers this (pageConfig is static and
  // the resize path passes no prevPlan), but it closes a latent correctness
  // footgun without weakening the per-page reuse proof.
  const prevPlanReusable =
    prevPlan !== undefined &&
    rootChildren !== undefined &&
    prevPlan.pageContentBlockSize === pageContentBlockSize;
  const prevPlanIndexByStartIndex: Map<number, number> | null = prevPlanReusable ? new Map() : null;
  if (prevPlanIndexByStartIndex !== null && prevPlan !== undefined) {
    // `prevPlan.entries` is a dense array; iterate values to drop the index read.
    for (const [k, entry] of prevPlan.entries.entries()) {
      prevPlanIndexByStartIndex.set(entry.startIndex, k);
    }
  }

  const entries: PagePlanEntry[] = [];
  // Block-key → page index, built alongside the plan in the single pass below.
  // Empty when `rootChildren` is omitted (no keys to map) ⇒ pageIndexOfBlock
  // returns -1 for everything.
  const blockToPage = new Map<string, number>();
  // Block-key → inclusive page span the block OCCUPIES. Tracks every page a
  // block renders content on — including the pages a spanning block is only
  // mid-fragment on, which `blockToPage` omits. Built from the per-page OCCUPIED
  // index range below (not the whole-block-progress `children` slice). Empty
  // when `rootChildren` is omitted.
  const blockToSpan = new Map<string, { first: number; last: number }>();
  let resumeInto: BreakToken | null = null;
  let startIndex = 0;
  let listCounterAtStart = 0;
  let pageIndex = 0;
  // Running-sum document-y for the current page's top edge (C.2b-2). Pages are
  // no longer uniform-height (a section may override its geometry), so each
  // page's `blockOffset` is the accumulated heights+gaps of every page before
  // it. After pushing a page we advance by THAT page's effective
  // `pageBlockSize + pageGap`; the trailing gap on the last page is excluded
  // from `totalBlockSize` (see below). For a doc with no override this reduces
  // to `pageIndex * (pageBlockSize + pageGap)`, keeping the no-regression path
  // byte-identical.
  let runningBlockOffset = 0;

  // Coherent float+pagination: the gapless cumulative in-flow flow offset of the
  // CURRENT page's content top (Σ prior pages' `inFlowConsumed`) — the measure
  // analog of paginate's `pageFlowBase`. Threaded into each page's `fitOnePage`
  // as the top-level `contentFlowBase` so the IFC `paraFlowStart` stamp is
  // cumulative (matching bfc field-for-field). Distinct from `runningBlockOffset`
  // (which includes `pageBlockSize + pageGap`); this sums only consumed content.
  let pageFlowBase = 0;

  // VL float fast-path (Task 3): the floats active at the CURRENT page's
  // content-top (the cumulative frame — prior pages' floats whose block-bottom
  // hangs past this page's content-top). Empty at doc start; on an incremental
  // resume across a REUSED page it is advanced from the reused prefix's successor
  // entry (PR1-2). Only consulted/advanced when `floatPageMeasurer` is provided
  // (a single-column float doc per the producer gate) — otherwise it stays the
  // empty default and never influences the byte-identical non-float path.
  let incomingFloats: readonly PlacedFloat[] = NO_INCOMING_FLOATS;

  // #528 T3: the floats PUSHED into the CURRENT page from the prior page (floats
  // that overflowed the prior page's remaining block space). Empty at doc start;
  // advanced to the float branch's `fr.pushedFloats` after each page and, on an
  // incremental resume across a REUSED page, to the reused prefix's successor
  // entry's `incomingPushedFloats` (mirroring the `incomingFloats` carry). INERT
  // in T3 — no producer pushes, so it stays the empty default on every page and
  // never influences the byte-identical output. T4 adds the producer + consumer.
  let incomingPushedFloats: readonly PushedFloat[] = NO_INCOMING_PUSHED_FLOATS;

  // --- Running section state (C.2b-1). ---
  // `currentActiveSectionId` is the section the PREVIOUS page belonged to;
  // `currentSectionPageIndex` is that page's 0-based within-section index. At the
  // top of each page we recompute the active section at `startIndex`: if it
  // CHANGED (or this is the first page) the within-section index resets to 0,
  // else it increments. Both are updated on EVERY page (re-fit AND reuse) and
  // stamped onto the entry. The reset is keyed on the section CHANGING — NOT on
  // `resumeInto === null` — because a new section's first page resumes from the
  // forced break (so `resumeInto !== null` there), which a null-resume test would
  // miss. Initialized to a distinct sentinel (not `null`, which is a valid
  // `activeSectionId`) so the first page always counts as a section change ⇒
  // resets to 0, with no `pageIndex === 0` special case.
  let currentActiveSectionId: BlockId | null | typeof UNINITIALIZED_SECTION =
    UNINITIALIZED_SECTION;
  let currentSectionPageIndex = 0;

  // Hard page-count bound (defensive). A correct fit advances state every page
  // (consumes ≥1 whole child OR carries a resume token forward), so the page
  // count is at most one per child plus a fragment continuation each — well
  // under `metas.length * 2 + 2`. The loop must never reach this bound; if it
  // does, `fitOnePage` failed to advance and we throw rather than hang.
  const maxPages = metas.length * 2 + 2;
  for (;;) {
    if (pageIndex > maxPages) {
      throw new Error(
        `measurePass: page count exceeded safe bound (${maxPages}); fitOnePage failed to advance state — likely an unsupported document (see measurePassUnsupported).`,
      );
    }
    // Running-sum document-y of THIS page's top edge (C.2b-2). The accumulator
    // is advanced by each page's OWN effective height + gap after the entry is
    // pushed, so it is correct here even when earlier pages used a different
    // geometry.
    const blockOffset = runningBlockOffset;

    // --- Section state for THIS page (C.2b-1). ---
    // `st.activeSectionId` is the section owning the child at `startIndex`;
    // `st.nextBoundaryIndex` is the next section boundary strictly after it — the
    // forced-break cap (`stopBeforeIndex`) that ends this section. Compute it
    // BEFORE the reuse/refit branches so BOTH stamp the same value. Update the
    // running within-section index: reset to 0 when the section changed (or first
    // page), else increment.
    const st = sectionStateAt(sectionPlan, startIndex);
    const activeSectionId = st.activeSectionId;
    // The active section's (or implicit doc-root section's) header/footer body
    // ids for THIS page (C.2c), computed alongside `st` so BOTH the reuse and
    // re-fit branches stamp the same value. `undefined` when none is declared.
    const headerBlockId = st.headerBlockId;
    const footerBlockId = st.footerBlockId;

    // --- Effective per-page geometry (C.2b-2). ---
    // The active section's boundary `pageConfig` if it overrides the doc-wide
    // config, else the doc-wide `pageConfig` param. Drives this page's
    // content block-size (passed to `fitOnePage`), its `blockSize`, the
    // running-sum advance, and the per-entry reuse-gate geometry check. For a
    // doc with no override every page resolves to `pageConfig`, so the content
    // size equals the doc-wide `pageContentBlockSize` and the path is inert.
    const effCfg = st.pageConfig ?? pageConfig;
    // Effective multi-column config for THIS page (mirrors `effCfg`): the active
    // section's override, else the doc-wide resolved default. INERT in T1.
    const effColCfg = st.columnConfig ?? sectionPlan.effectiveDefaultColumns;
    // Effective slot insets for THIS page's active section (#328 growing slot).
    // The producer keys `slotInsets` by `activeSectionId`; when absent (no
    // header/footer for the section, or the map was omitted) we fall back to the
    // section's RAW effective page margins — which keeps the no-slot path
    // byte-identical (`max(margin, 0) = margin` reduces to the raw margin).
    const sectionInsets = slotInsets?.get(activeSectionId ?? null);
    const effTop = sectionInsets?.top ?? effCfg.pageMargins.blockStart;
    const effBottom = sectionInsets?.bottom ?? effCfg.pageMargins.blockEnd;
    // This page's effective content block-size: the page height minus the
    // GROWN insets (header pushes the body down, footer pushes it up), NOT the
    // raw margins. For a no-slot page this equals the raw-margin content size.
    const effContentBlockSize = effCfg.pageBlockSize - effTop - effBottom;
    // Slot-cap invariant (#329): the producer's `computeSlotInsets` pre-caps the
    // per-section insets so the body content area always retains ≥ minBody. This
    // branch is therefore UNREACHABLE for producer-built plans; it is kept as a
    // dev-only invariant assert (not a hard prod throw) so a future regression
    // that lets an uncapped inset through surfaces loudly in tests/dev without
    // crashing production layout. (Degenerate doc-wide margins — independent of
    // the slot cap — are caught by the coarse guard above, which DOES throw.)
    if (isDevMode() && effContentBlockSize <= 0) {
      throw new Error(
        `measurePass: header/footer insets (top=${effTop}, bottom=${effBottom}) leave no ` +
          `body content area within pageBlockSize=${effCfg.pageBlockSize} for section ` +
          `"${activeSectionId ?? "implicit"}" — the slot should have been capped by the ` +
          `producer (see #329).`,
      );
    }
    if (pageIndex === 0 || activeSectionId !== currentActiveSectionId) {
      currentSectionPageIndex = 0;
    } else {
      currentSectionPageIndex += 1;
    }
    currentActiveSectionId = activeSectionId;
    const sectionPageIndex = currentSectionPageIndex;

    // --- Incremental reuse (L-PERF-C semantics). ---
    // Reuse a prior page entry — skipping `fitOnePage` — when it is provably
    // unchanged at the CURRENT loop state. Reuse is sound only when every input
    // that determined the prior page's fit is identical now:
    //   1. A prior entry STARTS at this `startIndex` (so the page begins on the
    //      same child).
    //   2. Its `resumeInto` is STRUCTURALLY equal to the current `resumeInto`
    //      (same continuation state — references differ across cycles).
    //   3. Every child that INFLUENCED the fit — the whole-block-progress slice
    //      AND a mid-fragment child at the resume-out index whose lines/rows
    //      this page placed — is REFERENCE-equal to the prior tree's. Cascade
    //      preserves RenderNode refs for unchanged blocks, and Task-0's meta
    //      cache makes equal render-nodes ⇒ identical metas, so ref-equal
    //      influencing children ⇒ identical metas ⇒ identical `fitOnePage` fit.
    //   4. When the prior entry ended the document (`resumeOut === null`), it
    //      reaches the CURRENT document end (`startIndex + children.length ===
    //      metas.length`). Without this, appended blocks after the old last page
    //      would be silently dropped (the reused null-resumeOut would terminate
    //      the loop) — exactly the append-at-end case this fix must NOT break.
    // We then rebuild the entry's POSITION-dependent fields (blockOffset,
    // children slice, listCounterAtStart) at the current page, reusing the SHAPE
    // (children count / resumeOut). `rootChildren` is present whenever
    // `prevPlanIndexByStartIndex !== null`.
    if (prevPlanIndexByStartIndex !== null && rootChildren !== undefined && prevPlan !== undefined) {
      const prevK = prevPlanIndexByStartIndex.get(startIndex);
      const reusable = prevK !== undefined ? prevPlan.entries[prevK] : undefined;
      const prevNext = prevK !== undefined ? prevPlan.entries[prevK + 1] : undefined;
      if (
        prevK !== undefined &&
        reusable !== undefined &&
        breakTokensEqual(reusable.resumeInto, resumeInto) &&
        // Section status (C.2b-1): the prior page may be reused at `startIndex`
        // ONLY when its section status is unchanged across cycles. `activeSectionId`
        // unchanged ⇒ the page belongs to the same section; `nextBoundaryIndex`
        // unchanged ⇒ the forced cap (`stopBeforeIndex`) that SHAPED the page is
        // identical ⇒ the reused boundary is still valid. A `SECTION_BREAK` that
        // inserts/moves a boundary changes one of these for the pages it reshaped
        // (forcing a re-fit) while leaving earlier sections' pages' status
        // untouched (reuse). `prevPlan.sectionPlan` is always present (required).
        sectionStatesEqual(st, sectionStateAt(prevPlan.sectionPlan, startIndex)) &&
        // Per-page geometry (C.2b-2): the prior page's fit depends on its
        // effective content block-size, which comes from its geometry. Reuse is
        // sound ONLY when THIS page's effective config field-equals the prior
        // entry's `pageConfig`. The coarse whole-plan `pageContentBlockSize`
        // guard above already refuses reuse on a DOC-WIDE change; this per-entry
        // check is what lets a single section's geometry change refit only that
        // section's pages while earlier sections — whose effective config is
        // unchanged — still reuse their SHAPE. (References differ across cycles,
        // so a field deep-equal, not `===`.) The running-sum `blockOffset` is
        // rebuilt below from `runningBlockOffset`, so a geometry change upstream
        // correctly shifts every later page's offset while unchanged-fit pages
        // keep their children/resumeOut.
        pageConfigsEqual(effCfg, reusable.pageConfig) &&
        // Per-page multi-column config (multi-column wiring T2): mirrors the
        // `pageConfig` gate — a column-count / gap / rule change re-fits exactly
        // the affected section's pages (once T3 makes columns change the fit) and
        // re-materializes the `MultiColumnBox`, while earlier sections reuse.
        // INERT in T2 (no fit consumer yet) but always-equal so it adds no misses.
        columnConfigsEqual(effColCfg, reusable.columnConfig) &&
        // Effective slot insets (#328): the prior page's fit depends on its
        // content block-size, which the GROWN insets determine. Reuse is sound
        // ONLY when THIS page's effective insets equal the prior entry's. This
        // is what re-paginates the affected section's pages when a header/footer
        // height changes (e.g. growing the header drops lines/page): the body
        // refs are unchanged so the other gate fields all match, but the insets
        // differ, forcing a re-fit. The coarse doc-wide `pageContentBlockSize`
        // guard stays raw-margin-based (C3) and does NOT catch this — header
        // height re-pagination is this per-entry gate's job.
        effTop === reusable.effectiveTopInset &&
        effBottom === reusable.effectiveBottomInset &&
        canReusePage(rootChildren, startIndex, metas.length, reusable, prevNext)
      ) {
        const reusedSliceEnd =
          reusable.resumeOut === null ? metas.length : startIndex + reusable.children.length;
        const reusedChildren: readonly RenderNode[] = rootChildren.slice(startIndex, reusedSliceEnd);

        entries.push({
          pageIndex,
          blockOffset,
          // This page's effective geometry (C.2b-2): the CURRENT `effCfg`, which
          // the reuse gate proved field-equal to `reusable.pageConfig`.
          blockSize: effCfg.pageBlockSize,
          pageConfig: effCfg,
          columnConfig: effColCfg,
          // Carry the prior entry's per-column distribution (T3). `columnFit` is
          // position-INDEPENDENT (child indices + tokens + consumed sizes relative
          // to the page's content), so the reused page's distribution is identical
          // — the reuse gate's `columnConfigsEqual` + `canReusePage` proofs cover
          // the inputs that determined it. `undefined` for single-column pages.
          columnFit: reusable.columnFit,
          // Carry the prior entry's rendered per-column height (T4) — like
          // `columnFit`, it is position-INDEPENDENT (a pure function of the page's
          // content + column config, both proved unchanged by the reuse gate).
          balancedColumnHeight: reusable.balancedColumnHeight,
          children: reusedChildren,
          startIndex,
          resumeInto,
          // The ACTUAL prior token (a `ColumnBreakToken` for a reused overflowing
          // multicol page) — threaded to the next page, which unwraps it.
          resumeOut: reusable.resumeOut,
          listCounterAtStart,
          // Stamp from the RUNNING section vars (computed above), NOT the prior
          // entry — `sectionPageIndex` is position-dependent and the running pair
          // already accounts for any pages that shifted before this one.
          activeSectionId,
          sectionPageIndex,
          // The cap that shaped THIS page (the CURRENT `st`, not the prior
          // entry's): `st` is computed at the top of the loop before both the
          // reuse and re-fit branches, and the reuse gate (`sectionStatesEqual`)
          // proves `nextBoundaryIndex` is unchanged, so the prior fit is still
          // valid under this cap.
          stopBeforeIndex: st.nextBoundaryIndex ?? null,
          // Header/footer body ids for THIS page (C.2c) — stamped from the
          // CURRENT `st` on the reuse path too (M1), not the prior entry: the
          // page's owning section is the running `st`, which already accounts for
          // any section-id change a SECTION_BREAK introduced.
          headerBlockId,
          footerBlockId,
          // Effective slot insets for THIS page (#328), stamped from the CURRENT
          // `slotInsets` (via `effTop`/`effBottom`) on the reuse path too — the
          // reuse gate above proved they equal the prior entry's, so this is
          // identical, but stamping the current values keeps the source of truth
          // consistent across both branches (I1).
          effectiveTopInset: effTop,
          effectiveBottomInset: effBottom,
          // Footnote fields (FN-4 D2): `measurePass` is footnote-unaware, so it
          // ALWAYS stamps the no-footnote defaults. The `resolveFootnotes` pass
          // (FN-4.2) rewrites the footnote-bearing pages downstream.
          footnoteContentBlockIds: EMPTY_FOOTNOTE_IDS,
          footnoteSlotHeight: 0,
          footnoteContinuation: EMPTY_FOOTNOTE_CONTINUATIONS,
          // Coherent float+pagination: the prior entry's in-flow consumed is
          // position-INDEPENDENT (a pure function of the fit the reuse gate proved
          // unchanged), so carry it forward to keep `pageFlowBase` gapless.
          inFlowConsumed: reusable.inFlowConsumed,
          // Stamp the CURRENT running `pageFlowBase` (this page's content-top
          // cumulative offset) — NOT `reusable.pageFlowBase`, which can be stale if
          // an earlier page changed. The advance (`+= reusable.inFlowConsumed`)
          // happens below, so this is the value BEFORE this page's own consumption.
          pageFlowBase,
          // VL float fast-path (PR2-A): a REUSED page keeps its OWN stamped float
          // shadow — the prior entry's `incomingActiveFloats` (the floats that
          // shadowed its content-top), NOT the empty default. A reused
          // float-shadowed page must carry its real incoming shadow so the
          // materialize pass lays it out with the float exclusion. This reduces to
          // `NO_INCOMING_FLOATS` for non-float / pre-float reused pages (their
          // stored value is empty), so it stays byte-identical for non-float docs.
          // (Independent of the PR1-2 carry advance below, which seeds the next
          // FRESH-fit page's env; this is the reused page's OWN stamped value.)
          incomingActiveFloats: reusable.incomingActiveFloats,
          // #528 T3: a REUSED page keeps its OWN stamped pushed-float list (the
          // floats that landed on it from the prior page). INERT — empty on every
          // page in T3 (no producer), so this is byte-identical. Mirrors the
          // `incomingActiveFloats` reuse-path stamp above.
          incomingPushedFloats: reusable.incomingPushedFloats,
        });

        // Populate blockToPage / blockToSpan exactly as the miss path does.
        // Pass the INNER BFC tokens (a reused multicol page's `resumeInto` /
        // `resumeOut` may be `ColumnBreakToken`s) so the block-axis index range is
        // computed correctly, identical to the re-fit path.
        recordBlockMaps(
          reusedChildren,
          rootChildren,
          metas,
          startIndex,
          pageIndex,
          innerBfcToken(resumeInto),
          innerBfcToken(reusable.resumeOut),
          blockToPage,
          blockToSpan,
        );

        // Advance the running-sum document-y by THIS page's effective height +
        // gap (C.2b-2). Done before BOTH exits so the next page (or the
        // totalBlockSize computation) sees the correct accumulator.
        runningBlockOffset += effCfg.pageBlockSize + effCfg.pageGap;
        // Coherent float+pagination: advance the gapless cumulative flow base by
        // the reused page's in-flow consumed (mirrors the re-fit path).
        pageFlowBase += reusable.inFlowConsumed;
        // VL float fast-path (PR1-2): advance the running float carry across this
        // REUSED page using the STORED snapshot (no `layoutBlock` re-run). The next
        // page's incoming = the NEXT prev entry's `incomingActiveFloats` (already
        // filtered to the floats surviving past page `prevK`'s content-bottom when
        // the prior plan was built) — exactly the from-scratch carry for the
        // following fresh-fit page. Absent (last reused page / no successor) ⇒
        // empty. Only meaningful for a float doc; for non-float docs the prev
        // entries' value is empty, so this is byte-identical.
        incomingFloats = prevPlan?.entries[prevK + 1]?.incomingActiveFloats ?? NO_INCOMING_FLOATS;
        // #528 T3: advance the pushed-float carry across this REUSED page the same
        // way — the next page's incoming = the NEXT prev entry's
        // `incomingPushedFloats`. INERT (empty on every page in T3), so byte-
        // identical; mirrors the `incomingFloats` reuse advance above.
        incomingPushedFloats =
          prevPlan?.entries[prevK + 1]?.incomingPushedFloats ?? NO_INCOMING_PUSHED_FLOATS;

        if (reusable.resumeOut === null) {
          // #528 cross-page float PUSHING — last-page landing (reuse path). Mirror
          // the re-fit branch below: if THIS reused page exhausted in-flow but a
          // float was pushed off it (the carry was advanced to the successor's
          // `incomingPushedFloats` just above, non-empty), do NOT break — that
          // would drop the figure. Emit ONE MORE trailing page (resuming past the
          // doc's last child ⇒ no in-flow content) to LAND the pushed floats; it
          // re-fits via the `floatPageMeasurer` branch and pushes nothing, so the
          // loop terminates after it. Non-float / pre-push reused pages carry the
          // empty default ⇒ byte-identical (the original break).
          if (incomingPushedFloats.length === 0) {
            pageIndex++;
            break;
          }
          startIndex = metas.length;
          resumeInto = { type: "block", resumeChildIndex: metas.length, resumeChildToken: null };
          listCounterAtStart = prevNext !== undefined ? prevNext.listCounterAtStart : listCounterAtStart;
          pageIndex++;
          continue;
        }

        // Advance loop state from the reused boundary. The next page begins at
        // the first child not fully consumed: `resumeChildIndex` for a block
        // token, else `startIndex + children.length`. The page's list-counter
        // INCREMENT is a pure function of its (identical) content; reading it off
        // the prior plan as `prev[prevK+1].listCounterAtStart −
        // prev[prevK].listCounterAtStart` reproduces the real `fitOnePage`'s
        // `listCounterAtEnd` exactly — including a mid-fragment list-item child's
        // partial contribution — applied to the CURRENT running seed (never the
        // prior page's stale seed). The successor always exists here because
        // `resumeOut !== null` ⇒ the prior plan had a page after this one.
        // Unwrap a multicol page's `ColumnBreakToken` to its inner BFC token for
        // the block-axis advance (identity for single-column pages).
        const reusedInnerResumeOut = innerBfcToken(reusable.resumeOut);
        const reusedNextStartIndex =
          reusedInnerResumeOut !== null && reusedInnerResumeOut.type === "block"
            ? reusedInnerResumeOut.resumeChildIndex
            : startIndex + reusable.children.length;
        const listCounterDelta =
          prevNext !== undefined ? prevNext.listCounterAtStart - reusable.listCounterAtStart : 0;
        startIndex = reusedNextStartIndex;
        resumeInto = reusable.resumeOut;
        listCounterAtStart = listCounterAtStart + listCounterDelta;
        pageIndex++;
        continue;
      }
    }

    // --- Per-page fit: multicol branch vs single-column branch (T3). ---
    // `columnCount > 1` ⇒ distribute the page's content across N columns via
    // `fitColumnsOnPage` (FILL: every column at the page body block-size); the
    // page's `resumeOut` is a `ColumnBreakToken` (wrapping the last column's
    // inner BFC token) when content overflowed the last column. `columnCount === 1`
    // ⇒ the EXISTING bare `fitOnePage`, byte-identical to pre-T3.
    let childrenCount: number;
    let resumeOut: BreakToken | null;
    let listCounterAtEnd: number;
    let columnFit: ColumnsFitResult | undefined;
    // VL float fast-path (Task 3): the incoming-float snapshot stamped onto THIS
    // page's entry. The float branch sets it to the running `incomingFloats`
    // BEFORE the page is laid out (the floats shadowing this page's content-top);
    // every other branch leaves it the empty default (byte-identical non-float).
    let thisPageIncoming: readonly PlacedFloat[] = NO_INCOMING_FLOATS;
    // #528 T3: the pushed-float list stamped onto THIS page's entry — the floats
    // that overflowed the PRIOR page and land here. The float branch sets it to
    // the running `incomingPushedFloats` BEFORE the page is laid out; every other
    // branch leaves it the empty default. INERT in T3 (always empty), so it never
    // changes the output. T4's consumer reads this entry's value to place them.
    let thisPageIncomingPushed: readonly PushedFloat[] = NO_INCOMING_PUSHED_FLOATS;
    // Coherent float+pagination: the in-flow block-size THIS page consumed,
    // accumulated into `pageFlowBase` after the entry is pushed. Single-column:
    // the fit's `consumedBlockSize`. Multicol: the tallest column's consumed
    // content (the page-body height actually used) — see the multicol branch.
    let pageConsumed = 0;
    // The actual per-column rendered height (T4): the full page body block-size
    // for single-column / FILL pages (the initializer below); the BALANCED height
    // for a multicol section's FINAL page (set in the multicol branch). Declared
    // in the shared fit scope so both branches and the entry pushes read it.
    let balancedColumnHeight = effContentBlockSize;
    if (effColCfg.columnCount > 1) {
      // VL float fast-path (Task 3): `floatPageMeasurer` is ONLY ever passed for
      // single-column float docs (the producer gate routes float+multicol to the
      // legacy path), so it must never reach a multicol page. This guards a
      // misuse — in production it never fires.
      if (floatPageMeasurer !== undefined) {
        throw new Error(
          "floatPageMeasurer with multicol page — producer gate should have routed to legacy",
        );
      }
      // A prior multicol page threaded its `ColumnBreakToken` into `resumeInto`;
      // `fitColumnsOnPage` wants the INNER BFC token, so unwrap it.
      const innerResume = innerBfcToken(resumeInto);
      // #494: build the fit metas at the column TRACK width — the SAME narrow
      // width `materializePage` lays each column at — so the planned ColumnFit
      // matches materialize's actual per-column break tokens. The `trackInlineSize`
      // arithmetic below MUST be bit-identical to `virtual-layout-tree.ts`'s
      // `materializeMultiColumnBody` (same `effCfg`/`effColCfg`, same float ops);
      // that lockstep is the fix. `colMetas` has the SAME length + global child
      // indexing as `metas` (same children, different measured width), so
      // `startIndex` stays valid. Absent builder ⇒ fall back to the full-width
      // `metas` (drift-prone; only safe for width-independent fixed-height
      // content).
      const effContentInlineSize =
        effCfg.pageInlineSize - effCfg.pageMargins.inlineStart - effCfg.pageMargins.inlineEnd;
      const trackInlineSize = computeTrackInlineSize(
        effContentInlineSize,
        effColCfg.columnCount,
        effColCfg.columnGap,
      );
      const colMetas = buildMetasAtWidth ? buildMetasAtWidth(trackInlineSize) : metas;
      // M-1: `fitColumnsOnPage`'s internal `fitOnePage` calls are NOT counted by
      // `_fitOnePageCallCount` (which instruments the single-column branch only,
      // preserving `__getFitOnePageCallCountForTest`'s meaning). A multicol
      // call-count instrument, if ever wanted, gets its own counter.
      columnFit = fitColumnsOnPage(
        colMetas,
        startIndex,
        innerResume,
        effContentBlockSize,
        effColCfg.columnCount,
        listCounterAtStart,
        st.nextBoundaryIndex ?? undefined,
        pageFlowBase,
      );
      childrenCount = columnFit.totalChildrenCount;
      resumeOut = columnFit.pageResumeOut; // ColumnBreakToken | null (entry/threaded)
      listCounterAtEnd = columnFit.listCounterAtEnd;
      // F-1: when the multicol page exhausted its content at the SECTION CAP
      // (`stopBeforeIndex`) rather than the true document end, `fitColumnsOnPage`
      // returns `pageResumeOut === null` — but there IS more document (the next
      // section). Single-column gets a non-null forced-break token from
      // `fitOnePage` here; the column fit does not, so synthesize the SAME token
      // so the measure loop continues to the next section instead of terminating
      // early and dropping it. `startIndex + totalChildrenCount === nextBoundaryIndex`
      // in this case (the section's content consumed exactly up to the cap), so
      // the next page's `sectionStateAt(startIndex)` resolves the next section.
      if (
        resumeOut === null &&
        st.nextBoundaryIndex !== null &&
        startIndex + columnFit.totalChildrenCount < colMetas.length
      ) {
        resumeOut = {
          type: "block",
          resumeChildIndex: startIndex + columnFit.totalChildrenCount,
          resumeChildToken: null,
        };
      }
      // Final-page BALANCE (Task 4): the section's last multicol page evens its
      // columns (Google Docs `column-fill: balance`). Finality is EXPLICIT
      // (resolves plan-review I-1): the columns took all the section's remaining
      // content (`columnFit.pageResumeOut === null`) AND content is exhausted at the
      // section boundary/end. `>= sectionEnd` is the robust form; `pageResumeOut ===
      // null` already implies reaching effectiveEnd, so they agree today. (Read
      // `pageResumeOut`, NOT the F-1-synthesized `resumeOut`: a section-capped final
      // page synthesizes a forced-break token above, but it IS still its section's
      // final page and must balance.)
      const sectionEnd = st.nextBoundaryIndex ?? colMetas.length;
      const isFinalMulticolPage =
        columnFit.pageResumeOut === null &&
        startIndex + columnFit.totalChildrenCount >= sectionEnd;
      if (isFinalMulticolPage) {
        // Balance redistributes the SAME track-width content, so it MUST run on
        // `colMetas` (the track-width metas) — both `balanceColumnHeight` and the
        // re-fit — or the balanced height / resume tokens would disagree with the
        // narrow-track layout `materializePage` builds (#494).
        balancedColumnHeight = balanceColumnHeight(
          colMetas,
          startIndex,
          innerResume,
          effColCfg.columnCount,
          listCounterAtStart,
          effContentBlockSize,
          st.nextBoundaryIndex ?? undefined,
        );
        const balanced = fitColumnsOnPage(
          colMetas,
          startIndex,
          innerResume,
          balancedColumnHeight,
          effColCfg.columnCount,
          listCounterAtStart,
          st.nextBoundaryIndex ?? undefined,
          pageFlowBase,
        );
        // Balance only REDISTRIBUTES the same content more evenly — it must not
        // change which/how-many top-level children are placed, the resume state, or
        // the list counter. Assert in dev to catch measure drift; then adopt the
        // balanced fit. `childrenCount`/`resumeOut`/`listCounterAtEnd` stay the FILL
        // values (the dev-assert guards their invariance); we do NOT re-read them.
        if (isDevMode() && balanced.totalChildrenCount !== columnFit.totalChildrenCount) {
          throw new Error(
            `measurePass: balanced re-fit placed ${balanced.totalChildrenCount} children ` +
              `but FILL placed ${columnFit.totalChildrenCount} on final multicol page ${pageIndex}`,
          );
        }
        columnFit = balanced;
      }
      // The page-body in-flow content this multicol page consumed: the tallest
      // column's consumed height. Columns share the page-top flow base, so the
      // NEXT page's cumulative base advances by this. (Multicol+float routes to
      // legacy; this keeps the non-float cumulative chain gapless.)
      pageConsumed = columnFit.columns.reduce((m, c) => Math.max(m, c.consumedBlockSize), 0);
    } else if (floatPageMeasurer !== undefined) {
      // VL float fast-path (Task 3): measure this single-column page by running
      // the real `layoutBlock` (via the producer's closure) — the SAME call
      // `materializePage` makes — so measure↔materialize equivalence is automatic
      // (identical `layoutBlock` + identical inputs: resume token + `pageFlowBase`
      // + a fresh per-page `FloatEnvironment` seeded from the carried
      // `incomingFloats` snapshot + the per-page origin). The boxes are discarded;
      // only the plan outputs are kept.
      const fr = floatPageMeasurer({
        startIndex,
        resumeInto,
        pageFlowBase,
        incomingFloats,
        // #528 T3: the floats pushed into this page from the prior page (INERT —
        // always empty in T3; threaded so T4 only adds the placement consumer).
        incomingPushedFloats,
        contentBlockSize: effContentBlockSize,
        stopBeforeIndex: st.nextBoundaryIndex ?? undefined,
        listCounterAtStart,
        // PR2-B: the per-page content origin — field-for-field the values
        // `materializePage` passes to its single-column `layoutBlock`
        // (`effMargins.inlineStart` == `effCfg.pageMargins.inlineStart` for inline;
        // `effTopInset` == `effTop` for block).
        inlineOrigin: effCfg.pageMargins.inlineStart,
        blockOrigin: effTop,
      });
      childrenCount = fr.childrenCount;
      resumeOut = fr.resumeOut;
      listCounterAtEnd = fr.listCounterAtEnd;
      columnFit = undefined;
      pageConsumed = fr.inFlowConsumed;
      // Stamp the floats shadowing THIS page's content-top onto its entry (below).
      thisPageIncoming = incomingFloats;
      // #528 T3: stamp the pushed floats that landed on THIS page (INERT — always
      // empty in T3) onto its entry (below). T4's consumer reads it to place them.
      thisPageIncomingPushed = incomingPushedFloats;
      // Advance the running carry to the NEXT page's incoming = the floats still
      // active below this page's content-bottom (cumulative frame). A float whose
      // block-bottom (`blockOffset + blockSize`) sits past this page's
      // content-bottom (`pageFlowBase + inFlowConsumed`) keeps shadowing the next
      // page; one that ends within this page drops out.
      const nextContentTop = pageFlowBase + fr.inFlowConsumed;
      incomingFloats = fr.placedFloats.filter(
        (f) => f.blockOffset + f.blockSize > nextContentTop,
      );
      // #528 T3: advance the pushed-float carry to the floats this page deferred to
      // the next page. INERT in T3 — `fr.pushedFloats` is always `[]` (no producer),
      // so the next page's `incomingPushedFloats` stays empty and output is
      // byte-identical. T4's producer fills `fr.pushedFloats` from the BFC float
      // branch's overflow check.
      incomingPushedFloats = fr.pushedFloats;
    } else {
      _fitOnePageCallCount++;
      const result = fitOnePage(
        metas,
        startIndex,
        resumeInto,
        // This page's EFFECTIVE content block-size (C.2b-2): the doc-wide
        // `pageContentBlockSize` for a non-overriding page, else the active
        // section's geometry. The fit honors the page's OWN height.
        effContentBlockSize,
        listCounterAtStart,
        // Section cap (C.2b-1): stop before the next section boundary so a block
        // belonging to the NEXT section starts a fresh page. `null` (no next
        // boundary — last/only section) ⇒ no cap. `fitOnePage` normalizes a cap
        // `<= startIndex` to no-cap, but the SectionPlan's strictly-increasing
        // boundaries (invariant I-2) guarantee `nextBoundaryIndex > startIndex`
        // whenever it is non-null.
        st.nextBoundaryIndex ?? undefined,
        // Coherent float+pagination: the page-cumulative flow base, so the IFC
        // `paraFlowStart` stamp matches bfc's cumulative stamp field-for-field.
        pageFlowBase,
      );
      childrenCount = result.childrenCount;
      resumeOut = result.resumeOut;
      listCounterAtEnd = result.listCounterAtEnd;
      columnFit = undefined;
      pageConsumed = result.consumedBlockSize;
    }

    // The next page begins at the first child not fully consumed on this page.
    // Block-axis bookkeeping reasons about the INNER BFC token (a multicol page's
    // `resumeOut` is a `ColumnBreakToken` wrapping it; `innerBfcToken` is the
    // identity for single-column pages). When that inner token is a block token,
    // the next index is `resumeChildIndex`; otherwise it's
    // `startIndex + childrenCount`. (For an overflowing multicol page these agree:
    // the inner token is a block token at index `startIndex + totalChildrenCount`.)
    const innerResumeOut = innerBfcToken(resumeOut);
    const nextStartIndex =
      innerResumeOut !== null && innerResumeOut.type === "block"
        ? innerResumeOut.resumeChildIndex
        : startIndex + childrenCount;

    // `children` references come from the caller's cascaded root. The metas are
    // 1:1 with the root's block children, so the slice is
    // [startIndex, nextStartIndex). This matches `paginateRoot`'s per-page
    // child-fingerprint slice (`root.children.slice(startIndex,
    // breakToken.resumeChildIndex)`), so a child still mid-fragment at the page
    // bottom (whose `resumeChildIndex === startIndex + childrenCount`) is
    // counted on the NEXT page where it makes whole-block progress — keeping
    // the equivalence harness comparing the same boundary on both sides.
    // Callers that only need boundaries may omit `rootChildren`; `children` is
    // then empty.
    const sliceEnd = resumeOut === null ? metas.length : nextStartIndex;
    const children: readonly RenderNode[] =
      rootChildren !== undefined ? rootChildren.slice(startIndex, sliceEnd) : [];

    entries.push({
      pageIndex,
      blockOffset,
      // This page's effective geometry (C.2b-2): the same `effCfg` whose content
      // block-size shaped the fit above.
      blockSize: effCfg.pageBlockSize,
      pageConfig: effCfg,
      columnConfig: effColCfg,
      // The per-column distribution (T3) — set only on the multicol branch;
      // `undefined` for single-column pages.
      columnFit,
      // The actual per-column rendered height (T4): `effContentBlockSize` for
      // single-column / FILL pages, the balanced height on a section's final
      // multicol page.
      balancedColumnHeight,
      children,
      startIndex,
      resumeInto,
      // The ACTUAL token (a `ColumnBreakToken` for an overflowing multicol page,
      // a bare token for single-column) — the next page unwraps it via
      // `innerBfcToken`.
      resumeOut,
      listCounterAtStart,
      activeSectionId,
      sectionPageIndex,
      // The SAME cap (`st.nextBoundaryIndex`) passed to the fit above — so the
      // positioning pass reproduces this page's fit exactly.
      stopBeforeIndex: st.nextBoundaryIndex ?? null,
      // Header/footer body ids for THIS page (C.2c), from the CURRENT `st`.
      headerBlockId,
      footerBlockId,
      // Effective slot insets for THIS page (#328) — the SAME `effTop`/`effBottom`
      // whose content block-size shaped the fit above. The materialize pass reads
      // these to position the body origin + the footer slot.
      effectiveTopInset: effTop,
      effectiveBottomInset: effBottom,
      // Footnote fields (FN-4 D2): the no-footnote defaults; `resolveFootnotes`
      // (FN-4.2) rewrites the footnote-bearing pages downstream.
      footnoteContentBlockIds: EMPTY_FOOTNOTE_IDS,
      footnoteSlotHeight: 0,
      footnoteContinuation: EMPTY_FOOTNOTE_CONTINUATIONS,
      // Coherent float+pagination: the in-flow content this page consumed (for the
      // gapless `pageFlowBase` accumulator + reuse-path carry).
      inFlowConsumed: pageConsumed,
      // The cumulative flow offset of THIS page's content top — the running
      // `pageFlowBase` BEFORE this page's `+= pageConsumed` advance below (line
      // ~1036). This is the EXACT value passed to `fitOnePage`/`fitColumnsOnPage`
      // above, so the materialize pass can thread it into its per-column
      // `layoutBlock` and reproduce the planned resume tokens.
      pageFlowBase,
      // VL float fast-path (Task 3): the floats shadowing this page's content-top
      // (the cumulative frame). The float branch sets `thisPageIncoming` to the
      // running `incomingFloats` before the page is laid out; every other branch
      // leaves it the empty `NO_INCOMING_FLOATS` default (byte-identical
      // non-float). The materialize pass seeds its per-page `FloatEnvironment`
      // from this so its `layoutBlock` reproduces the planned float exclusion.
      incomingActiveFloats: thisPageIncoming,
      // #528 T3: the floats pushed into this page from the prior page. INERT —
      // `thisPageIncomingPushed` is the empty default on every page in T3 (no
      // producer), so this is byte-identical. T4's consumer reads it to place them.
      incomingPushedFloats: thisPageIncomingPushed,
    });

    // Populate blockToPage / blockToSpan — shared with the reuse path so the
    // two routes produce byte-identical maps. `recordBlockMaps` reasons about the
    // block-axis index range, so it takes the INNER BFC token (the column wrapper
    // would fall to its `else` branch and mis-map all remaining blocks).
    recordBlockMaps(
      children,
      rootChildren,
      metas,
      startIndex,
      pageIndex,
      innerBfcToken(resumeInto),
      innerResumeOut,
      blockToPage,
      blockToSpan,
    );

    // Advance the running-sum document-y by THIS page's effective height + gap
    // (C.2b-2), mirroring the reuse path. Done before BOTH exits.
    runningBlockOffset += effCfg.pageBlockSize + effCfg.pageGap;
    // Coherent float+pagination: advance the gapless cumulative flow base by THIS
    // page's in-flow consumed content (mirrors paginate's `pageFlowBase += inFlowConsumed`).
    pageFlowBase += pageConsumed;

    if (resumeOut === null) {
      // #528 cross-page float PUSHING — last-page landing. In-flow content is
      // exhausted on THIS page, but the float branch may have deferred ("pushed")
      // one or more floats off it (`incomingPushedFloats` was advanced from
      // `fr.pushedFloats` above). Breaking here would DROP those floats (no landing
      // page is emitted), losing a figure at the document end — data loss. Instead,
      // emit ONE MORE trailing page whose only job is to LAND the incoming pushed
      // floats at its content top: resume PAST the doc's last child so NO in-flow
      // content is laid out, and `placeIncomingPushedFloats` (the consumer, already
      // called before `layoutBlock`) places the floats. Termination is guaranteed:
      // a trailing in-flow-empty page runs no in-flow float branch, so it pushes
      // NOTHING new (`fr.pushedFloats === []`) — the consumer always PLACES, never
      // re-pushes (a float taller than a whole page overflows that trailing page).
      // So `incomingPushedFloats` becomes empty after the trailing page and the
      // loop breaks. (Non-float docs: `incomingPushedFloats` is always the empty
      // default ⇒ this is byte-identical, the original break.)
      if (incomingPushedFloats.length === 0) {
        pageIndex++;
        break;
      }
      // Resume PAST the last child (degenerate end-of-doc block token) so the
      // trailing page lays out zero in-flow children — only the pushed floats land.
      startIndex = metas.length;
      resumeInto = { type: "block", resumeChildIndex: metas.length, resumeChildToken: null };
      listCounterAtStart = listCounterAtEnd;
      pageIndex++;
      continue;
    }

    startIndex = nextStartIndex;
    resumeInto = resumeOut;
    listCounterAtStart = listCounterAtEnd;
    pageIndex++;
  }

  return buildPagePlan(
    entries,
    sectionPlan,
    pageConfig.pageInlineSize,
    pageContentBlockSize,
    blockToPage,
    blockToSpan,
  );
}

/**
 * Assemble a fully-functional `PagePlan` from finished entries + the prebuilt
 * block-index maps. Extracted from `measurePass`'s return so a downstream pass
 * that REWRITES entries (the footnote `resolveFootnotes` pass, FN-4.2) can
 * rebuild a plan whose index methods (`pageIndexOfBlock`, `pageSpanOfBlock`,
 * `pageIndexOfTemplateBlock`, `pageIndexAtBlockOffset`) reflect the NEW page
 * boundaries — not the stale ones. The caller owns `blockToPage` / `blockToSpan`
 * (built per-entry via `recordBlockMaps`, the same helper `measurePass` uses, so
 * the maps are byte-identical regardless of which pass populated them).
 *
 * `totalBlockSize` is the running-sum-correct document height (the last entry's
 * `blockOffset + pageConfig.pageBlockSize`, no trailing gap; 0 for an empty
 * plan); the template-block→first-page map is rebuilt from the entries here so
 * the caller never has to. Behavior-preserving for `measurePass` (it produced
 * exactly this object inline before the extraction).
 */
export function buildPagePlan(
  entries: readonly PagePlanEntry[],
  sectionPlan: SectionPlan,
  pageInlineSize: number,
  pageContentBlockSize: number,
  blockToPage: ReadonlyMap<string, number>,
  blockToSpan: ReadonlyMap<string, { first: number; last: number }>,
): PagePlan {
  // Running-sum-correct total document height (C.2b-2): the last page's top
  // edge plus its OWN block-size, with NO trailing gap. Pages are no longer
  // uniform-height, so a `pageCount × pageBlockSize + gaps` formula would be
  // wrong once any section overrides its geometry. For a no-override doc the
  // running sum reduces exactly to that formula. 0 pages ⇒ 0.
  const lastEntry = entries[entries.length - 1];
  const totalBlockSize =
    lastEntry === undefined ? 0 : lastEntry.blockOffset + lastEntry.pageConfig.pageBlockSize;

  // Header/footer SLOT body id → FIRST page carrying it (C.2c T6). Built from
  // the final entries (both the re-fit and reuse branches stamp
  // `headerBlockId` / `footerBlockId`), so it is path-independent. We keep the
  // FIRST page only: the same body renders into every page's slot, and a slot
  // caret resolves to that first instance (#323). `set`-only-if-absent
  // preserves the first carrier when a later page repeats the id.
  const templateBlockToPage = new Map<string, number>();
  // Footnote-body root id → FIRST (fresh) page whose slot renders it. Built from
  // each entry's `footnoteContentBlockIds` (the FRESH-started bodies on that page;
  // `measurePass` stamps `[]`, so a footnote-free doc leaves this empty). Like the
  // template map, keep the FIRST carrier — a body splitting across pages is FRESH
  // only on its starting page; consumers walk forward to its continuation pages.
  const footnoteBlockToPage = new Map<string, number>();
  for (const e of entries) {
    if (e.headerBlockId !== undefined && !templateBlockToPage.has(e.headerBlockId)) {
      templateBlockToPage.set(e.headerBlockId, e.pageIndex);
    }
    if (e.footerBlockId !== undefined && !templateBlockToPage.has(e.footerBlockId)) {
      templateBlockToPage.set(e.footerBlockId, e.pageIndex);
    }
    for (const fnId of e.footnoteContentBlockIds) {
      if (!footnoteBlockToPage.has(fnId)) {
        footnoteBlockToPage.set(fnId, e.pageIndex);
      }
    }
  }

  return {
    entries,
    sectionPlan,
    totalBlockSize,
    pageInlineSize,
    pageContentBlockSize,
    pageIndexAtBlockOffset(y: number): number {
      return pageIndexAtBlockOffset(entries, totalBlockSize, y);
    },
    pageIndexOfBlock(blockKey: string): number {
      return blockToPage.get(blockKey) ?? -1;
    },
    pageSpanOfBlock(blockKey: string): { readonly first: number; readonly last: number } | null {
      const span = blockToSpan.get(blockKey);
      return span === undefined ? null : { first: span.first, last: span.last };
    },
    pageIndexOfTemplateBlock(blockId: BlockId): number {
      return templateBlockToPage.get(blockId) ?? -1;
    },
    pageIndexOfFootnoteBlock(blockId: BlockId): number {
      return footnoteBlockToPage.get(blockId) ?? -1;
    },
  };
}

/**
 * Structural break-token equality (references differ across measure cycles, so
 * `===` would always miss). Recurses through `block` tokens' nested
 * `resumeChildToken`. Mirrors the equality `virtual-layout-tree.ts` and the
 * equivalence oracle use; the incremental reuse below compares the prior
 * entry's `resumeInto` to the current loop's `resumeInto` with it.
 */
/**
 * Whether two `SectionStateAt`s are equal for the incremental reuse gate
 * (C.2b-1): the page belongs to the SAME section AND was capped at the SAME next
 * boundary. `activeSectionId` equality proves the section membership is unchanged;
 * `nextBoundaryIndex` equality proves the forced `stopBeforeIndex` that shaped the
 * page is identical. Both must hold for the prior fit to carry forward — a
 * `SECTION_BREAK` that moves/inserts a boundary changes one of them for the pages
 * it reshaped, forcing those (and only those) to re-fit.
 */
function sectionStatesEqual(a: SectionStateAt, b: SectionStateAt): boolean {
  return a.activeSectionId === b.activeSectionId && a.nextBoundaryIndex === b.nextBoundaryIndex;
}

/**
 * Decide whether a prior page entry may be reused at the current loop position
 * — the L-PERF-C `childrenMatchFingerprint` check extended to every input that
 * governs THIS page's fit. Reuse is sound ONLY when:
 *
 *   - the whole-block-progress slice `[startIndex, startIndex + children.length)`
 *     is REFERENCE-equal to the prior entry's `children` (every fully-placed
 *     block unchanged), AND
 *   - when `resumeOut` is a block token at index K (a child resuming onto the
 *     NEXT page), child K — which the slice OMITS, but whose placed lines/rows
 *     shaped `resumeOut.resumeChildToken` — is ALSO reference-equal. We read the
 *     prior tree's node-at-K off the prior plan's NEXT entry, whose own slice
 *     STARTS at K (`prevNext.children[0]` is the prior node at K), and compare
 *     it to `rootChildren[K]`. AND
 *   - when `resumeOut === null` (the prior page ended the document), the slice
 *     reaches the CURRENT document end (`startIndex + children.length ===
 *     metasLength`); otherwise appended blocks past the old last page would be
 *     silently dropped (the reused null-resumeOut terminates the loop).
 *
 * Reference-equality of these inputs proves (via the incremental cascade's ref
 * preservation + Task-0's meta cache: equal nodes ⇒ identical metas) that
 * `fitOnePage` would produce the SAME boundary, so the prior fit carries forward
 * unchanged. Any mismatch (or a node the prior plan can't vouch for) forces a
 * re-fit. `resumeInto` structural-equality is checked by the caller.
 */
function canReusePage(
  rootChildren: readonly RenderNode[],
  startIndex: number,
  metasLength: number,
  reusable: PagePlanEntry,
  prevNext: PagePlanEntry | undefined,
): boolean {
  const sliceLen = reusable.children.length;
  // The whole-block-progress slice must fit within the current children.
  if (startIndex + sliceLen > rootChildren.length) return false;
  for (let i = 0; i < sliceLen; i++) {
    if (rootChildren[startIndex + i] !== reusable.children[i]) return false;
  }

  if (reusable.resumeOut === null) {
    // Last page in the prior plan: only reusable if it still ends the document
    // (no children appended past it). `startIndex + sliceLen` is the prior slice
    // end (== prior metas.length); it must equal the CURRENT metas.length.
    return startIndex + sliceLen === metasLength;
  }

  // The block-axis index a multicol page reached is carried by the INNER BFC
  // token its `ColumnBreakToken` wraps; for a single-column page this is the
  // identity. The reuse proof reasons about that block index, so unwrap first.
  const innerResumeOut = innerBfcToken(reusable.resumeOut);
  if (innerResumeOut !== null && innerResumeOut.type === "block") {
    // A child resuming onto the next page placed content on THIS page that
    // shaped `resumeOut`. It sits at the slice end (== K) and is omitted from
    // `children`, so verify it is unchanged via the prior NEXT entry's first
    // child (the prior tree's node at K). If the prior plan can't vouch for K
    // (no next entry, or its slice is empty), refuse reuse.
    const k = innerResumeOut.resumeChildIndex;
    if (k < 0 || k >= rootChildren.length) return false;
    if (prevNext === undefined || prevNext.children.length === 0) return false;
    if (prevNext.startIndex !== k) return false;
    return rootChildren[k] === prevNext.children[0];
  }

  // Bare ifc/table resumeOut is unreachable at the top level: the fit always
  // wraps a leaf's resume token in a top-level `block` token (the doc root is a
  // block FC) — and a multicol page's `ColumnBreakToken` likewise wraps a `block`
  // inner token — so the branches above cover every real case. Refuse reuse
  // conservatively if one ever surfaces.
  return false;
}

/**
 * Populate `blockToPage` / `blockToSpan` for one page. Shared by the re-fit and
 * the reuse paths so they produce byte-identical maps. `pageChildren` is the
 * page's whole-block-progress slice (`[startIndex, sliceEnd)`); `resumeInto` /
 * `resumeOut` are this page's INNER BFC tokens (the caller unwraps a multicol
 * page's `ColumnBreakToken` via `innerBfcToken` first, so the block-axis index
 * reasoning here only ever sees `block`/`ifc`/`table`/null). No-op when
 * `rootChildren` is omitted.
 */
export function recordBlockMaps(
  pageChildren: readonly RenderNode[],
  rootChildren: readonly RenderNode[] | undefined,
  metas: readonly BlockFitMeta[],
  startIndex: number,
  pageIndex: number,
  resumeInto: BreakToken | null,
  resumeOut: BreakToken | null,
  blockToPage: Map<string, number>,
  blockToSpan: Map<string, { first: number; last: number }>,
): void {
  // Record each top-level child key → this page. A spanning block lands in the
  // slice of the page where it makes whole-block progress (the
  // `[startIndex, sliceEnd)` rule), so it maps to that single page — not
  // necessarily the page where it visually begins. `pageChildren` is empty when
  // `rootChildren` was omitted, so the map stays empty in that case.
  for (const child of pageChildren) {
    blockToPage.set(child.key, pageIndex);
  }

  // Record the OCCUPIED page span for every top-level child that RENDERS content
  // on this page — including a spanning block the whole-block-progress
  // `pageChildren` slice omits. The occupied index range is
  // `[startIndex, lastOccupied]`:
  //   - first occupied index = `startIndex` (the page's first laid-out child,
  //     whether fresh or a continuation).
  //   - last occupied index, when `resumeOut` is a block token at
  //     `resumeChildIndex = K` (child K resumes onto the NEXT page):
  //       · child K occupies THIS page iff it actually placed content here —
  //         its deepest leaf progress ADVANCED between this page's `resumeInto`
  //         and `resumeOut` for K ⇒ `lastOccupied = K`; otherwise `K − 1`.
  //     when `resumeOut` is null (the final page): `metas.length - 1`.
  // Keeping `first` PRECISE is load-bearing: a consumer floors its backward page
  // walk at `first`, so an over-counted `first` would step onto a page the block
  // does not occupy.
  if (rootChildren === undefined) return;
  let lastOccupied: number;
  if (resumeOut !== null && resumeOut.type === "block") {
    const k = resumeOut.resumeChildIndex;
    const outProgress = deepestLeafProgress(resumeOut.resumeChildToken);
    const inProgress =
      resumeInto !== null &&
      resumeInto.type === "block" &&
      resumeInto.resumeChildIndex === k
        ? deepestLeafProgress(resumeInto.resumeChildToken)
        : 0;
    lastOccupied = outProgress > inProgress ? k : k - 1;
  } else {
    lastOccupied = metas.length - 1;
  }
  for (let idx = startIndex; idx <= lastOccupied; idx++) {
    const child = rootChildren[idx];
    if (child === undefined) continue;
    const existing = blockToSpan.get(child.key);
    if (existing === undefined) {
      blockToSpan.set(child.key, { first: pageIndex, last: pageIndex });
    } else if (pageIndex > existing.last) {
      existing.last = pageIndex;
    }
  }
}

/**
 * The deepest leaf progress count carried by a break token: the `resumeAtLine`
 * of the innermost `ifc` token or the `resumeAtRow` of the innermost `table`
 * token, found by descending each `block` token's `resumeChildToken`. `null`
 * ⇒ 0 (no continuation). Used to tell whether a spanning child placed content
 * on a page: its progress at the page's end (resumeOut) exceeds its progress at
 * the page's start (resumeInto) iff it laid out ≥1 line/row there.
 *
 * A bounded descent (block tokens nest at most as deep as the document's block
 * nesting); no cycle is possible because each step consumes one nesting level.
 */
function deepestLeafProgress(token: BreakToken | null): number {
  let t: BreakToken | null = token;
  while (t !== null) {
    if (t.type === "ifc") return t.resumeAtLine;
    if (t.type === "table") return t.resumeAtRow;
    // block token: descend into the resuming child's token.
    t = t.resumeChildToken;
  }
  return 0;
}

/**
 * Binary search the entries' half-open intervals
 * `[entry.blockOffset, nextEntry.blockOffset)` for the page containing `y`. The
 * LAST page's interval extends through `totalBlockSize` (the document bottom =
 * the last page's `blockOffset + pageBlockSize`, with NO trailing pageGap).
 * `y` is clamped to `[0, totalBlockSize]`, so out-of-range values resolve to
 * the first or last page rather than producing -1.
 *
 * The blockOffsets are a RUNNING SUM (per-page heights need not be uniform —
 * C.2b-2), so using the NEXT entry's `blockOffset` as each page's half-open
 * upper bound (and `totalBlockSize` for the last) stays gap- and
 * geometry-correct by construction — no per-page `blockOffset + blockSize +
 * pageGap` reconstruction (which would over-add a trailing gap on the last
 * page) is needed.
 */
function pageIndexAtBlockOffset(
  entries: readonly PagePlanEntry[],
  totalBlockSize: number,
  y: number,
): number {
  const last = entries.length - 1;
  if (last <= 0) return 0;
  // `last >= 1` here ⇒ `entries[0]` is present; throw is an unreachable guard.
  const first = entries[0];
  if (first === undefined) throw new Error("measure-pass: empty entries (unreachable)");
  if (y <= first.blockOffset) return 0;
  if (y >= totalBlockSize) return last;

  // Find the greatest index whose blockOffset is <= y. Each page i owns
  // [entries[i].blockOffset, upper) where upper is entries[i+1].blockOffset
  // (or totalBlockSize for the last page).
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    // `mid ∈ (0, last]` is a valid index of `entries`; throw is unreachable.
    const midEntry = entries[mid];
    if (midEntry === undefined) throw new Error(`measure-pass: entries[${mid}] missing (unreachable)`);
    if (midEntry.blockOffset <= y) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/**
 * Recursive detection of any document feature the measure pass / fit-core
 * cannot reproduce, so callers can route such documents to the legacy full
 * positioned layout. Returns `true` (UNSUPPORTED) for:
 *
 *   `position: absolute` — removed from flow by the BFC (drained into a box's
 *   `absoluteChildren`), which `buildBlockFitMetas` does not model; the doc
 *   routes to `paginateRoot`, which lays abs-pos out correctly (paginated abs-pos
 *   fragmentation is a documented v1 follow-up). `relative` stays in flow with the
 *   same advance and is NOT flagged.
 *
 * Mixed block+inline container content (handled: #253) and padded/bordered
 * containers (handled: #254) are now modeled by `buildBlockFitMetas` /
 * `fitOnePage` and oracle-proven equivalent to `paginateRoot`, so they are no
 * longer flagged.
 *
 * NOTE: this is an O(N) walk. The design calls for a cheap rolled-up cascade
 * flag on the hot path; that rollup is a separate task. This is the correctness-
 * complete detector, wired into `layoutTreeIncremental` (the paginated branch
 * gates the virtual vs legacy `paginateRoot` path on it).
 */
export function measurePassUnsupported(cascadedRoot: RenderNode): boolean {
  if (cascadedRoot.type !== "element") return false;
  return elementUnsupported(cascadedRoot);
}

function elementUnsupported(node: ElementBox): boolean {
  const cs = node.computedStyle;
  if (cs !== undefined) {
    // position:absolute: the real BFC removes the box from flow (drains it into
    // `absoluteChildren`), which the cheap measure pass does NOT model — the
    // `buildBlockFitMetas` wrapper would find no in-flow placed child and throw,
    // and even guarded would fold the out-of-flow height into the in-flow advance.
    // Route abs-pos docs to the legacy `paginateRoot` path (which handles them).
    // `relative` stays in flow with the same advance, so it is NOT flagged
    // (positioning-audit F1; paginated abs-pos fragmentation is the documented v1
    // follow-up). `fixed` is out of scope / absent from the union.
    //
    // NOTE: `float`/`clear` are NO LONGER flagged here (VL float fast-path Task 5
    // lifted them) — a SINGLE-COLUMN float/clear doc is now handled by the measure
    // pass's `floatPageMeasurer` branch. The composite legacy gate that still routes
    // float+multicol / float+footnote docs to legacy is `paginationFallsBackToLegacy`.
    if (cs.position === "absolute") return true;
  }

  for (const child of node.children) {
    if (child.type === "element" && elementUnsupported(child)) return true;
  }
  return false;
}

/**
 * True iff the subtree contains any `float` (`inline-start`/`inline-end`) or
 * `clear` (`!== "none"`) — single-column float-doc detection for the VL float
 * fast-path. A doc that has float/clear takes the measure pass's
 * `floatPageMeasurer` branch (when single-column + footnote-free per
 * `paginationFallsBackToLegacy`), running the real `layoutBlock` per page. A
 * float-free doc returns false ⇒ the existing `fitOnePage` path, byte-identical.
 */
export function hasFloatOrClear(node: RenderNode): boolean {
  if (node.type !== "element") return false;
  const cs = node.computedStyle;
  if (
    cs !== undefined &&
    (cs.float === "inline-start" || cs.float === "inline-end" || cs.clear !== "none")
  ) {
    return true;
  }
  for (const child of node.children) {
    if (child.type === "element" && hasFloatOrClear(child)) return true;
  }
  return false;
}

/**
 * The single legacy-vs-virtual pagination gate, called at every dispatch site
 * (`dispatch.ts` full-build + `layout-incremental.ts`). After Task 5 lifted
 * `float`/`clear` from `measurePassUnsupported` (which now flags only
 * `position:absolute`), a float doc routes to the virtualized fast path ONLY
 * when it is SINGLE-COLUMN AND footnote-free — the V1 measure-pass float branch's
 * scope. Float+multicol, float+footnote, and absolute docs still fall back to the
 * legacy positioned `paginateRoot`.
 */
export function paginationFallsBackToLegacy(
  root: RenderNode,
  footnoteAnchors: readonly FootnoteAnchorRef[],
): boolean {
  if (measurePassUnsupported(root)) return true; // position:absolute
  if (!hasFloatOrClear(root)) return false; // float-free ⇒ virtual handles it
  // Float doc ⇒ virtual ONLY when single-column + footnote-free (V1 scope).
  return hasMultiColumnRegion(root) || footnoteAnchors.length > 0;
}
