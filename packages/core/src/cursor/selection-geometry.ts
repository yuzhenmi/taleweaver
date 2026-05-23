import type { State } from "../state/state";
import type { Span } from "../state/block-position";
import { positionsEqual } from "../state/block-position";
import type { LayoutBox } from "../layout/layout-node";
import type { TextShaper } from "../layout/text-shaper";
import type { TextMeasurer } from "../layout/text-measurer";
import { isTextShaper, adaptShaperToMeasurer } from "../layout/text-measurer";
import type { ComputedStyle } from "../styles";
import { spanStart, spanEnd } from "../state/block-compare";
import { resolvePixelPosition, type PixelPosition } from "./cursor-position";
import {
  collectLineBoxes,
  collectLineLeaves,
  findLineForPosition,
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

    const allLines: AbsoluteLineBox[] = [];
    collectLineBoxes(layoutTree, 0, 0, allLines);
    if (allLines.length === 0) return [];

    const startLineIdx = findLineForPosition(allLines, start);
    const endLineIdx = findLineForPosition(allLines, end);
    if (startLineIdx < 0 || endLineIdx < 0) return [];

    const rects: SelectionRect[] = [];

    for (let i = startLineIdx; i <= endLineIdx; i++) {
      const al = allLines[i];
      const line = al.line;
      const isFirst = i === startLineIdx;
      const isLast = i === endLineIdx;

      const { lineLeft, lineRight, trailingStyle } = computeLineEdges(al);
      const indicatorW = line.isBlockBoundaryLine
        ? measurer.measureWidth("  ", trailingStyle)
        : 0;

      let x: number;
      let width: number;

      if (isFirst && isLast) {
        // Same-line selection.
        x = startPos.x;
        width = endPos.x - startPos.x;
      } else if (isFirst) {
        x = startPos.x;
        width = lineRight + indicatorW - startPos.x;
      } else if (isLast) {
        x = lineLeft;
        width = endPos.x - lineLeft;
      } else {
        x = lineLeft;
        width = lineRight + indicatorW - lineLeft;
      }

      if (width <= 0) continue;

      rects.push({
        x,
        y: al.absoluteY,
        width,
        height: line.blockSize,
        pageIndex: al.pageIndex,
      });
    }

    return rects;
  } finally {
    markEnd("cursor.selection-geometry", t);
  }
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
