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

import type { RenderNode, ElementBox } from "../render/render-node";
import type { BreakToken } from "./fragmentation";
import type { BlockFitMeta } from "./fit-core";
import { fitOnePage } from "./fit-core";
import type { PageConfig } from "./page-config";

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
  /** Document-y of this page's top edge. */
  readonly blockOffset: number;
  /** Page block-size (constant per config). */
  readonly blockSize: number;
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
}

/** The document's full pagination plan. */
export interface PagePlan {
  readonly entries: readonly PagePlanEntry[];
  /** Total document height (page count × page block-size + gaps). */
  readonly totalBlockSize: number;
  readonly pageInlineSize: number;
  /**
   * The page CONTENT block-size this plan was fitted at
   * (`pageBlockSize − margins.blockStart − margins.blockEnd`). Every entry's
   * boundary was computed against this value, so a `prevPlan` carry-forward is
   * only sound when the new cycle's `pageContentBlockSize` matches. The reuse
   * setup in `measurePass` refuses the entire prior plan on a mismatch (forcing
   * a full re-fit), guarding against stale boundaries if the page geometry
   * (block-size / margins) ever changes between cycles.
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
}

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
 * @param prevPlan the prior cycle's `PagePlan` for the carry-forward reuse, or
 *   `undefined` for a fresh build / boundary-only caller.
 */
export function measurePass(
  metas: readonly BlockFitMeta[],
  pageConfig: PageConfig,
  rootChildren?: readonly RenderNode[],
  prevPlan?: PagePlan,
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
    for (let k = 0; k < prevPlan.entries.length; k++) {
      prevPlanIndexByStartIndex.set(prevPlan.entries[k].startIndex, k);
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
    const blockOffset = pageIndex * (pageConfig.pageBlockSize + pageConfig.pageGap);

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
        canReusePage(rootChildren, startIndex, metas.length, reusable, prevNext)
      ) {
        const reusedSliceEnd =
          reusable.resumeOut === null ? metas.length : startIndex + reusable.children.length;
        const reusedChildren: readonly RenderNode[] = rootChildren.slice(startIndex, reusedSliceEnd);

        entries.push({
          pageIndex,
          blockOffset,
          blockSize: pageConfig.pageBlockSize,
          children: reusedChildren,
          startIndex,
          resumeInto,
          resumeOut: reusable.resumeOut,
          listCounterAtStart,
        });

        // Populate blockToPage / blockToSpan exactly as the miss path does.
        recordBlockMaps(
          reusedChildren,
          rootChildren,
          metas,
          startIndex,
          pageIndex,
          resumeInto,
          reusable.resumeOut,
          blockToPage,
          blockToSpan,
        );

        if (reusable.resumeOut === null) {
          pageIndex++;
          break;
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
        const reusedNextStartIndex =
          reusable.resumeOut.type === "block"
            ? reusable.resumeOut.resumeChildIndex
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

    _fitOnePageCallCount++;
    const result = fitOnePage(
      metas,
      startIndex,
      resumeInto,
      pageContentBlockSize,
      listCounterAtStart,
    );

    // The next page begins at the first child not fully consumed on this page.
    // When `resumeOut` is a block token, that index is `resumeChildIndex`;
    // otherwise it's `startIndex + childrenCount`.
    const nextStartIndex =
      result.resumeOut !== null && result.resumeOut.type === "block"
        ? result.resumeOut.resumeChildIndex
        : startIndex + result.childrenCount;

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
    const sliceEnd = result.resumeOut === null ? metas.length : nextStartIndex;
    const children: readonly RenderNode[] =
      rootChildren !== undefined ? rootChildren.slice(startIndex, sliceEnd) : [];

    entries.push({
      pageIndex,
      blockOffset,
      blockSize: pageConfig.pageBlockSize,
      children,
      startIndex,
      resumeInto,
      resumeOut: result.resumeOut,
      listCounterAtStart,
    });

    // Populate blockToPage / blockToSpan — shared with the reuse path so the
    // two routes produce byte-identical maps.
    recordBlockMaps(
      children,
      rootChildren,
      metas,
      startIndex,
      pageIndex,
      resumeInto,
      result.resumeOut,
      blockToPage,
      blockToSpan,
    );

    if (result.resumeOut === null) {
      pageIndex++;
      break;
    }

    startIndex = nextStartIndex;
    resumeInto = result.resumeOut;
    listCounterAtStart = result.listCounterAtEnd;
    pageIndex++;
  }

  const pageCount = pageIndex;
  const totalBlockSize =
    pageCount * pageConfig.pageBlockSize + Math.max(0, pageCount - 1) * pageConfig.pageGap;

  return {
    entries,
    totalBlockSize,
    pageInlineSize: pageConfig.pageInlineSize,
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
  };
}

/**
 * Structural break-token equality (references differ across measure cycles, so
 * `===` would always miss). Recurses through `block` tokens' nested
 * `resumeChildToken`. Mirrors the equality `virtual-layout-tree.ts` and the
 * equivalence oracle use; the incremental reuse below compares the prior
 * entry's `resumeInto` to the current loop's `resumeInto` with it.
 */
function breakTokensEqual(a: BreakToken | null, b: BreakToken | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.type !== b.type) return false;
  if (a.type === "block" && b.type === "block") {
    return a.resumeChildIndex === b.resumeChildIndex && breakTokensEqual(a.resumeChildToken, b.resumeChildToken);
  }
  if (a.type === "ifc" && b.type === "ifc") return a.resumeAtLine === b.resumeAtLine;
  if (a.type === "table" && b.type === "table") return a.resumeAtRow === b.resumeAtRow;
  return false;
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

  if (reusable.resumeOut.type === "block") {
    // A child resuming onto the next page placed content on THIS page that
    // shaped `resumeOut`. It sits at the slice end (== K) and is omitted from
    // `children`, so verify it is unchanged via the prior NEXT entry's first
    // child (the prior tree's node at K). If the prior plan can't vouch for K
    // (no next entry, or its slice is empty), refuse reuse.
    const k = reusable.resumeOut.resumeChildIndex;
    if (k < 0 || k >= rootChildren.length) return false;
    if (prevNext === undefined || prevNext.children.length === 0) return false;
    if (prevNext.startIndex !== k) return false;
    return rootChildren[k] === prevNext.children[0];
  }

  // Bare ifc/table resumeOut is unreachable at the top level: `fitOnePage`
  // always wraps a leaf's resume token in a top-level `block` token (the doc
  // root is a block FC), so the two branches above cover every real case. Refuse
  // reuse conservatively if one ever surfaces.
  return false;
}

/**
 * Populate `blockToPage` / `blockToSpan` for one page. Shared by the re-fit and
 * the reuse paths so they produce byte-identical maps. `pageChildren` is the
 * page's whole-block-progress slice (`[startIndex, sliceEnd)`); `resumeInto` /
 * `resumeOut` are this page's tokens. No-op when `rootChildren` is omitted.
 */
function recordBlockMaps(
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
 * LAST page's interval extends through `totalBlockSize` (the document bottom,
 * which has NO trailing pageGap — `totalBlockSize` uses `pageCount - 1` gaps).
 * `y` is clamped to `[0, totalBlockSize]`, so out-of-range values resolve to
 * the first or last page rather than producing -1.
 *
 * Reconstructing each page's bottom as `blockOffset + blockSize + pageGap`
 * would over-add a gap on the last page; instead we use the NEXT entry's
 * `blockOffset` as the half-open upper bound (and `totalBlockSize` for the
 * last), which is gap-correct by construction.
 */
function pageIndexAtBlockOffset(
  entries: readonly PagePlanEntry[],
  totalBlockSize: number,
  y: number,
): number {
  const last = entries.length - 1;
  if (last <= 0) return 0;
  if (y <= entries[0].blockOffset) return 0;
  if (y >= totalBlockSize) return last;

  // Find the greatest index whose blockOffset is <= y. Each page i owns
  // [entries[i].blockOffset, upper) where upper is entries[i+1].blockOffset
  // (or totalBlockSize for the last page).
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (entries[mid].blockOffset <= y) {
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
 *   `float` / `clear` — break decisions become non-local (shared float
 *   environment); OUT OF SCOPE for v1 (design §"Out of scope for v1").
 *
 * Mixed block+inline container content (handled: #253) and padded/bordered
 * containers (handled: #254) are now modeled by `buildBlockFitMetas` /
 * `fitOnePage` and oracle-proven equivalent to `paginateRoot`, so they are no
 * longer flagged.
 *
 * NOTE: this is an O(N) walk. The design calls for a cheap rolled-up cascade
 * flag on the hot path; that rollup is a separate task. This helper is the
 * correctness-complete detector used by tests and by the (not-yet-wired)
 * fallback branch — it is NOT wired into `layoutTreeIncremental` in Phase 1.
 */
export function measurePassUnsupported(cascadedRoot: RenderNode): boolean {
  if (cascadedRoot.type !== "element") return false;
  return elementUnsupported(cascadedRoot);
}

function elementUnsupported(node: ElementBox): boolean {
  const cs = node.computedStyle;
  if (cs !== undefined) {
    // float / clear: non-local break decisions, out of scope for v1.
    if (cs.float === "inline-start" || cs.float === "inline-end") return true;
    if (cs.clear !== "none") return true;
  }

  for (const child of node.children) {
    if (child.type === "element" && elementUnsupported(child)) return true;
  }
  return false;
}
