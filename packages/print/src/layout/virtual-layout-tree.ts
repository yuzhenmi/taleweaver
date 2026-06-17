// packages/core/src/layout/virtual-layout-tree.ts
//
// Virtualized-layout Phase 2. The on-demand page-materialization machinery.
//
// A `VirtualLayoutTree` carries the `PagePlan` (from Phase-1 `measurePass`) plus
// a memoizing `getPage(i)` that positions ONE page on demand by running the
// SAME per-page `layoutBlock` recipe `paginateRoot` runs — seeded from the
// plan's `resumeInto` token (NOT from a sequential previous-page break). This is
// the property virtualization depends on: any page can be positioned in
// isolation, identically to the sequential paginator.
//
// `getPage(i)` deep-equals `paginateRoot`'s page `i`. The whole-tree-positioning
// deep-equals `paginateRoot`'s whole tree. The equivalence suite
// (`virtual-layout-tree.test.ts`) guards this against any drift — `paginateRoot`
// is the oracle.
//
// **Unwired** (like Phase 1): `layoutTreeIncremental` is NOT changed; no
// consumer is touched. Wiring + controller migration are Phase 3.
//
// Design: docs/superpowers/specs/2026-05-24-virtualized-layout-design.md
// Plan:   docs/superpowers/plans/2026-05-24-virtualized-layout-phase2.md

import type { ElementBox } from "@taleweaver/core";
import type { BlockId } from "@taleweaver/core";
import type { LayoutContext } from "./layout-context";
import type { TextShaper } from "@taleweaver/core";
import type { Hyphenator } from "@taleweaver/core";
import type { PageConfig } from "./page-config";
import type { BlockBox, LayoutBox, MultiColumnBox } from "./layout-box";
import { createBlockBox, createMarkerBox, createMultiColumnBox } from "./layout-box";
import { physicalizeVertical } from "./physicalize-vertical";
import { adaptShaperToMeasurer } from "@taleweaver/core";
import type { PageBox } from "./page-box";
import { createPageBox } from "./page-box";
import { layoutBlock, placeIncomingPushedFloats } from "./bfc";
import { computeUsedStyle } from "./used-style";
import type { ComputedStyle, UsedStyle } from "@taleweaver/core";
import type { PagePlan, PagePlanEntry, FootnoteContinuation } from "./measure-pass";
import type { PlacedFloat, PushedFloat } from "./float-context";
import { createFloatEnvironment } from "./float-context";
import type { BreakToken } from "./fragmentation";
import { breakTokensEqual } from "./fragmentation";
import { pageConfigsEqual } from "./section-plan";
import { columnConfigsEqual, type ColumnConfig } from "@taleweaver/core";
import { computeTrackInlineSize } from "./column-config";
import { isDevMode } from "@taleweaver/core";
import { FOOTNOTE_SEPARATOR_HEIGHT, FOOTNOTE_MARKER_GAP, footnoteMarkerGutter } from "./resolve-footnotes";
import type { FieldSpec } from "./collect-page-fields";
import { substituteLayoutFields } from "./substitute-layout-fields";
import { patchRootFieldWidths } from "./patch-field-widths";
import { formatCounter } from "@taleweaver/core";

/**
 * A virtualized layout result. Discriminated from the legacy positioned
 * `LayoutBox` by `type: "virtual-root"`. Holds the `PagePlan` and lazily
 * materializes positioned `PageBox`es on demand.
 */
export interface VirtualLayoutTree {
  readonly type: "virtual-root";
  readonly plan: PagePlan;
  /** Document inline-size (== plan.pageInlineSize). */
  readonly inlineSize: number;
  /** Document block-size (== plan.totalBlockSize). */
  readonly blockSize: number;
  /**
   * FN-6.4 — each footnote body (`contentBlockId`) → the 0-based page index its
   * ANCHOR REFERENCE lands on (from `footnoteAnchorPageAssignment` over the RAW
   * measure plan — the same anchor→page source of truth `resolveFootnotes` uses
   * to assign bodies). Empty for a footnote-free doc.
   *
   * This is the `pageAssignment` shape `footnoteNumbers(anchors, policy,
   * pageAssignment)` consumes for `restart-per-page` numbering (FN-6.1). FN-6.4
   * slice 1 ONLY exposes it here so the post-layout rebuild pipeline can read it;
   * slices 2-6 thread it into the render pipeline's `footnoteNumbers` call. This
   * field changes NO numbering behaviour on its own.
   */
  readonly footnoteAnchorPages: ReadonlyMap<BlockId, number>;
  /**
   * Layout-resolved page-field values, keyed by render key (`${blockId}/inline/${i}`):
   * `page-count` (total pages) and `cross-ref-page` (the target's 1-based page, or
   * `""` for a broken ref). `page-number` is NOT here (resolved per-page at
   * materialize). Consumed by the a11y dom-mirror to substitute resolved field text.
   */
  readonly globalFieldValues: ReadonlyMap<string, string>;
  /** Position + memoize page `pageIndex`. Out-of-range throws. */
  getPage(pageIndex: number): PageBox;
  /** `getPage(from..to)`, inclusive, clamped to `[0, lastPage]`. */
  getPages(from: number, to: number): PageBox[];
}

// ---------------------------------------------------------------------------
// Test-only instrumentation: count per-page `layoutBlock` DRIVER invocations.
//
// `getPage` invokes `layoutBlock(root, …)` once per SINGLE-COLUMN page it
// positions (the top-level per-page driver call — recursion into children is
// internal). A MULTICOL page (Task 5) drives it N times — once per column track.
// The Phase-2 guard test asserts that calling only `getPage(19)` on a 20-page
// SINGLE-COLUMN tree drives layout ONCE, not 20 times — i.e. positioning page 19
// does NOT position pages 0–18. Production code pays one integer increment per
// per-page body driver call it actually materializes (N for a multicol page).
// ---------------------------------------------------------------------------

let _getPageDriverCount = 0;

/** Test-only: number of per-page `layoutBlock` driver calls since last reset. */
export function __getGetPageDriverCountForTest(): number {
  return _getPageDriverCount;
}

/** Test-only: reset the driver-call counter. */
export function __resetGetPageDriverCountForTest(): void {
  _getPageDriverCount = 0;
}

/**
 * The per-page fingerprint used by the carry-forward memo. Two pages with
 * structurally-equal fingerprints render identically, so an unchanged page from
 * a prior tree can be returned by reference (preserving paint-cache + LineIndex
 * warmth). Includes the page's EFFECTIVE geometry (`pageConfig`) so a resize or a
 * per-section geometry override never reuses a PageBox laid out at the old
 * geometry, and `listCounterAtStart` so an ordered-list seed change (which
 * changes marker text) is never reused stale.
 */
interface PageFingerprint {
  readonly children: readonly unknown[]; // cascaded child refs (reference identity)
  readonly resumeInto: BreakToken | null;
  readonly resumeOut: BreakToken | null;
  readonly blockOffset: number;
  readonly listCounterAtStart: number;
  /**
   * The EFFECTIVE per-page geometry this page was POSITIONED with (C.2b-2):
   * `PagePlanEntry.pageConfig` (the active section's override, or the doc-wide
   * config). The WHOLE config participates — not just `pageInlineSize` +
   * content-block-size — because two configs can share content-block-size yet
   * differ in margins or page-block-size, producing a DIFFERENT PageBox height
   * and DIFFERENT BFC child offsets. Compared via `pageConfigsEqual` (deep
   * field+margins compare; references differ across measure cycles). A
   * section-geometry change thus invalidates exactly that section's pages while
   * earlier sections (unchanged config) still carry forward.
   */
  readonly pageConfig: PageConfig;
  /**
   * The effective multi-column config this page was POSITIONED with (see
   * `PagePlanEntry.columnConfig`). MUST participate in the fingerprint: a
   * column-count / gap / rule change re-materializes the `MultiColumnBox` (and,
   * once T3+ land, changes the page's column distribution). Compared via
   * `columnConfigsEqual` (deep — `columnConfigsEqual` covers count/gap/rule).
   * INERT until T3 makes a multicol page lay out differently; until then it is
   * always the resolved default and never flips, so it adds no reuse misses.
   */
  readonly columnConfig: ColumnConfig;
  /**
   * The actual per-column rendered height this page was POSITIONED with (see
   * `PagePlanEntry.balancedColumnHeight`). MUST participate in the fingerprint:
   * `materializePage` lays each column into this height, so a final-page balance
   * change (FILL height → balanced height) produces a DIFFERENT MultiColumnBox even
   * when the children/resume tokens / columnConfig are unchanged. Compared by `===`
   * (a plain number).
   */
  readonly balancedColumnHeight: number;
  /**
   * The section page-break cap this page was POSITIONED with (see
   * `PagePlanEntry.stopBeforeIndex`). MUST participate in the fingerprint:
   * `materializePage` threads it into `bfc.layoutBlock`, so two entries with
   * identical children/resume tokens but DIFFERENT caps produce DIFFERENT
   * PageBoxes (one truncated at the section boundary, one not). A SECTION_BREAK
   * that creates/moves a boundary leaves a page's body refs unchanged but flips
   * its cap (e.g. null → N); without this field the carry-forward memo would
   * reuse the prior UNCAPPED PageBox and re-leak the next section's blocks onto
   * this page on the next edit cycle.
   */
  readonly stopBeforeIndex: number | null;
  /**
   * The header / footer template-body ids this page's slots were laid out from
   * (C.2c T4): `PagePlanEntry.headerBlockId` / `.footerBlockId`. `undefined`
   * when the active section/doc declares no header/footer. MUST participate so a
   * section header-id change (a SECTION_BREAK that flips the active header) re-
   * materializes the page even when its body content + resume tokens are
   * unchanged.
   */
  readonly headerBlockId: BlockId | undefined;
  readonly footerBlockId: BlockId | undefined;
  /**
   * The cascaded header / footer body REFERENCE (`templateBodies.get(id)`).
   * `undefined` when there is no id or no body for it. Reference identity is the
   * change signal: a header edit produces a NEW cascaded ElementBox for the same
   * id, so the body ref differs → re-materialize; an unchanged body carried
   * forward across measure cycles keeps the same ref → reuse. (The body lives
   * OUTSIDE `entry.children`, so without these fields a header-only edit would
   * leave the page fingerprint identical and wrongly reuse the stale slot.)
   */
  readonly headerBody: ElementBox | undefined;
  readonly footerBody: ElementBox | undefined;
  /**
   * The effective slot insets this page was POSITIONED with (#328 growing slot):
   * `PagePlanEntry.effectiveTopInset` / `.effectiveBottomInset`. DEFENSIVE-
   * REDUNDANT today — the insets are a pure function of the header/footer body
   * refs + the page geometry, both of which already participate in the
   * fingerprint, so a body-height change always flips `headerBody` / `footerBody`
   * / `pageConfig` too. Included so the fingerprint stays correct if a future
   * inset source (e.g. an explicit per-section inset attr independent of the body
   * height) is added, and so it is not deleted as dead. Two pages with identical
   * body refs + geometry have identical insets ⇒ this never blocks a valid reuse.
   */
  readonly effectiveTopInset: number;
  readonly effectiveBottomInset: number;
  /**
   * The footnote-body ids assigned to THIS page's slot (FN-4):
   * `PagePlanEntry.footnoteContentBlockIds`. An empty array ⇒ no slot. MUST
   * participate so a footnote that moves onto/off a page (a different assigned
   * set) re-materializes the page even when its body content is unchanged.
   */
  readonly footnoteContentBlockIds: readonly BlockId[];
  /**
   * The cascaded footnote-body REFERENCES (`embedBodies.get(id)`) for this
   * page's `footnoteContentBlockIds`. Reference identity is the change signal: a
   * footnote-body edit produces a NEW cascaded ElementBox for the same id, so a
   * ref differs → re-materialize; an unchanged carried-forward body keeps the
   * same ref → reuse. (The bodies live OUTSIDE `entry.children`, so without this
   * a body-content edit would leave the page fingerprint identical and wrongly
   * reuse the stale slot.) `undefined` entry for an id absent from `embedBodies`.
   */
  readonly footnoteBodies: readonly (ElementBox | undefined)[];
  /**
   * The INBOUND footnote-continuation list this page renders at the TOP of its
   * slot (FN-5.5 / E6(b)): `PagePlanEntry.footnoteContinuation`. Each element is
   * a `{ contentBlockId, resumeToken }` carried from the PRIOR page's split. MUST
   * participate so a page whose inbound continuation changed — the upstream split
   * point moved (a different `resumeToken`) OR a different body is now carried —
   * re-materializes. An empty list ⇒ no inbound continuation (the page STARTS its
   * footnotes). Compared element-wise (`contentBlockId` string ===, `resumeToken`
   * structural via `breakTokensEqual`) alongside the resolved body ref below.
   */
  readonly footnoteContinuation: readonly FootnoteContinuation[];
  /**
   * The cascaded body REFERENCES (`embedBodies.get(contentBlockId)`) for the
   * INBOUND `footnoteContinuation` list (FN-5.5 / E6(b)). Reference identity is
   * the change signal: editing a continued body produces a NEW cascaded
   * ElementBox for the same id, so the ref differs → re-materialize even when the
   * `resumeToken` is unchanged. Element-aligned with `footnoteContinuation`;
   * `undefined` for an id absent from `embedBodies`.
   */
  readonly footnoteContinuationBodies: readonly (ElementBox | undefined)[];
  /**
   * The per-page resolved PAGE-FIELD value strings this page's header/footer slots
   * display (F-2). Computed in spec order over the TEMPLATE field specs: a
   * `page-number` field's value is `formatCounter(pageIndex + 1, …)` (varies per
   * page), a `page-count`/global field's is its `globalFieldValues` entry (same
   * everywhere). MUST participate so a page whose field VALUE changed re-materializes
   * even though the cascaded body REF (the structural signal `headerBody`/`footerBody`)
   * is UNCHANGED: e.g. the doc grew a page so a later page's number shifted, or the
   * total page-count changed. The body ref is kept as the structural signal (it never
   * sees the substituted clone); this string array is the VALUE signal. Empty ⇒ no
   * template page-fields ⇒ field-free pages stay byte-identical. Compared element-wise
   * (string ===) via `childrenRefsEqual`.
   */
  readonly pageFieldValues: readonly string[];
  /**
   * The incoming active-float shadow this page was POSITIONED with
   * (`PagePlanEntry.incomingActiveFloats`): floats placed on a PRIOR page whose
   * block-bottom reaches into this page's content area. MUST participate so a
   * change to an upstream float (its size/side/offset) re-materializes exactly the
   * downstream pages its shadow touches. Empty ⇒ no incoming shadow — the
   * byte-identical default for non-float docs, so this never blocks a valid reuse.
   * Compared field-wise via `placedFloatListsEqual`.
   */
  readonly incomingActiveFloats: readonly PlacedFloat[];
  /**
   * The pushed-float list this page was POSITIONED with
   * (`PagePlanEntry.incomingPushedFloats`): floats deferred from the prior page
   * to land here (#528 T3). MUST participate so a changed pushed float
   * re-materializes the landing page. Empty ⇒ no pushed floats — the byte-
   * identical default for every page in T3 (no producer pushes yet), so this
   * never blocks a valid reuse. Compared field-wise via `pushedFloatListsEqual`.
   */
  readonly incomingPushedFloats: readonly PushedFloat[];
}

/**
 * Structural equality of two INBOUND footnote-continuation lists + their
 * resolved body refs (FN-5.5 / E6(b)). Equal iff same length AND each element
 * agrees on `contentBlockId` (string ===), `resumeToken` (structural
 * `breakTokensEqual`), and the resolved body ref (reference ===). A split point
 * that moved upstream flips a `resumeToken`; a continued-body edit flips a body
 * ref — either re-materializes the page.
 */
function footnoteContinuationsEqual(
  a: readonly FootnoteContinuation[],
  aBodies: readonly (ElementBox | undefined)[],
  b: readonly FootnoteContinuation[],
  bBodies: readonly (ElementBox | undefined)[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ac = a[i];
    const bc = b[i];
    if (ac === undefined || bc === undefined) {
      throw new Error(
        `virtual-layout-tree: footnote-continuation ${i} missing (unreachable, i < a.length === b.length)`,
      );
    }
    if (ac.contentBlockId !== bc.contentBlockId) return false;
    if (!breakTokensEqual(ac.resumeToken, bc.resumeToken)) return false;
    if (aBodies[i] !== bBodies[i]) return false;
  }
  return true;
}

/** Structural break-token equality (references differ across measure cycles). */
function childrenRefsEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Field-wise equality of two incoming active-float shadow lists (VL float
 * fast-path Task 2). Equal iff same length AND each element agrees on every
 * placement field (`side` / `inlineOffset` / `blockOffset` / `inlineSize` /
 * `blockSize`). A changed upstream float (resized, moved sides, or re-placed at a
 * different offset) flips one of these → the downstream page re-materializes.
 * Compared by value (not reference) since the carry pass (Task 3) builds fresh
 * `PlacedFloat` objects each measure cycle.
 */
function placedFloatListsEqual(a: readonly PlacedFloat[], b: readonly PlacedFloat[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (
      x.side !== y.side ||
      x.inlineOffset !== y.inlineOffset ||
      x.blockOffset !== y.blockOffset ||
      x.inlineSize !== y.inlineSize ||
      x.blockSize !== y.blockSize
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Field-wise equality of two pushed-float lists (#528 T3). Equal iff same length
 * AND each element agrees on its float `node` (reference ===, the cascaded
 * RenderNode) and `side`. A pushed-float carries no geometry (it is re-laid-out
 * on the landing page), so only node identity + side define it. INERT in T3 —
 * both lists are always empty (no producer pushes), so they compare equal and
 * no-pushed-float docs stay byte-identical; the comparison matters once T4's
 * producer fills the lists.
 */
function pushedFloatListsEqual(a: readonly PushedFloat[], b: readonly PushedFloat[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (x.node !== y.node || x.side !== y.side) {
      return false;
    }
  }
  return true;
}

/** Shared empty array for the field-free-doc fingerprint (stable ref, byte-identical). */
const EMPTY_PAGE_FIELD_VALUES: readonly string[] = Object.freeze([]);

function fingerprintsEqual(a: PageFingerprint, b: PageFingerprint): boolean {
  return (
    a.blockOffset === b.blockOffset &&
    a.listCounterAtStart === b.listCounterAtStart &&
    pageConfigsEqual(a.pageConfig, b.pageConfig) &&
    columnConfigsEqual(a.columnConfig, b.columnConfig) &&
    a.balancedColumnHeight === b.balancedColumnHeight &&
    a.stopBeforeIndex === b.stopBeforeIndex &&
    a.headerBlockId === b.headerBlockId &&
    a.footerBlockId === b.footerBlockId &&
    a.headerBody === b.headerBody &&
    a.footerBody === b.footerBody &&
    a.effectiveTopInset === b.effectiveTopInset &&
    a.effectiveBottomInset === b.effectiveBottomInset &&
    // FN-4: a different assigned footnote set OR an edited footnote body (new
    // ref) invalidates the page's slot. `childrenRefsEqual` is order-sensitive
    // element-by-element identity — exactly the contract for both the id list
    // (string ===) and the body-ref list (reference ===).
    childrenRefsEqual(a.footnoteContentBlockIds, b.footnoteContentBlockIds) &&
    childrenRefsEqual(a.footnoteBodies, b.footnoteBodies) &&
    // FN-5.5 (E6(b)): the INBOUND continuation list (the prior page's split
    // carries) + the resolved body refs. A moved upstream split point flips a
    // resumeToken; a continued-body edit flips a body ref — either re-materializes.
    footnoteContinuationsEqual(
      a.footnoteContinuation, a.footnoteContinuationBodies,
      b.footnoteContinuation, b.footnoteContinuationBodies,
    ) &&
    childrenRefsEqual(a.children, b.children) &&
    breakTokensEqual(a.resumeInto, b.resumeInto) &&
    breakTokensEqual(a.resumeOut, b.resumeOut) &&
    // F-2: a page-field VALUE change (page-number shifted across pages, or
    // page-count changed) busts the reuse even when the body refs are unchanged.
    childrenRefsEqual(a.pageFieldValues, b.pageFieldValues) &&
    // VL float fast-path: a changed upstream float shadow re-materializes exactly
    // the downstream pages it touches. Empty lists (the non-float default) compare
    // equal, so field-free / no-float docs stay byte-identical.
    placedFloatListsEqual(a.incomingActiveFloats, b.incomingActiveFloats) &&
    // #528 T3: a changed pushed float (deferred from the prior page) re-materializes
    // the landing page. Empty lists (the no-pushed-float default — always the case
    // in T3) compare equal, so byte-identical reuse holds until T4's producer lands.
    pushedFloatListsEqual(a.incomingPushedFloats, b.incomingPushedFloats)
  );
}

/**
 * Build a `VirtualLayoutTree` from a `PagePlan` and the cascaded document root.
 * Replicates `paginateRoot`'s setup ONCE (margins, root used style, content
 * context); `getPage(i)` then positions page `i` lazily by running the same
 * per-page `layoutBlock` recipe seeded from `plan.entries[i].resumeInto`.
 *
 * @param prevTree optional prior tree for carry-forward memo: an unchanged page
 *   (same fingerprint) whose prior PageBox was materialized is returned by
 *   reference, preserving paint-cache + LineIndex warmth.
 * @param cascadedTemplateContents cascaded header/footer template bodies (C.2c),
 *   keyed by body root BlockId. Captured in the closure so `materializePage`
 *   can resolve a page's header/footer body and lay it into the page's slot.
 *   T3 only STORES it (no read site yet); T4 consumes it. Defaults to an empty
 *   map so a no-header/footer doc is byte-identical.
 */
export function makeVirtualLayoutTree(
  plan: PagePlan,
  cascadedRoot: ElementBox,
  ctx: LayoutContext,
  shaper: TextShaper,
  pageConfig: PageConfig,
  prevTree?: VirtualLayoutTree,
  cascadedTemplateContents: ReadonlyMap<BlockId, ElementBox> = new Map(),
  // FN-4: cascaded footnote bodies, keyed by body root BlockId. Captured in the
  // closure as `embedBodies` so `materializePage` can lay each page's assigned
  // bodies into the footnote slot, and `fingerprintOf` can read the body refs as
  // the slot's change signal. Defaults to an empty map (no footnote bodies).
  cascadedEmbedContents: ReadonlyMap<BlockId, ElementBox> = new Map(),
  // FN-4 (D6): the RAW (pre-`resolveFootnotes`) measure plan, stored as the
  // tree's non-enumerable `__rawPlan` so the NEXT cycle's `measurePass`
  // carry-forward compares against the footnote-UNAWARE plan (the resolved
  // `plan` re-fits footnote pages, which would otherwise look like spurious
  // mismatches). Defaults to `plan` — for a footnote-free doc `resolveFootnotes`
  // returns `rawPlan` unchanged, so `plan === rawPlan` and the default is exact;
  // any tree built before FN-4 also reads back its own `plan` via the fallback.
  rawPlan: PagePlan = plan,
  // FN-6.4 slice 1: each footnote body (`contentBlockId`) → the page index its
  // anchor reference marker RENDERS on (the `footnoteNumbers` `pageAssignment`
  // shape). Computed by the producer from the RESOLVED plan + anchors (audit F2:
  // footnote-slot eviction can move an anchor past its raw-plan page) and stored on
  // the tree (`footnoteAnchorPages`) for post-layout consumers. Defaults to an empty
  // map (footnote-free doc).
  footnoteAnchorPages: ReadonlyMap<BlockId, number> = new Map(),
  // F-2 (layout-dependent fields): the page-field specs (from `collectPageFields`)
  // + the resolved document-global values (from `resolvePageFields`). Captured in
  // the closure so `materializePage` substitutes each header/footer page-field
  // placeholder with its per-page value before slot layout (self-page page-number
  // = pageIndex+1; global page-count = `globalFieldValues`), and `fingerprintOf`
  // folds the per-page value strings so a value change busts the carry-forward
  // even when the cascaded body ref is unchanged. Default empty ⇒ field-free docs
  // are byte-identical.
  fieldSpecs: readonly FieldSpec[] = [],
  globalFieldValues: ReadonlyMap<string, string> = new Map(),
  // R-F6: each MAIN-BODY layout field's final effective width (grown-or-reserved), by render
  // key — the IDENTICAL widths the converged measure pass sized the body cross-ref atoms at.
  // Used to width-patch the body root BEFORE substituting the real text, so materialize and
  // measure size each atom byte-identically (no narrower-than-reservation value lets a
  // page/column fit more children than the plan assigned ⇒ no cross-boundary duplication).
  // Defaulted empty so existing callers/tests stay byte-identical (the patch is a ref-equal
  // no-op for an empty map).
  mainBodyFieldWidths: ReadonlyMap<string, number> = new Map(),
  // Auto-hyphenation (slice 2): threaded ALONGSIDE `shaper` and captured in the
  // closure so each per-page `getPage` `layoutBlock` (body + header/footer +
  // footnote slot) lays out with the same hyphenation inputs the measure pass
  // used. Trailing + optional so existing callers/tests stay valid. `undefined`
  // ⇒ none. Carried but UNUSED in this slice.
  hyphenator?: Hyphenator,
  // #528 cross-page float pushing. Set `true` by the production producer
  // (`virtual-producer.ts`) ONLY for float docs — exactly when the plan was built
  // with the float-aware `floatPageMeasurer` — so measure and materialize agree on
  // page boundaries. Plain `measurePass`-built trees (e.g. test harnesses without
  // the float measurer) leave it `false` ⇒ floats keep the legacy overflow
  // behavior (no measure/materialize divergence). Default `false`.
  enableFloatPushing = false,
): VirtualLayoutTree {
  const margins = pageConfig.pageMargins;
  const pageContentBlockSize =
    pageConfig.pageBlockSize - margins.blockStart - margins.blockEnd;
  const pageContentInlineSize =
    pageConfig.pageInlineSize - margins.inlineStart - margins.inlineEnd;

  if (pageContentBlockSize <= 0) {
    throw new Error(
      `makeVirtualLayoutTree: pageMargins.blockStart (${margins.blockStart}) + pageMargins.blockEnd (${margins.blockEnd}) must be less than pageBlockSize (${pageConfig.pageBlockSize}).`,
    );
  }
  if (pageContentInlineSize <= 0) {
    throw new Error(
      `makeVirtualLayoutTree: pageMargins.inlineStart (${margins.inlineStart}) + pageMargins.inlineEnd (${margins.inlineEnd}) must be less than pageInlineSize (${pageConfig.pageInlineSize}).`,
    );
  }
  if (!cascadedRoot.computedStyle) {
    throw new Error("makeVirtualLayoutTree: root must be cascaded (computedStyle missing)");
  }

  // paginate.ts:162–169 — compute the root's UsedStyle once; per-page layout
  // uses the content area (page minus margins) as the BFC's containing inline
  // size, with the BFC positioned at (margins.inlineStart, margins.blockStart).
  const rootComputed: ComputedStyle = cascadedRoot.computedStyle;
  const rootUsedStyle: UsedStyle = computeUsedStyle(rootComputed, pageConfig.pageInlineSize, "indefinite");
  const contentCtx: LayoutContext = { ...ctx, containingInlineSize: pageContentInlineSize };

  // C.2c (T3): the cascaded header/footer template bodies, captured in the
  // closure keyed by body root BlockId. `materializePage` will resolve a page's
  // header/footer body from this map and lay it into the page's slot (T4
  // consumes it; T3 only stores + exposes it). Exposed as a non-enumerable hook
  // below so it stays out of the public contract surface but remains
  // inspectable for tests and reachable by the T4 read site.
  const templateBodies = cascadedTemplateContents;

  // FN-4: the cascaded footnote bodies, keyed by body root BlockId. Captured in
  // the closure so `materializePage` can resolve a page's assigned footnote
  // bodies and lay them into the footnote slot, and `fingerprintOf` can read the
  // body refs as the slot's change signal. Empty for a footnote-free doc.
  const embedBodies = cascadedEmbedContents;

  // F-2: the page-field specs + resolved global values, captured for
  // `materializePage` (substitution) and `fingerprintOf` (value fold). Only
  // TEMPLATE (header/footer) fields appear on EVERY page, so only they contribute
  // to the per-page fingerprint value array; a `host:"main"` field appears on just
  // its own page and is page-scoped in F-3 (none exist in F-2). `pageGlobalFieldValues`
  // is passed whole to `substituteLayoutFields` (it reads the global value for a
  // page-count and ignores the rest; page-number is computed from `pageIndex`).
  const pageGlobalFieldValues = globalFieldValues;
  const templateFieldSpecs = fieldSpecs.filter((s) => s.host === "template");
  const mainBodyFieldSpecs = fieldSpecs.filter((s) => s.host === "main");

  // §4.10 + R-F6: prepare the main-body root for per-page layout ONCE — width-patch each body
  // cross-ref atom to its final reservation, THEN substitute the GLOBAL field values.
  //
  // R-F6 (width-patch FIRST): `mainBodyFieldWidths` carries each body field's grown-or-reserved
  // width — IDENTICAL to what the converged measure pass used (virtual-producer.ts threads the
  // SAME merged map into both the measure-pass `patchRootFieldWidths` and here). Sizing the atom
  // to the reservation (not shrink-to-fit the real value) makes materialize and measure size it
  // byte-identically: a value NARROWER than its 2-glyph reservation (the common single-digit
  // page-ref) can no longer let a page/column fit more children at materialize than the plan
  // assigned (cross-boundary content duplication). `patchRootFieldWidths` returns `cascadedRoot`
  // unchanged for an empty map (field-free doc) ⇒ `substitutedRoot === cascadedRoot` ⇒
  // byte-identical to the pre-feature path.
  //
  // §4.10 (substitute SECOND): cross-ref-page values don't vary per page — the target's page is
  // global — so substitute once here, not per page. `pageIndex` is 0 but only used by per-page
  // page-number substitution, which (per the R-F5 invariant below) cannot occur in the main body.
  // R-F5 invariant: the ONLY main-body layout field is cross-ref-page (a GLOBAL value).
  // page-number/page-count are gated to template bodies by INSERT_PAGE_NUMBER/COUNT, so a
  // main-body page-number — which the pageIndex-0 substitution would wrongly stamp "1" —
  // cannot occur; assert it in dev.
  if (isDevMode()) {
    for (const s of mainBodyFieldSpecs) {
      if (s.fieldType !== "cross-ref-page") {
        throw new Error(
          `makeVirtualLayoutTree: unexpected main-body field type "${s.fieldType}" — only the global cross-ref-page field may appear in the main body (page-number/page-count are template-only)`,
        );
      }
    }
  }
  const substitutedRoot = substituteLayoutFields(
    patchRootFieldWidths(cascadedRoot, mainBodyFieldWidths),
    0,
    pageGlobalFieldValues,
  );

  /**
   * The per-page page-field value strings (F-2 fingerprint fold), in
   * `templateFieldSpecs` order: page-number → `formatCounter(pageIndex+1, …)`;
   * page-count/global → its `globalFieldValues` entry (or "" if unresolved). A
   * stable, deterministic array per page; an empty result for a field-free doc.
   */
  function pageFieldValuesForFingerprint(pageIndex: number): readonly string[] {
    const templateValues = templateFieldSpecs.map((s) =>
      s.fieldType === "page-number"
        ? formatCounter(pageIndex + 1, s.numberStyle)
        // When a page-count global value is absent, `substituteLayoutFields` returns the
        // node UNCHANGED (no-op, placeholder kept) — so two trees with the same absent
        // field must produce the same fingerprint string to permit reuse. "" is the
        // sentinel for that (never a real page-count value); the no-op-substitution and
        // the ""-fold are the matching pair of that invariant.
        : pageGlobalFieldValues.get(s.embedKey) ?? "",
    );
    // §4.9: main-body fields appear on only the page(s) hosting their block — fold their
    // value in for those pages so the host page re-materializes when the target's resolved
    // page (the value) changes. A target moving pages thus busts the carry-forward for the
    // page that displays the ref.
    //
    // Cross-tree-stability contract (why the element-wise fold is sound):
    //   - `mainBodyFieldSpecs` is a `filter` over the deterministic `fieldSpecs` tree walk,
    //     so the PREV and CURRENT tree's closures iterate it in IDENTICAL order — the
    //     per-page value array lines up element-for-element across trees.
    //   - the `span.first <= pageIndex <= span.last` guard includes the value on EVERY host
    //     page of a multi-page block, so both trees fold the same specs on the same pages.
    //   - therefore the cross-tree `childrenRefsEqual` fingerprint compare in `getPage` is a
    //     valid element-wise compare; and a target moving pages changes the value STRING →
    //     the fingerprint differs → the host page re-materializes (no stale value reuse).
    const mainValues: string[] = [];
    for (const spec of mainBodyFieldSpecs) {
      const span = plan.pageSpanOfBlock(spec.hostBlockId);
      if (span !== null && span.first <= pageIndex && pageIndex <= span.last) {
        mainValues.push(pageGlobalFieldValues.get(spec.embedKey) ?? "");
      }
    }
    if (templateValues.length === 0 && mainValues.length === 0) return EMPTY_PAGE_FIELD_VALUES;
    return Object.freeze([...templateValues, ...mainValues]);
  }

  // C.2c (T4): the per-page fingerprint. MOVED into the closure (from top level)
  // so it can resolve a page's header/footer body REFERENCE off `templateBodies`
  // — the slot's change signal. The cross-tree compare in `getPage` works
  // because the PREVIOUS tree's fingerprints were computed by ITS OWN closure
  // (its own `templateBodies`) and `thisFp` by this tree's: a re-cascaded body
  // (new ref) makes them differ → re-materialize; an unchanged carried-forward
  // body (same ref) → reuse. `fingerprintAt` (below, also in the closure) binds
  // to this same `fingerprintOf` automatically.
  function fingerprintOf(entry: PagePlanEntry): PageFingerprint {
    const headerBlockId = entry.headerBlockId;
    const footerBlockId = entry.footerBlockId;
    return {
      children: entry.children,
      resumeInto: entry.resumeInto,
      resumeOut: entry.resumeOut,
      blockOffset: entry.blockOffset,
      listCounterAtStart: entry.listCounterAtStart,
      pageConfig: entry.pageConfig,
      columnConfig: entry.columnConfig,
      balancedColumnHeight: entry.balancedColumnHeight,
      stopBeforeIndex: entry.stopBeforeIndex,
      headerBlockId,
      footerBlockId,
      headerBody: headerBlockId !== undefined ? templateBodies.get(headerBlockId) : undefined,
      footerBody: footerBlockId !== undefined ? templateBodies.get(footerBlockId) : undefined,
      effectiveTopInset: entry.effectiveTopInset,
      effectiveBottomInset: entry.effectiveBottomInset,
      // FN-4: the assigned footnote ids + their cascaded body refs. The id list
      // is shared by reference from the entry (so an unchanged page keeps the
      // SAME array ref — but `childrenRefsEqual` compares element-wise anyway).
      // The body refs are resolved off `embedBodies`: a body edit flips the ref.
      footnoteContentBlockIds: entry.footnoteContentBlockIds,
      footnoteBodies: entry.footnoteContentBlockIds.map((id) => embedBodies.get(id)),
      // FN-5.5 (E6(b)): the inbound continuation list + its resolved body refs.
      footnoteContinuation: entry.footnoteContinuation,
      footnoteContinuationBodies: entry.footnoteContinuation.map((c) =>
        embedBodies.get(c.contentBlockId),
      ),
      // F-2: the per-page page-field value strings (the VALUE signal; the body REF
      // above is the STRUCTURAL signal). A value change (doc grew a page → a later
      // page's number shifts, or page-count changed) busts the reuse even though the
      // cascaded body ref is unchanged.
      pageFieldValues: pageFieldValuesForFingerprint(entry.pageIndex),
      // VL float fast-path: carry the incoming float shadow into the fingerprint so
      // a changed upstream float re-materializes the pages it touches. Empty default
      // for non-float docs ⇒ byte-identical reuse.
      incomingActiveFloats: entry.incomingActiveFloats,
      // #528 T3: the pushed floats deferred onto this page. Empty default for
      // no-pushed-float docs (every page in T3) ⇒ byte-identical reuse.
      incomingPushedFloats: entry.incomingPushedFloats,
    };
  }

  // Lazy per-index memo of materialized pages. Populated on first getPage(i).
  const pageMemo = new Map<number, PageBox>();

  // Carry-forward setup: snapshot the prev tree's per-page fingerprints so we
  // can compare in getPage. We only reuse a prev page if it was actually
  // materialized — the non-materializing probe below checks that.
  const prevInternal = prevTree as VirtualLayoutTreeInternal | undefined;
  const prevFingerprints: (PageFingerprint | undefined)[] = [];
  if (prevInternal !== undefined && prevInternal.__fingerprintAt !== undefined) {
    for (const e of prevInternal.plan.entries) {
      prevFingerprints[e.pageIndex] = prevInternal.__fingerprintAt(e.pageIndex);
    }
  }

  function getPage(pageIndex: number): PageBox {
    const memoized = pageMemo.get(pageIndex);
    if (memoized !== undefined) return memoized;

    const entry = plan.entries[pageIndex];
    if (entry === undefined) {
      throw new Error(
        `VirtualLayoutTree.getPage: page index ${pageIndex} out of range (0..${plan.entries.length - 1})`,
      );
    }

    // Carry-forward memo (lazy): if the prior tree has a structurally-identical
    // fingerprint for this page AND that page was actually materialized, reuse
    // its PageBox by reference (paint-cache + LineIndex warmth preserved).
    if (prevInternal !== undefined && prevInternal.__peekMaterializedPage !== undefined) {
      const prevFp = prevFingerprints[pageIndex];
      const thisFp = fingerprintOf(entry);
      if (prevFp !== undefined && fingerprintsEqual(prevFp, thisFp)) {
        const reused = prevInternal.__peekMaterializedPage(pageIndex);
        if (reused !== undefined) {
          pageMemo.set(pageIndex, reused);
          return reused;
        }
      }
    }

    const page = materializePage(pageIndex, entry);
    pageMemo.set(pageIndex, page);
    return page;
  }

  function materializePage(pageIndex: number, entry: PagePlanEntry): PageBox {
    // Per-entry effective geometry (C.2b-2): this page is positioned with its
    // OWN `pageConfig` — the active section's geometry override (or the doc-wide
    // config when it carries none). For a no-override doc every entry's
    // `pageConfig` IS the doc-wide config (same fields), so the values below
    // equal the closure-captured ones.
    const effCfg = entry.pageConfig;
    const effMargins = effCfg.pageMargins;
    // Effective slot insets for THIS page (#328 growing slot): the body content
    // area is `[effectiveTopInset, pageBlockSize − effectiveBottomInset]` — the
    // header grows the top inset, the footer grows the bottom one. For a no-slot
    // page the insets equal the raw margins (the measure pass's `?? margin`
    // fallback), so the values below reduce to the raw-margin content area.
    const effTopInset = entry.effectiveTopInset;
    const effBottomInset = entry.effectiveBottomInset;
    // FN-4 (D1): the footnote slot reserves `footnoteSlotHeight` between the body
    // content and the footer. `effectiveBottomInset` is UNCHANGED (header/footer
    // meaning only); the slot reservation lives ONLY in `footnoteSlotHeight`, so
    // the body content area is reduced by `effBottomInset + footnoteSlotHeight`.
    // 0 for a page with no footnotes ⇒ byte-identical to the pre-FN-4 body.
    const footnoteSlotHeight = entry.footnoteSlotHeight;
    const effContentBlockSize =
      effCfg.pageBlockSize - effTopInset - effBottomInset - footnoteSlotHeight;
    // Slot-cap invariant (#329), mirroring measurePass: the producer's
    // `computeSlotInsets` pre-caps the per-section insets so the body content
    // area always retains ≥ minBody. This branch is therefore UNREACHABLE for
    // producer-built plans; it is kept as a dev-only invariant assert (not a
    // hard prod throw) because a DIRECTLY-built plan bypasses the producer cap —
    // the invariant stays visible in tests/dev without crashing production.
    if (isDevMode() && effContentBlockSize <= 0) {
      throw new Error(
        `materializePage: header/footer insets (top=${effTopInset}, bottom=${effBottomInset}) ` +
          `leave no body content area within pageBlockSize=${effCfg.pageBlockSize} — the slot ` +
          `should have been capped by the producer (see #329).`,
      );
    }
    const effContentInlineSize =
      effCfg.pageInlineSize - effMargins.inlineStart - effMargins.inlineEnd;

    // Root used-style + content context per page, but PRESERVE byte-identity for
    // uniform (doc-wide) pages: when this page's inline-size matches the doc-wide
    // config, reuse the SAME closure objects (`rootUsedStyle` / `contentCtx`),
    // so the equivalence harness (every page resolves to docWide) stays
    // byte-identical to `paginateRoot`. Only an inline-overriding section
    // recomputes them (its root used-style + containing inline-size differ).
    const sameInline = effCfg.pageInlineSize === pageConfig.pageInlineSize;
    const effRootUsedStyle: UsedStyle = sameInline
      ? rootUsedStyle
      : computeUsedStyle(rootComputed, effCfg.pageInlineSize, "indefinite");
    const effContentCtx: LayoutContext = sameInline
      ? contentCtx
      : { ...ctx, containingInlineSize: effContentInlineSize };

    // NOTE: an earlier version threaded a per-page `prevLayoutCache` built from
    // the prior tree's PageBox (buildLayoutBoxCacheFromTree(prevPage, …)) so
    // unchanged blocks WITHIN a re-materialized page reused their prior boxes
    // (intra-page L-PERF-A/-G). That was REMOVED — it reused a moved block's
    // box at its STALE position (e.g. Enter at the start of a line left the
    // text painted on the old line: the cache returned the text box at its
    // pre-edit blockOffset instead of repositioning it). Re-materializing one
    // visible page from scratch is cheap (the measure pass already decided the
    // boundaries; this just positions ~one page of blocks). A correct
    // intra-page reuse can be reinstated later (see the tracked follow-up), but
    // correctness comes first. `getPage` runs the SAME per-page driver call
    // paginateRoot runs (paginate.ts:213–220), seeded from the PLAN's
    // resumeInto — NOT a sequential previous-page break.
    // Multi-column body construction (T5). Build the page's `MultiColumnBox` by
    // laying the SAME cascaded root into N side-by-side column tracks, each at the
    // per-column slice the measure pass (`fitColumnsOnPage`) computed. The result
    // flows downstream EXACTLY like the single-column body box: it becomes
    // `bodyChildren`, the page's content child, and every box-walker (paint,
    // `collectLineBoxes`, `physicalizeVertical`, dirty-detect) already has a
    // "multicolumn" arm descending `columns` (slice 2b).
    const materializeMultiColumnBody = (
      mcEntry: PagePlanEntry,
      cap: number | undefined,
    ): MultiColumnBox => {
      // `columnFit` is REQUIRED for a multicol entry (the measure pass stamps it
      // whenever `columnConfig.columnCount > 1`); its absence is a producer bug.
      const columnFit = mcEntry.columnFit;
      if (columnFit === undefined) {
        throw new Error(
          `materializePage: multicol page ${pageIndex} (columnCount=` +
            `${mcEntry.columnConfig.columnCount}) is missing columnFit — the measure ` +
            `pass must stamp per-column distribution for every multicol page.`,
        );
      }
      const N = mcEntry.columnConfig.columnCount;
      const gap = mcEntry.columnConfig.columnGap;
      // Equal track width: the content area minus the (N−1) inter-column gaps,
      // split N ways (the Google-Docs uniform-column model).
      const trackInlineSize = computeTrackInlineSize(effContentInlineSize, N, gap);
      // Each column is laid into `balancedColumnHeight` (FILL pages: the full body
      // block-size; the section's final page: the balanced height) — the SAME
      // per-column height the measure pass distributed against.
      const columnHeight = mcEntry.balancedColumnHeight;
      const columnBoxes: BlockBox[] = [];
      for (let k = 0; k < N; k++) {
        const fit = columnFit.columns[k];
        if (fit === undefined) {
          throw new Error(
            `materializePage: multicol page ${pageIndex} column ${k} has no ColumnFit ` +
              `(measure-vs-materialize drift — columns.length=${columnFit.columns.length}, N=${N}).`,
          );
        }
        // Column offsets are RELATIVE to the MultiColumnBox's OWN frame (#497):
        // the paint renderer + line collector descend each column from the MC box's
        // absolute origin (which already carries `effMargins.inlineStart` /
        // `effTopInset`) and ADD the column's `inlineOffset`/`blockOffset`. So the
        // column's inline-offset is just `k` tracks + gaps from the MC frame origin
        // (column 0 at 0), and its block-offset is 0 (columns start at the MC box
        // top). Storing absolute page coords here double-counted the page margin —
        // the first column rendered at 2× the inline margin + 2× the top inset.
        const columnInlineStart = k * (trackInlineSize + gap);
        _getPageDriverCount++;
        const { box: rawColBox, breakToken: colBreakToken } = layoutBlock(
          // §4.10: lay the GLOBAL-value-substituted body root so a body cross-ref
          // renders its resolved page number (== cascadedRoot for a field-free body).
          substitutedRoot,
          columnInlineStart,
          0,
          // Override ONLY the inline size to the track width (mirrors the per-page
          // inline override at the `effContentCtx` computation above — there is no
          // `makeChildContext` helper in this scope).
          { ...effContentCtx, containingInlineSize: trackInlineSize },
          shaper,
          hyphenator,
          {
            availableBlockSize: columnHeight,
            pageIndex,
            // Each column resumes from the inner BFC token the measure pass seeded
            // it with (column 0's is the page's `resumeInto` unwrapped, set inside
            // `fitColumnsOnPage`; NEVER a column token).
            resumeFrom: fit.resumeInto,
            stopBeforeIndex: cap,
          },
          // Coherent float+pagination: thread the SAME cumulative flow base the
          // measure pass passed to `fitColumnsOnPage` for this page (all columns sit
          // at the page content top, so they share the page's `pageFlowBase`). This
          // makes each column's IFC `paraFlowStart` stamp cumulative — matching the
          // measure pass field-for-field so the per-column resume token agrees with
          // the planned `ColumnFit.resumeOut` (the drift guard below).
          mcEntry.pageFlowBase,
        );
        // Measure↔materialize agreement (the classic virtualized-layout hazard): a
        // column must materialize EXACTLY the slice the measure pass planned. The
        // resume-out token is the precise, partial-fragment-aware signal of "where
        // this column stopped" — comparing it to the planned `ColumnFit.resumeOut`
        // catches any drift (wrong start index, wrong height, wrong cap) that a raw
        // child-COUNT compare would miss (`childrenCount` counts only WHOLE consumed
        // children, so a leading/trailing partial fragment makes the box's
        // `children.length` ambiguous). Dev-only throw; prod never pays.
        if (isDevMode() && !breakTokensEqual(colBreakToken, fit.resumeOut)) {
          throw new Error(
            `materializePage: multicol page ${pageIndex} column ${k} materialized a ` +
              `resume token that disagrees with the measure pass's planned ColumnFit ` +
              `(measure-vs-materialize drift) — startIndex=${fit.startIndex}, ` +
              `columnHeight=${columnHeight}.`,
          );
        }
        // An empty (content-exhausted) column yields a `null` box — produce an
        // EMPTY column `BlockBox` (zero children, `blockSize: 0`) at the column's
        // MC-frame-relative inline/block origin (block = 0, #497) so geometry +
        // paint stay uniform across all N columns.
        const colBox =
          rawColBox ??
          createBlockBox(
            `${cascadedRoot.key}-mc-p${pageIndex}-col${k}`,
            columnInlineStart,
            0,
            trackInlineSize,
            0,
            ctx.writingMode,
            ctx.direction,
            rootComputed,
            effRootUsedStyle,
            [],
            trackInlineSize,
          );
        columnBoxes.push(colBox);
      }
      // The MultiColumnBox spans the FULL content inline width at the content
      // origin; its block-size is the ACTUAL rendered column height
      // (`balancedColumnHeight`), NOT `effContentBlockSize` — they differ for a
      // short FILL/balanced page (M-2).
      return createMultiColumnBox(
        `${cascadedRoot.key}-mc-p${pageIndex}`,
        effMargins.inlineStart,
        effTopInset,
        effContentInlineSize,
        columnHeight,
        ctx.writingMode,
        ctx.direction,
        rootComputed,
        effRootUsedStyle,
        columnBoxes,
        entry.columnConfig.columnRule,
        effContentInlineSize,
      );
    };

    // Section cap (C.2b-1): honor the SAME `stopBeforeIndex` the plan's
    // `fitOnePage` / `fitColumnsOnPage` applied to this page, so positioning stops
    // before the next section's leading block instead of greedily filling the
    // leftover room with it. `null` (no next boundary) ⇒ `undefined` ⇒ no cap.
    // A BLOCK-level cap shared by ALL columns of a multicol section's page.
    const stopBeforeIndex = entry.stopBeforeIndex ?? undefined;
    // The body box — a plain `BlockBox` for a single-column page (BYTE-IDENTICAL
    // to the pre-multicol path: same `layoutBlock` call, same args), or a
    // `MultiColumnBox` for a multicol section's page (T5). `null` when nothing fit
    // (guarded downstream identically to the single-column null body).
    let box: LayoutBox | null;
    if (entry.columnConfig.columnCount > 1) {
      box = materializeMultiColumnBody(entry, stopBeforeIndex);
    } else {
      _getPageDriverCount++;
      // VL float fast-path: seed a fresh per-page FloatEnvironment with the floats whose
      // shadow crosses into this page from a prior page (cumulative frame, VERBATIM — no
      // translation). For a non-float page `incomingActiveFloats` is empty ⇒ reuse
      // `effContentCtx` by reference, byte-identical to today. (Also fixes the latent
      // shared-floatEnv-across-pages leak: each materialized page gets its OWN env, so
      // this page's floats — placed by its own layoutBlock — never bleed into the next.)
      const pageFloatEnv = createFloatEnvironment();
      for (const f of entry.incomingActiveFloats) pageFloatEnv.seedPlaced(f);
      // #528 (T4): the floats PUSHED onto this page from the prior page are placed
      // at this page's content top (AFTER the active-shadow seed, BEFORE the body
      // `layoutBlock`) so the body flows around them. The positioned float boxes
      // are KEPT (appended to the body's children below, exactly like a float the
      // body placed itself); the measure pass discards its copies. Mirror the
      // measure closure (virtual-producer.ts) field-for-field for equivalence. The
      // field participates in the page-reuse fingerprint (`pushedFloatListsEqual`).
      const usesFloatEnv =
        entry.incomingActiveFloats.length > 0 || entry.incomingPushedFloats.length > 0;
      const pageContentCtx: LayoutContext =
        usesFloatEnv
          ? { ...effContentCtx, floatEnv: pageFloatEnv, isBFCRoot: true }
          : effContentCtx;
      const landedPushedFloats = placeIncomingPushedFloats(
        entry.incomingPushedFloats, pageFloatEnv, pageContentCtx,
        substitutedRoot, shaper, hyphenator, entry.pageFlowBase,
      );
      box = layoutBlock(
        // §4.10: lay the GLOBAL-value-substituted body root so a body cross-ref
        // renders its resolved page number (== cascadedRoot for a field-free body).
        substitutedRoot,
        effMargins.inlineStart,
        // Body origin (#328): the EFFECTIVE top inset, not the raw margin — a tall
        // header has grown `effectiveTopInset` past `blockStart`, pushing the body
        // down. For a no-slot page this equals `effMargins.blockStart`.
        effTopInset,
        pageContentCtx,
        shaper,
        hyphenator,
        {
          availableBlockSize: effContentBlockSize,
          pageIndex,
          resumeFrom: entry.resumeInto,
          stopBeforeIndex,
          // #528: opt into float pushing ONLY when the plan was built with the
          // float-aware measure pass (the producer sets `enableFloatPushing` for
          // float docs) — so measure and materialize agree. A float-blind plan
          // (no measurer) keeps floats overflowing, with no measure/materialize
          // divergence.
          enableFloatPushing,
        },
        // Coherent float+pagination: thread the page's cumulative flow base so the
        // single-column body's IFC `paraFlowStart` stamp is cumulative, matching the
        // measure pass field-for-field (consistency with the multicol path; on
        // non-float docs `paraFlowStart` doesn't affect box geometry).
        entry.pageFlowBase,
      ).box;
      // Append the landed pushed-float boxes to the body box's children, in the
      // SAME body-content frame the body's own floats use — so paint / hit-test /
      // line-collection reach them exactly like a normally-placed float. A null
      // body (nothing in-flow fit) still wraps the floats in an empty body box at
      // the body origin so they are not dropped. The body box's geometry is
      // preserved verbatim; only `children` grows.
      if (landedPushedFloats.length > 0) {
        if (box !== null && box.type === "block") {
          const b = box;
          box = createBlockBox(
            b.key, b.inlineOffset, b.blockOffset, b.inlineSize, b.blockSize,
            b.writingMode, b.direction, b.computedStyle, b.usedStyle,
            [...b.children, ...landedPushedFloats],
            effContentInlineSize,
            b.metadata, /* containingBlockSize */ undefined,
            b.relativeOffset, b.absoluteChildren, b.inFlowConsumed,
          );
        } else if (box === null) {
          box = createBlockBox(
            `${cascadedRoot.key}-p${pageIndex}-body`,
            effMargins.inlineStart, effTopInset, effContentInlineSize, 0,
            ctx.writingMode, ctx.direction, rootComputed, effRootUsedStyle,
            landedPushedFloats, effContentInlineSize,
          );
        }
      }
    }
    // Wrap exactly as paginate.ts:226–237. The BFC BlockBox can be null
    // (no content fit) — guard it. blockOffset is the plan's RUNNING SUM over
    // the per-page heights before this one (no longer pageIndex*(H+gap), since
    // a section may override its geometry). The PageBox block-size is the
    // SECTION's effective page block-size, not the content size.
    // The body BFC box (guarded — can be null when nothing fit). The FN-4
    // footnote slot is NOT in `children`: it is a PURE NAMED field
    // (`PageBox.footnoteSlot`), exactly like `headerSlot` / `footerSlot`. The
    // paint / dirty-detect / line-collection / cursor-baseline walkers reach it
    // BY NAME (DA3); keeping it out of `children` is what guarantees it is
    // painted / collected EXACTLY ONCE (no double-processing).
    const bodyChildren: LayoutBox[] = box ? [box] : [];

    // C.2c (T4) + #328 (growing slot): lay the page's header/footer template
    // bodies at their NATURAL height — never clipped. Each is a single-shot
    // `layoutBlock` of the cascaded body at the content inline-offset, with
    // `availableBlockSize: MAX_SAFE_INTEGER` so the body lays out fully (no
    // clip, no page-break). A header taller than its margin band GROWS the top
    // inset (`effectiveTopInset`) and PUSHES the body content down (computed in
    // the producer's `computeSlotInsets`, threaded via the entry); the footer
    // grows the bottom inset and is anchored so it ends at the page bottom.
    // (I4: passing MAX_SAFE_INTEGER is safe — bfc/ifc use `availableBlockSize`
    // only in subtractions + one fit comparison, never to size the box.)
    // It is NOT paginated: `resumeFrom: null` and no `stopBeforeIndex`. `pageIndex`
    // is passed because `FragmentationContext` requires it; it is behaviorally
    // inert for the slot's OWN layout (the slot context carries
    // `prevLayoutCache: null`, so the paginated-reuse path is never entered). The
    // slot is null when the entry carries no id, or no body matches the id.
    // Header origin is `(inlineStart, 0)` (slot grows DOWN from the page top);
    // footer origin is `(inlineStart, pageBlockSize − effectiveBottomInset)` so
    // a natural-height footer ends exactly at the page bottom (slot grows UP).
    const layoutSlot = (
      blockId: BlockId | undefined,
      slotBlockStart: number,
    ): BlockBox | null => {
      if (blockId === undefined) return null;
      const rawBody = templateBodies.get(blockId);
      if (rawBody === undefined) return null;
      // F-2: bind page-field values LATE — substitute each placeholder with its
      // per-page value (page-number = pageIndex+1; page-count = global) on a
      // spine-clone, BEFORE slot layout, so the slot's line geometry accounts for
      // the real value's width. Identity-preserving (the SAME ref returns for a
      // field-free body); the fingerprint reads the ORIGINAL `rawBody` ref as the
      // structural signal, never this clone.
      const body = substituteLayoutFields(rawBody, pageIndex, pageGlobalFieldValues);
      const { box: slotBox } = layoutBlock(
        body,
        effMargins.inlineStart,
        slotBlockStart,
        effContentCtx,
        shaper,
        hyphenator,
        { availableBlockSize: Number.MAX_SAFE_INTEGER, pageIndex, resumeFrom: null },
      );
      return slotBox;
    };
    const headerSlot = layoutSlot(entry.headerBlockId, 0);
    const footerSlot = layoutSlot(
      entry.footerBlockId,
      effCfg.pageBlockSize - effBottomInset,
    );

    // FN-4 / FN-5.5: the footnote slot. A wrapping BlockBox positioned (D1)
    // between the body content and the footer, at page-block-offset
    // `pageBlockSize − effectiveBottomInset − footnoteSlotHeight`, holding a thin
    // separator rule (FOOTNOTE_SEPARATOR_HEIGHT) followed by the stacked footnote
    // bodies. FN-5.5 renders, in order: (1) the INBOUND continuation list
    // (`entry.footnoteContinuation` — the prior page's split carries, each resumed
    // from its `resumeToken`), then (2) the FRESH bodies that STARTED on this page
    // (`entry.footnoteContentBlockIds`, resumed from null). Every body lays out
    // BOUNDED by the shrinking remaining slot area (NOT MAX as FN-4.3 used) so a
    // PARTIAL body renders exactly what `resolveFootnotes` planned. Children's
    // blockOffsets are SLOT-LOCAL (the slot is a BlockBox; the page→slot offset is
    // the wrapper's `blockOffset`).
    //
    // GATE (E4): fire iff `footnoteSlotHeight > 0` — the authoritative resolved
    // height, which is 0 EXACTLY when nothing renders (including the
    // inbound-non-empty-but-nothing-fit case, where the whole list carries
    // forward). A list-length check would draw a zero-height separator into
    // unreserved space, overlapping the footer.
    const footnoteSlot: BlockBox | null =
      footnoteSlotHeight <= 0
        ? null
        : (() => {
            const slotBlockStart =
              effCfg.pageBlockSize - effBottomInset - footnoteSlotHeight;
            const slotChildren: LayoutBox[] = [];
            // NO separator rule (user directive, deliberate deviation from Google
            // Docs): the thin horizontal line that used to sit at the slot's top
            // edge is removed. `FOOTNOTE_SEPARATOR_HEIGHT` is RETAINED as a plain
            // gap above the bodies (the cursor starts below it) so the slot-height
            // arithmetic in `resolveFootnotes`/`computeSlotLayout` is unchanged —
            // we simply emit no box (and paint nothing) for that band.
            // The slot-local cursor starts below the separator gap; `remaining` bounds
            // each body's layout by what is left of the resolved slot (E5). The
            // footnote area available to the bodies is `footnoteSlotHeight −
            // FOOTNOTE_SEPARATOR_HEIGHT`; the cursor + remaining track the SAME
            // shrinking window so a partial body renders exactly `resolveFootnotes`'s
            // plan.
            let cursor = FOOTNOTE_SEPARATOR_HEIGHT;
            let remaining = footnoteSlotHeight - FOOTNOTE_SEPARATOR_HEIGHT;
            // Lay ONE footnote body (continuation or fresh) into the slot, bounded
            // by `remaining`, resumed from `resumeToken`. Advances the cursor +
            // shrinks `remaining` by the laid box's height. Guards a missing body
            // (dev throw / prod skip), a null box, and a C.6-overflow body that
            // exceeds `remaining` (defensive — shouldn't happen since
            // `resolveFootnotes` planned the height; dev throw / prod skip).
            // The slot-local block-offset of a body box's FIRST line — descend
            // the first-child chain to the deepest LineBox, accumulating each
            // box's own blockOffset. Used to anchor the leading number marker on
            // the body's first line (Google-Docs style). Falls back to the body
            // box's own offset if the body has no line (e.g. an empty body).
            const firstLineBlockOffset = (box: LayoutBox): number => {
              let offset = 0;
              let cur: LayoutBox | undefined = box;
              // Bounded by box depth; the layout tree is finite + acyclic.
              while (cur !== undefined) {
                offset += cur.blockOffset;
                if (cur.type === "line") return offset;
                if (!("children" in cur) || cur.children.length === 0) break;
                cur = cur.children[0];
              }
              // No line descendant (e.g. an empty body): return the ACCUMULATED
              // offset at the break point, NOT the body box's own `blockOffset` —
              // the accumulation has already added `box.blockOffset` (the first
              // iteration) plus any intermediate wrapper offsets, so this is the
              // correct slot-local anchor for the leading-number marker.
              return offset;
            };
            const layBody = (
              id: BlockId,
              resumeToken: BreakToken | null,
              isFresh: boolean,
            ): void => {
              const body = embedBodies.get(id);
              if (body === undefined) {
                // A no-MVP defect (a footnote body silently missing from the
                // cascaded map). Dev-only throw; prod skips so layout never
                // crashes. Mirrors resolveFootnotes's computeSlotLayout guard.
                if (isDevMode()) {
                  throw new Error(
                    `materializePage: footnote body ${id} is absent from ` +
                      `cascadedEmbedContents — the body must be cascaded before layout.`,
                  );
                }
                return;
              }
              // Bug #415 + #416: the leading footnote-number marker, and the
              // body's marker GUTTER. The body root carries the number via
              // `markerText` (FN-6.2b, set by footnoteBodyComponent from
              // ctx.footnoteNumber). ONLY a FRESH body (the page where the footnote
              // STARTS) shows the number; a continuation tail does NOT repeat it.
              //
              // We must reserve room for the number BEFORE the body text so the
              // marker PRECEDES the text instead of painting on top of it (#415,
              // which happened because both were placed at the same inline-start).
              // So we measure the marker first, derive a gutter (markerInlineSize +
              // gap), inset the body by that gutter (LTR) / shrink its inline-size
              // (both directions), and place the marker in the reserved gutter
              // before the text — a hanging-indent "outside" list-marker layout.
              //
              // The marker is presentation-only: it never participates in the
              // body's editable cursor-offset model (that lives in embedContents)
              // and does NOT change the body's split decision (it only narrows the
              // body's wrap width, exactly as a real list-item content box would).
              const bodyMarkerText = body.computedStyle?.markerText;
              const rootCs = body.computedStyle;
              const showsMarker =
                isFresh &&
                bodyMarkerText !== undefined &&
                bodyMarkerText !== "" &&
                rootCs !== undefined;
              const measurer = adaptShaperToMeasurer(shaper);
              // CRITICAL: the gutter is the SINGLE body-narrowing source of truth —
              // the SAME `footnoteMarkerGutter` helper the measure/partition pass
              // (`computeSlotLayout`) lays this body out with (#415). Both narrow
              // the body to `effContentInlineSize − gutter`, so the wrap / line
              // count / split partition can never disagree and the planned slot
              // height always fits the rendered body. The gutter is now a FIXED
              // list-matching hanging indent (FOOTNOTE_BODY_INDENT), independent of
              // the number's width, so the body lines up exactly with a numbered
              // list item. The marker's OWN width is measured directly here (it can
              // no longer be derived from the gutter); the measure pass does not
              // need it (it only narrows the body by the fixed gutter), so there is
              // no duplicated marker measurement across the two passes.
              const gutter = footnoteMarkerGutter(body, isFresh);
              const markerInlineSize =
                showsMarker && rootCs !== undefined
                  ? measurer.measureWidth(bodyMarkerText ?? "", rootCs)
                  : 0;
              // The body's content box is narrowed by the gutter; in LTR it is also
              // shifted right by the gutter so the gutter sits at the inline-start.
              const bodyInlineSize = Math.max(0, effContentInlineSize - gutter);
              const isRtl = ctx.direction === "rtl";
              // Slot-LOCAL inline-offset (#416): the slot wrapper is positioned at
              // the page content inline-start, so its CHILDREN are 0-based — NOT
              // `effMargins.inlineStart` (that double-padded the bodies). LTR insets
              // the body past the gutter; RTL keeps the body at 0 (gutter is on the
              // right).
              const bodyInlineOffset = isRtl ? 0 : gutter;
              const bodyCtx: LayoutContext =
                gutter === 0
                  ? effContentCtx
                  : { ...effContentCtx, containingInlineSize: bodyInlineSize };
              const { box: bodyBox } = layoutBlock(
                body,
                bodyInlineOffset,
                cursor,
                bodyCtx,
                shaper,
                hyphenator,
                { availableBlockSize: remaining, pageIndex, resumeFrom: resumeToken },
              );
              // Stack the body ONLY if it actually fits the remaining slot area.
              // This mirrors computeSlotLayout's C.6 bound (`box === null ||
              // box.blockSize > remaining`): a CSS Fragmentation §3.5 C.6
              // force-placed box can exceed the bounded `remaining`, and such a
              // body is excluded from the entry's lists (carried forward instead),
              // so the plan should NEVER put a body here that doesn't fit. This is
              // a defensive guard against a future plan/reuse-gate bug from
              // over-rendering into the footer; in dev it's a real plan-mismatch
              // signal, so throw — in prod skip gracefully.
              if (bodyBox !== null && bodyBox.blockSize <= remaining) {
                slotChildren.push(bodyBox);
                if (showsMarker && rootCs !== undefined) {
                  const rootUs = computeUsedStyle(
                    rootCs,
                    effContentInlineSize,
                    "indefinite",
                  );
                  const markerBlockSize = measurer.measureHeight(rootCs);
                  // Marker inline-offset (slot-local): the number HANGS in the fixed
                  // indent gutter, right-aligned against the body text edge — a
                  // consistent hanging indent regardless of number width (so "1."
                  // and "10." both align their text at the indent), exactly like the
                  // BFC's list-item outside marker (`markerContentEdge − markerWidth
                  // − markerGap`).
                  //   LTR: the text edge is at `gutter`; the marker's right edge
                  //     sits one gap (FOOTNOTE_MARKER_GAP) short of it ⇒ offset
                  //     `gutter − markerInlineSize − gap`.
                  //   RTL (mirror): the body's right content edge is at
                  //     `effContentInlineSize − gutter`; the marker hangs just
                  //     inline-end (right) of it, one gap clear, inside the reserved
                  //     right gutter ⇒ offset `(effContentInlineSize − gutter) + gap`.
                  // Both place the number BEFORE the text in reading order.
                  const markerInlineOffset = isRtl
                    ? effContentInlineSize - gutter + FOOTNOTE_MARKER_GAP
                    : gutter - markerInlineSize - FOOTNOTE_MARKER_GAP;
                  slotChildren.push(
                    createMarkerBox(
                      `${body.key}-marker`,
                      markerInlineOffset,
                      firstLineBlockOffset(bodyBox),
                      markerInlineSize,
                      markerBlockSize,
                      ctx.writingMode,
                      ctx.direction,
                      rootCs,
                      rootUs,
                      bodyMarkerText ?? "",
                      effContentInlineSize,
                    ),
                  );
                }
                cursor += bodyBox.blockSize;
                remaining -= bodyBox.blockSize;
              } else if (bodyBox !== null && isDevMode()) {
                throw new Error(
                  `materializePage: footnote body ${id} (blockSize ` +
                    `${bodyBox.blockSize}) overruns the remaining slot area ` +
                    `(${remaining}) — the plan must not place a body that does ` +
                    `not fit (C.6-overflow bodies are carried forward).`,
                );
              }
            };
            // PLAN INVARIANT (the materialize↔plan seam): `isFresh` is decided
            // HERE by which list a body id came from — the inbound continuation
            // list is laid `isFresh: false` (no marker, resumed mid-body), the
            // fresh list `isFresh: true` (marker shown, started fresh). That is
            // ONLY correct if the two lists are DISJOINT: a body id that both
            // resumes a prior split AND "starts fresh" on this page would be laid
            // out TWICE and render its leading-number marker twice (the exact
            // double-marker regression a future plan change could introduce — e.g.
            // `resolveFootnotes` stamping a deferred/continued body into
            // `footnoteContentBlockIds`). `computeSlotLayout` guarantees
            // disjointness today (a fresh body that fully defers is carried in
            // `outboundContinuations`, never placed in `slotContentBlockIds`), but
            // assert it loudly in dev so a regression surfaces at the seam instead
            // of as a silently double-rendered marker. Prod pays nothing.
            if (isDevMode()) {
              const continuationIds = new Set<BlockId>(
                entry.footnoteContinuation.map((c) => c.contentBlockId),
              );
              for (const id of entry.footnoteContentBlockIds) {
                if (continuationIds.has(id)) {
                  throw new Error(
                    `materializePage: footnote body ${id} on page ${pageIndex} is in ` +
                      `BOTH footnoteContinuation (inbound, isFresh=false) and ` +
                      `footnoteContentBlockIds (fresh, isFresh=true) — the two lists ` +
                      `must be DISJOINT or the body (and its leading-number marker) ` +
                      `renders twice. A fresh body that fully defers must be carried ` +
                      `in outboundContinuations, never stamped as a fresh-started id.`,
                  );
                }
              }
            }
            // (E5 step 2) the INBOUND continuation list, in order, each resumed
            // from its carried `resumeToken` (the prior page's split point).
            for (const cont of entry.footnoteContinuation) {
              layBody(cont.contentBlockId, cont.resumeToken, /* isFresh */ false);
            }
            // (E5 step 3) the FRESH bodies that STARTED here, in order, resumed
            // from null. A fresh body fully deferred is NOT in this list (it is in
            // this page's outbound → the next page's inbound), so it is never
            // double-rendered.
            for (const id of entry.footnoteContentBlockIds) {
              layBody(id, null, /* isFresh */ true);
            }
            return createBlockBox(
              `footnote-slot-${pageIndex}`,
              effMargins.inlineStart,
              slotBlockStart,
              effContentInlineSize,
              footnoteSlotHeight,
              ctx.writingMode,
              ctx.direction,
              rootComputed,
              effRootUsedStyle,
              slotChildren,
              effContentInlineSize,
            );
          })();

    // Page children = the body BFC box ONLY. The footnote slot is the named
    // `PageBox.footnoteSlot` field (passed below), NOT a child — see the
    // `bodyChildren` comment above (DA3: pure named slot, walked by name, so it
    // is processed exactly once).
    const children: readonly LayoutBox[] = bodyChildren;

    const page = createPageBox(
      `page-${pageIndex}`,
      0, entry.blockOffset,
      effCfg.pageInlineSize, effCfg.pageBlockSize,
      ctx.writingMode, ctx.direction,
      rootComputed, effRootUsedStyle,
      children,
      pageIndex,
      effCfg.pageInlineSize,
      headerSlot, footerSlot, footnoteSlot,
      // #332 region-classification edges: body content area is
      // [effTopInset, pageBlockSize − effBottomInset]; the margins outside
      // are the header/footer zones. On a #328 growing slot these exceed the
      // raw margins; on a plain page they equal the page's content margins.
      effTopInset, effBottomInset,
    );
    // P3.1: bake the vertical-rl block-axis mirror into the assembled page's
    // CONTENT + named slots (the page FRAME is NOT mirrored). No-op (same
    // reference) for horizontal-tb / vertical-lr, so this is byte-identical for
    // all existing content. Mirror against the page's FULL block-size — the body
    // box and named slots carry PAGE-RELATIVE blockOffsets (body at
    // `effTopInset`, slots at their page-relative offsets), so the
    // coordinate-system parent is the whole page, NOT the content area. This is
    // distinct from `effContentBlockSize`, the CSS containing-block
    // available-size used for body child layout.
    const physPage = physicalizeVertical(page, effCfg.pageBlockSize);
    if (physPage.type !== "page") {
      throw new Error(
        `materializePage: physicalizeVertical changed the page box type to ${physPage.type}`,
      );
    }
    return physPage;
  }

  function getPages(from: number, to: number): PageBox[] {
    const last = plan.entries.length - 1;
    const lo = Math.max(0, Math.min(from, last));
    const hi = Math.max(0, Math.min(to, last));
    const pages: PageBox[] = [];
    for (let i = lo; i <= hi; i++) pages.push(getPage(i));
    return pages;
  }

  // Non-materializing peek for the NEXT tree's carry-forward memo: returns this
  // page's PageBox iff it was already materialized; never triggers layout.
  function peekMaterializedPage(pageIndex: number): PageBox | undefined {
    return pageMemo.get(pageIndex);
  }

  // This tree's per-page fingerprint, for the NEXT tree's comparison. Uses each
  // entry's own EFFECTIVE `pageConfig` (C.2b-2), so a doc-wide resize OR a
  // per-section geometry change between trees is reflected in the fingerprint.
  function fingerprintAt(pageIndex: number): PageFingerprint | undefined {
    const entry = plan.entries[pageIndex];
    if (entry === undefined) return undefined;
    return fingerprintOf(entry);
  }

  // The public tree: only the contract surface as enumerable own properties.
  // The carry-forward hooks are attached non-enumerably below so they never
  // leak via Object.keys / for..in / JSON serialization, then the whole object
  // is frozen so a consumer can't mutate the layout result. The hooks remain
  // readable off `prevTree` (they're values, not enumerable) — that's the only
  // path that touches them.
  const tree = {
    type: "virtual-root",
    plan,
    inlineSize: plan.pageInlineSize,
    blockSize: plan.totalBlockSize,
    // FN-6.4 slice 1: the anchor→reference-page assignment, exposed for the
    // post-layout rebuild pipeline (the `footnoteNumbers` `pageAssignment` shape).
    footnoteAnchorPages,
    globalFieldValues,
    getPage,
    getPages,
  } as VirtualLayoutTreeInternal;
  Object.defineProperty(tree, "__peekMaterializedPage", {
    value: peekMaterializedPage,
    enumerable: false,
  });
  Object.defineProperty(tree, "__fingerprintAt", {
    value: fingerprintAt,
    enumerable: false,
  });
  Object.defineProperty(tree, "__cascadedTemplateContents", {
    value: templateBodies,
    enumerable: false,
  });
  // FN-4.4: the cascaded footnote bodies this tree was built with, for the NEXT
  // cycle's `resolveFootnotes` reuse gate — it compares a prior-assigned body's
  // CURRENT ref against this prior ref (ref-equal iff the body is unchanged).
  Object.defineProperty(tree, "__cascadedEmbedContents", {
    value: embedBodies,
    enumerable: false,
  });
  // FN-4 (D6): the raw pre-resolveFootnotes plan, for the NEXT cycle's
  // measurePass carry-forward source.
  Object.defineProperty(tree, "__rawPlan", {
    value: rawPlan,
    enumerable: false,
  });
  Object.freeze(tree);
  return tree;
}

/**
 * Internal shape: the carry-forward hooks attached to every VirtualLayoutTree.
 * Not part of the public contract; only `makeVirtualLayoutTree` reads them off
 * a `prevTree` to drive the lazy carry-forward memo.
 */
interface VirtualLayoutTreeInternal extends VirtualLayoutTree {
  /** Already-materialized PageBox for `pageIndex`, or undefined if never materialized. Does NOT materialize. */
  readonly __peekMaterializedPage?: (pageIndex: number) => PageBox | undefined;
  /** This tree's fingerprint for `pageIndex` (uses this tree's geometry), or undefined if out of range. */
  readonly __fingerprintAt?: (pageIndex: number) => PageFingerprint | undefined;
  /**
   * The cascaded header/footer template bodies this tree was built with (C.2c),
   * keyed by body root BlockId. T3 stores it here (no read site yet); T4's
   * `materializePage` consumes it to lay bodies into each page's slot. Exposed
   * for test inspection of the threading.
   */
  readonly __cascadedTemplateContents?: ReadonlyMap<BlockId, ElementBox>;
  /**
   * The cascaded footnote bodies this tree was built with (FN-4.4), keyed by body
   * root BlockId. `buildVirtualPaginatedTree` reads `prevTree?.__cascadedEmbedContents`
   * as the NEXT cycle's `resolveFootnotes` reuse-gate comparison source — the prior
   * body ref for each id (ref-equal to the current iff the body is unchanged).
   * Equals the empty map for a footnote-free tree.
   */
  readonly __cascadedEmbedContents?: ReadonlyMap<BlockId, ElementBox>;
  /**
   * The RAW (pre-`resolveFootnotes`) measure plan this tree was built from
   * (FN-4 D6). `buildVirtualPaginatedTree` reads `prevTree?.__rawPlan` as the
   * NEXT cycle's `measurePass` carry-forward source — the footnote-UNAWARE plan,
   * so the re-fitted footnote pages in the resolved `plan` don't look like
   * spurious mismatches. Equals `plan` for a footnote-free tree.
   */
  readonly __rawPlan?: PagePlan;
}
