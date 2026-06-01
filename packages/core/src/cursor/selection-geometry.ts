import { positionsEqual, spanStart, spanEnd, selectionContextOf } from "../state";
import type { State, Span } from "../state";
import type { LayoutBox } from "../layout/layout-node";
import type { TextShaper } from "../layout/text-shaper";
import type { TextMeasurer } from "../layout/text-measurer";
import { isTextShaper, adaptShaperToMeasurer } from "../layout/text-measurer";
import type { ComputedStyle } from "../styles";
import { resolvePixelPosition, type PixelPosition } from "./cursor-position";
import {
  collectLineLeaves,
  findLineForPosition,
  getLineIndex,
  makeContextFilter,
  type AbsoluteLineBox,
} from "./line-flatten";
import { markStart, markEnd } from "../perf/perf-trace";

/**
 * Visual highlight rectangle for a span of selected content. Coords
 * are page-relative (descendants of PageBox use the page's coordinate
 * frame; otherwise document-relative).
 */
export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
  pageIndex: number;
}

/**
 * Compute visual highlight rectangles for a selection span.
 *
 * Zero-width rects are filtered out. Collapsed spans (anchor === focus)
 * return an empty array — callers that need a 1px caret rect should
 * synthesize it from `resolvePixelPosition(focus)`.
 *
 * Algorithm (LineBox-canonical; see
 * `docs/superpowers/specs/2026-05-23-linebox-canonical-anchor-design.md`):
 *   1. Normalize the span to (start, end) in document order.
 *   2. Resolve start and end to PixelPositions (for their X coords).
 *   3. Find the `AbsoluteLineBox` containing each via
 *      `findLineForPosition`.
 *   4. Iterate `allLines[startLineIdx..endLineIdx]`. For each line,
 *      emit one rect:
 *      - same-line span: x=startX, width=endX-startX.
 *      - first line of multi-line span: x=startX, width=
 *        lineRightEdge + boundaryIndicator - startX.
 *      - last line of multi-line span: x=lineLeftEdge, width=
 *        endX - lineLeftEdge.
 *      - middle line: full line content (+ boundary indicator).
 *   5. `line.isBlockBoundaryLine` drives the paragraph-break
 *      indicator after a line (replaces the prior
 *      `collectBlockBoundaryLines` traversal).
 */
export function computeSelectionRects(
  state: State,
  span: Span,
  layoutTree: LayoutBox,
  shaperOrMeasurer: TextShaper | TextMeasurer,
): SelectionRect[] {
  const t = markStart("cursor.selection-geometry");
  try {
    if (positionsEqual(span.anchor, span.focus)) return [];

    const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
      ? adaptShaperToMeasurer(shaperOrMeasurer)
      : shaperOrMeasurer;

    const start = spanStart(state, span);
    const end = spanEnd(state, span);

    const startPos = resolvePixelPosition(state, start, layoutTree, measurer);
    const endPos = resolvePixelPosition(state, end, layoutTree, measurer);
    if (startPos === null || endPos === null) return [];

    // L-PERF-D: shared with cursor-position + line-navigation via the
    // WeakMap-cached LineIndex; only the first consumer per layout
    // cycle pays the collectLineBoxes walk.
    //
    // Context isolation (#327 companion): C.2c T6 made `.all` include the
    // header/footer SLOT lines, so for a body span (start→end across pages) the
    // index range would otherwise enclose the interleaved slot lines between
    // pages. Filter candidate lines to the SELECTION's context (anchor and focus
    // share a context — cross-context spans are unsupported) so a body span emits
    // no header/footer rects and a header/footer span emits no body rects. A
    // main-only doc shares one context → the filter returns the array unchanged
    // (byte-identical, allocation-free).
    const filter = makeContextFilter(state, selectionContextOf(state, start.blockId));
    const allLines = filter(getLineIndex(layoutTree).all);
    if (allLines.length === 0) return [];

    const startLineIdx = findLineForPosition(allLines, start);
    const endLineIdx = findLineForPosition(allLines, end);
    if (startLineIdx < 0 || endLineIdx < 0) return [];

    const rects: SelectionRect[] = [];

    for (let i = startLineIdx; i <= endLineIdx; i++) {
      const rect = emitLineRect(
        allLines[i], i === startLineIdx, i === endLineIdx, startPos, endPos, measurer,
      );
      if (rect !== null) rects.push(rect);
    }

    return rects;
  } finally {
    markEnd("cursor.selection-geometry", t);
  }
}

/**
 * Per-page selection rects: emit the rects for the lines of ONE page that fall
 * within `span`, given the span's already-resolved start/end pixel positions
 * (resolved ONCE by the caller, against the virtual tree). The union over all
 * pages equals `computeSelectionRects` over the materialized tree — for
 * NON-spanning boundary blocks. A boundary block that spans a page break is NOT
 * this function's domain (a per-page lookup can't see the boundary's other-page
 * fragment); the caller detects that case and routes it to `computeSelectionRects`
 * over the bridge instead. See the Phase-4 selection-rects plan.
 */
export function computeSelectionRectsForPage(
  state: State,
  span: Span,
  pageBox: LayoutBox,
  pageIndex: number,
  startPos: PixelPosition,
  endPos: PixelPosition,
  shaperOrMeasurer: TextShaper | TextMeasurer,
): SelectionRect[] {
  const t = markStart("cursor.selection-geometry");
  try {
    if (positionsEqual(span.anchor, span.focus)) return [];
    const startPage = startPos.pageIndex;
    const endPage = endPos.pageIndex;
    if (pageIndex < startPage || pageIndex > endPage) return [];

    const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
      ? adaptShaperToMeasurer(shaperOrMeasurer)
      : shaperOrMeasurer;

    const start = spanStart(state, span);
    const end = spanEnd(state, span);

    // Context isolation (#327 companion): on a page carrying both body and
    // header/footer slot lines, the per-page index interleaves them ([header,
    // body, footer]). Filter to the SELECTION's context so a body span's lo..hi
    // range can't include this page's slot lines (and vice-versa). Single-context
    // page → array returned unchanged (byte-identical, allocation-free).
    const filter = makeContextFilter(state, selectionContextOf(state, start.blockId));
    const pageLines = filter(getLineIndex(pageBox).all);
    if (pageLines.length === 0) return [];

    // Lines on this page within the selection. On the start page the range
    // begins at the start line; on the end page it ends at the end line; on a
    // fully-enclosed middle page every line is selected.
    const lo = pageIndex === startPage ? findLineForPosition(pageLines, start) : 0;
    const hi = pageIndex === endPage ? findLineForPosition(pageLines, end) : pageLines.length - 1;
    if (lo < 0 || hi < 0) return [];

    const rects: SelectionRect[] = [];
    for (let i = lo; i <= hi; i++) {
      const rect = emitLineRect(
        pageLines[i],
        pageIndex === startPage && i === lo,
        pageIndex === endPage && i === hi,
        startPos,
        endPos,
        measurer,
      );
      if (rect !== null) rects.push(rect);
    }
    return rects;
  } finally {
    markEnd("cursor.selection-geometry", t);
  }
}

/**
 * Emit the highlight rect for one line of a selection. `isGlobalFirst` /
 * `isGlobalLast` are relative to the WHOLE selection (across pages), not just
 * this page — so a line on a fully-enclosed middle page is neither, getting a
 * full-width rect. Returns null for a zero/negative width (skipped).
 */
function emitLineRect(
  al: AbsoluteLineBox,
  isGlobalFirst: boolean,
  isGlobalLast: boolean,
  startPos: PixelPosition,
  endPos: PixelPosition,
  measurer: TextMeasurer,
): SelectionRect | null {
  const line = al.line;
  const { lineLeft, lineRight, trailingStyle } = computeLineEdges(al);
  const indicatorW = line.isBlockBoundaryLine
    ? measurer.measureWidth("  ", trailingStyle)
    : 0;

  let x: number;
  let width: number;
  if (isGlobalFirst && isGlobalLast) {
    x = startPos.x;
    width = endPos.x - startPos.x;
  } else if (isGlobalFirst) {
    x = startPos.x;
    width = lineRight + indicatorW - startPos.x;
  } else if (isGlobalLast) {
    x = lineLeft;
    width = endPos.x - lineLeft;
  } else {
    x = lineLeft;
    width = lineRight + indicatorW - lineLeft;
  }

  if (width <= 0) return null;
  return { x, y: al.absoluteY, width, height: line.blockSize, pageIndex: al.pageIndex };
}

/**
 * Compute the horizontal X extent of a line's content. For lines
 * with at least one leaf (text-run or inline-block), returns the
 * leftmost leaf's X and the rightmost leaf's right edge. For empty
 * (strut) lines, both edges collapse to the line's own X — no visible
 * content to highlight.
 *
 * Also returns the trailing leaf's computed style for paragraph-break
 * indicator measurement; null for empty lines (no content style to
 * measure against — the LineBox's own style could be used as a
 * fallback, but for now we suppress the indicator on empty lines).
 */
function computeLineEdges(al: AbsoluteLineBox): {
  lineLeft: number;
  lineRight: number;
  trailingStyle: ComputedStyle;
} {
  const leaves = collectLineLeaves(al.line, al.absoluteX);
  if (leaves.length === 0) {
    // Empty (strut) line — both edges collapse to the line's X.
    // Trailing style falls back to the LineBox's own computedStyle
    // (the IFC stamps it from the source block's parentCs at strut
    // creation), so paragraph-break indicators on empty paragraphs
    // are measured against the block's text style.
    return {
      lineLeft: al.absoluteX,
      lineRight: al.absoluteX,
      trailingStyle: al.line.computedStyle,
    };
  }
  let minX = leaves[0].absoluteX;
  let maxRight = leaves[0].absoluteX + leaves[0].width;
  for (const leaf of leaves) {
    if (leaf.absoluteX < minX) minX = leaf.absoluteX;
    const right = leaf.absoluteX + leaf.width;
    if (right > maxRight) maxRight = right;
  }
  const trailing = leaves[leaves.length - 1].computedStyle;
  return { lineLeft: minX, lineRight: maxRight, trailingStyle: trailing };
}

// Re-export for tests' convenience.
export type { PixelPosition };
