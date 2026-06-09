// packages/core/src/layout/column-fit.ts
//
// Multi-column FILL core (multi-column slice 2-fill). Columns are an inline-axis
// fragmentation sub-axis nested in page block-axis fragmentation: a multicol
// section's body content is distributed into N side-by-side column boxes per
// page by an OUTER loop that wraps the existing per-page block-axis fit
// (`fitOnePage`). Fill column 0 to `columnHeight`; when it returns a resume
// token, continue into column 1 from there; …; when the LAST column overflows,
// the page is full and that resume state becomes the next page's entry point.
//
// PURE: this operates entirely on cached `BlockFitMeta` (no layout boxes, no
// shaper), exactly like `fitOnePage`. The measure pass uses it to compute page
// boundaries; `getPage` uses the same per-column ranges to materialize the
// `MultiColumnBox`. The visual-reading-order guarantee (slice 2b) holds because
// each column receives a CONTIGUOUS doc-order run: column k+1 begins precisely
// where column k stopped.
//
// This module is FILL only. The final-page BALANCE refinement (the column height
// that evens the last fragment, CSS `column-fill: balance`) is a separate pure
// step layered on top in a follow-up slice; it calls `fitColumnsOnPage` at trial
// heights. No producer wires this into the measure pass / `getPage` yet.

import type { BlockFitMeta, FitPageResult } from "./fit-core";
import { fitOnePage } from "./fit-core";
import type { BreakToken, ColumnBreakToken } from "./fragmentation";

/** One column's slice of a multicol page's content. */
export interface ColumnFit {
  /** Top-level child index this column began distributing at. */
  readonly startIndex: number;
  /** Inner BFC resume token this column began with (`null` = started fresh). */
  readonly resumeInto: BreakToken | null;
  /** Whole top-level children fully consumed in this column. */
  readonly childrenCount: number;
  /** Inner BFC resume token out of this column (`null` = content ended within it). */
  readonly resumeOut: BreakToken | null;
  /** In-flow block-size consumed in this column (`fitOnePage`'s `consumedBlockSize`). */
  readonly consumedBlockSize: number;
}

/** Result of distributing one multicol page's content across N columns. */
export interface ColumnsFitResult {
  /**
   * Per-column fit, length === `columnCount`. Trailing columns are EMPTY
   * (`childrenCount: 0`, `resumeOut: null`) when the content ran out before the
   * last column — the common short-content case.
   */
  readonly columns: readonly ColumnFit[];
  /**
   * Resume state out of the whole page. A `ColumnBreakToken` (wrapping the last
   * column's inner BFC token) when content overflowed the last column — the next
   * page redistributes from column 0 with the wrapped inner token. `null` when
   * all remaining content fit within the N columns (section/document ends here).
   */
  readonly pageResumeOut: ColumnBreakToken | null;
  /** Ordered-list counter after the whole page (seed for the next page). */
  readonly listCounterAtEnd: number;
  /** Total whole top-level children consumed across all columns this page. */
  readonly totalChildrenCount: number;
}

/** An empty (content-exhausted) trailing column at `index` — it starts and
 *  consumes nothing, so its `resumeInto` is `null`. */
function emptyColumn(index: number): ColumnFit {
  return { startIndex: index, resumeInto: null, childrenCount: 0, resumeOut: null, consumedBlockSize: 0 };
}

/**
 * Distribute one multicol page's content across `columnCount` equal-height
 * columns, each filled to `columnHeight` via the existing block-axis
 * `fitOnePage`. Chains the columns: column k+1 resumes where column k stopped.
 *
 * - `startIndex` / `resumeInto` — where (and with what inner BFC continuation)
 *   the page begins. `resumeInto` is the INNER BFC token (the caller unwraps the
 *   previous page's `ColumnBreakToken.resumeChildToken`), never a column token.
 * - `columnHeight` — the per-column available block-size (FILL: the page body
 *   block-size; BALANCE: the balanced height — same for every column).
 * - `stopBeforeIndex` — the section cap (C.2b-1): an EXCLUSIVE upper bound on the
 *   top-level child index this page may place (the multicol section's content
 *   ends there). Content exhausts at the cap exactly as at `metas.length`;
 *   columns past the cap are empty. Passed through to every `fitOnePage`.
 *
 * Pure; positions no boxes. `columnCount === 1` reduces to a single `fitOnePage`
 * (one column spanning the page), so single-column pages are unaffected.
 */
export function fitColumnsOnPage(
  metas: readonly BlockFitMeta[],
  startIndex: number,
  resumeInto: BreakToken | null,
  columnHeight: number,
  columnCount: number,
  listCounterAtStart: number,
  stopBeforeIndex?: number,
): ColumnsFitResult {
  const columns: ColumnFit[] = [];
  let curIndex = startIndex;
  let curResume = resumeInto;
  let listCounter = listCounterAtStart;

  // The exclusive top-level index past which this page may not place content:
  // the section cap when it is active (strictly greater than `startIndex`),
  // else the end of the run. A page is full of its (section's) content once
  // `curIndex` reaches this — at which point any `resumeOut` is the cap's
  // "break-before the boundary child" ARTIFACT (a non-null token), NOT a real
  // column overflow, so the remaining columns stay empty and the page does not
  // carry a column continuation (the next section begins on its own page via the
  // section-break machinery, not via column overflow).
  const effectiveEnd =
    stopBeforeIndex !== undefined && stopBeforeIndex > startIndex
      ? Math.min(stopBeforeIndex, metas.length)
      : metas.length;

  for (let k = 0; k < columnCount; k++) {
    if (curIndex >= effectiveEnd) {
      columns.push(emptyColumn(curIndex));
      continue;
    }
    const r: FitPageResult = fitOnePage(
      metas,
      curIndex,
      curResume,
      columnHeight,
      listCounter,
      stopBeforeIndex,
    );
    columns.push({
      startIndex: curIndex,
      resumeInto: curResume,
      childrenCount: r.childrenCount,
      resumeOut: r.resumeOut,
      consumedBlockSize: r.consumedBlockSize,
    });
    listCounter = r.listCounterAtEnd;
    curIndex += r.childrenCount;
    curResume = r.resumeOut;
  }

  // Overflow out of the last column → wrap the inner BFC token so the next page
  // redistributes from column 0 (FILL never re-enters mid-columns; the inner
  // token resumes the content). The page overflows ONLY when it stopped BEFORE
  // the effective end with content still pending; reaching the end (section cap
  // or document end) means everything fit (`curResume` there is null or the cap
  // artifact, both discarded). `curIndex < effectiveEnd` ⇒ `curResume` non-null.
  const pageResumeOut: ColumnBreakToken | null =
    curIndex < effectiveEnd && curResume !== null
      ? { type: "column", resumeColumnIndex: 0, resumeChildToken: curResume }
      : null;

  return {
    columns,
    pageResumeOut,
    listCounterAtEnd: listCounter,
    totalChildrenCount: curIndex - startIndex,
  };
}
