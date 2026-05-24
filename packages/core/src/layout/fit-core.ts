// packages/core/src/layout/fit-core.ts
//
// Pure fragmentation-decision core (virtualized-layout Phase 1). The page-break
// decisions that today live inside `bfc.layoutBlock` / `ifc.layoutInlineContent`
// / `table-fc` as a side effect of producing positioned boxes are extracted
// here as PURE functions over per-block metadata. Both real layout (decide →
// position boxes) and the measure pass (decide → boundaries only) call the same
// functions, so page boundaries are computed identically whether or not boxes
// are materialized.
//
// Design: docs/superpowers/specs/2026-05-24-virtualized-layout-design.md
// Plan:   docs/superpowers/plans/2026-05-24-virtualized-layout-phase1.md
//
// SCOPE: float / `clear` documents are NOT modeled here — their break
// decisions are non-local (shared float environment). The measure-pass caller
// detects float/clear and falls back to the legacy full positioned layout.

import type { BreakToken } from "./fragmentation";

/**
 * Per-block fragmentation metadata — the allocation-free inputs the fit-core
 * needs to reproduce every break decision. RECURSIVE: mirrors the block tree.
 * A container block (list, blockquote, nested BFC) carries `children`; a leaf
 * carries either ifc line data (`lineBlockSizes` …) or table row data
 * (`rowBlockSizes`). The recursion is required because a nested container can
 * itself fragment across a page boundary, producing a recursive
 * `BlockBreakToken.resumeChildToken` that a flat top-level model cannot
 * reproduce.
 *
 * Produced from a block's cached intrinsic `BlockBox` (heights are
 * position-independent); cached per block and refreshed only for dirty blocks.
 */
export interface BlockFitMeta {
  readonly kind: "block" | "ifc" | "table";

  /** Margin-block-start / -end (logical), for adjacent-sibling collapse. */
  readonly marginBlockStart: number;
  readonly marginBlockEnd: number;

  /** Normalized break-* values (see `normalizeBreakValue`). */
  readonly breakBefore: "auto" | "page" | "avoid";
  readonly breakAfter: "auto" | "page" | "avoid";
  readonly breakInsideAvoid: boolean;

  /** Unfragmented block-size (height) of the whole block. */
  readonly totalBlockSize: number;

  /** `block` (container): recursive child metas; absent for leaves. */
  readonly children?: readonly BlockFitMeta[];

  /** `ifc` leaf: per-line block-sizes (line heights), in order. */
  readonly lineBlockSizes?: readonly number[];
  /** `ifc` leaf: CSS `orphans` (min lines kept at fragment bottom). */
  readonly orphans?: number;
  /** `ifc` leaf: CSS `widows` (min lines carried to next fragment). */
  readonly widows?: number;
  /**
   * `ifc` leaf: per-line "this line ends mid-hyphenated-pair" flag. The D.4
   * hyphen-pair back-off can move a break a line earlier; reproducing the
   * boundary needs to know which line ends a hyphenated pair.
   */
  readonly lineEndsWithHyphen?: readonly boolean[];

  /** `table` leaf: body row block-sizes, in order. (No thead/header-repeat
   *  feature exists in the engine — do not model one.) */
  readonly rowBlockSizes?: readonly number[];

  /** True when this block is `display: list-item` (ordered-list counter
   *  contribution). `fitOnePage` recurses, so nested list items are seeded
   *  correctly via the recursive walk. */
  readonly listItem?: boolean;
}

/** Result of fitting one page's worth of top-level blocks. */
export interface FitPageResult {
  /** Whole top-level blocks fully consumed on this page (from `startIndex`). */
  readonly childrenCount: number;
  /** Resume state out of this page; `null` ⇒ document end. */
  readonly resumeOut: BreakToken | null;
  /** Ordered-list counter value after this page (seed for the next page). */
  readonly listCounterAtEnd: number;
}

/** Result of fitting lines of one IFC leaf into the remaining page space. */
export interface FitLinesResult {
  /** Lines placed on this fragment (from `startLine`). */
  readonly placedLineCount: number;
  /** 0-based line to resume at on the next fragment; `null` ⇒ all placed. */
  readonly resumeAtLine: number | null;
}

/** Result of fitting body rows of one table leaf into the remaining page space. */
export interface FitRowsResult {
  /** Body rows placed on this fragment (from `startRow`). */
  readonly placedRowCount: number;
  /** 0-based body row to resume at on the next fragment; `null` ⇒ all placed. */
  readonly resumeAtRow: number | null;
}

/**
 * Decide how many lines of an IFC leaf fit in `remainingBlockSize`, honoring
 * orphans / widows / hyphen-pair back-off. Pure port of ifc.ts D.1–D.4. When
 * the result places fewer than all remaining lines but the orphans/widows/
 * hyphen rules force pushing the whole paragraph, `placedLineCount` is 0 and
 * `resumeAtLine === startLine`.
 *
 * `orphans` / `widows` are plain numbers — the CALLER must apply the CSS
 * default of 2 (`meta.orphans ?? 2`, `meta.widows ?? 2`) when reading the
 * optional `BlockFitMeta.orphans` / `.widows`; ifc.ts uses `parentCs.orphans
 * ?? 2`, so passing a raw `undefined`/`0` here would diverge.
 */
export function fitLinesInIFC(
  lineBlockSizes: readonly number[],
  lineEndsWithHyphen: readonly boolean[] | undefined,
  orphans: number,
  widows: number,
  remainingBlockSize: number,
  startLine: number,
): FitLinesResult {
  // Faithful port of ifc.ts:880–996 D.1–D.4. Operates on the suffix
  // lines[startLine..]. "Push the whole paragraph" (nothing placed) is
  // signaled by { placedLineCount: 0, resumeAtLine: startLine }.
  const pushWhole: FitLinesResult = { placedLineCount: 0, resumeAtLine: startLine };

  const suffixLength = Math.max(0, lineBlockSizes.length - startLine);

  // D.1 — greedy fit-loop on the suffix.
  let used = 0;
  let placedLineCount = 0;
  for (let fi = 0; fi < suffixLength; fi++) {
    const lineHeight = lineBlockSizes[startLine + fi];
    if (used + lineHeight > remainingBlockSize) break;
    used += lineHeight;
    placedLineCount++;
  }

  if (placedLineCount === 0) return pushWhole;

  // D.2 — orphans: at least `orphans` lines must remain on this fragment.
  if (placedLineCount < suffixLength && placedLineCount < orphans) return pushWhole;

  // D.3 — widows: at least `widows` lines must carry to the next fragment.
  while (
    placedLineCount > 0 &&
    placedLineCount < suffixLength &&
    suffixLength - placedLineCount < widows
  ) {
    placedLineCount--;
  }
  if (placedLineCount < suffixLength && placedLineCount < orphans) return pushWhole;

  // D.4 — hyphen-pair: a break must not fall between two lines of a
  // hyphenated word. The flag at suffix index (placedLineCount - 1) maps to the
  // absolute line (startLine + placedLineCount - 1).
  while (
    placedLineCount > 0 &&
    placedLineCount < suffixLength &&
    lineEndsWithHyphen?.[startLine + placedLineCount - 1] === true
  ) {
    placedLineCount--;
  }
  if (placedLineCount < suffixLength && placedLineCount < orphans) return pushWhole;

  return {
    placedLineCount,
    resumeAtLine:
      placedLineCount < suffixLength ? startLine + placedLineCount : null,
  };
}

/**
 * Decide how many body rows of a table leaf fit in `remainingBlockSize`. Pure
 * port of table-fc's row fit loop. No header-repeat (the engine has none).
 */
export function fitRowsInTable(
  _rowBlockSizes: readonly number[],
  _remainingBlockSize: number,
  _startRow: number,
): FitRowsResult {
  throw new Error("fit-core.fitRowsInTable: not implemented (Task 3)");
}

/**
 * Decide one page's content: walk top-level block metas from `startIndex`,
 * accumulating the running in-page block offset (collapsed margins + §5.4
 * first-on-fragment truncation + first-child suppression when
 * `!rootHasTopBoundary`), honoring break-before/after/inside and the §C.6
 * overflow rule, recursing into container children and delegating ifc/table
 * leaves to `fitLinesInIFC` / `fitRowsInTable`. Pure port of bfc.layoutBlock's
 * fragmentation-aware decision logic — positions no boxes.
 */
export function fitOnePage(
  _metas: readonly BlockFitMeta[],
  _startIndex: number,
  _resumeInto: BreakToken | null,
  _pageContentBlockSize: number,
  _listCounterAtStart: number,
  _rootHasTopBoundary: boolean,
): FitPageResult {
  throw new Error("fit-core.fitOnePage: not implemented (Task 4)");
}
