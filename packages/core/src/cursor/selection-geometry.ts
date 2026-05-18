import type { State } from "../state/state";
import { getBlock } from "../state/state";
import type { Span } from "../state/block-position";
import { positionsEqual } from "../state/block-position";
import type { LayoutBox } from "../layout/layout-node";
import type { TextShaper } from "../layout/text-shaper";
import type { TextMeasurer } from "../layout/text-measurer";
import { isTextShaper, adaptShaperToMeasurer } from "../layout/text-measurer";
import type { ComputedStyle } from "../styles";
import { spanStart, spanEnd } from "../state/block-compare";
import { inlineContentLength } from "../state/inline-content";
import { resolvePixelPosition, type PixelPosition } from "./cursor-position";
import {
  collectAllTextBoxes,
  collectBlockBoundaryLines,
  type AbsoluteTextBox,
} from "../editor/layout-utils";
import { markStart, markEnd } from "../perf/perf-trace";

/**
 * Visual highlight rectangle for a span of selected content. Coordinates
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

/** Composite key for (pageIndex, lineY). */
function lineKey(pageIndex: number, y: number): string {
  return `${pageIndex}:${y}`;
}

interface LineEdgeInfo {
  lineStartMap: Map<string, number>;
  lineEndMap: Map<string, number>;
  lineEndStylesMap: Map<string, Readonly<ComputedStyle>>;
  lineMarginTopMap: Map<string, number>;
  lineMarginBottomMap: Map<string, number>;
}

/** Build maps from (pageIndex, lineY) → leftmost/rightmost edge, trailing styles, margins. */
function buildLineEdgeMaps(boxes: readonly AbsoluteTextBox[]): LineEdgeInfo {
  const lineStartMap = new Map<string, number>();
  const lineEndMap = new Map<string, number>();
  const lineEndStylesMap = new Map<string, Readonly<ComputedStyle>>();
  const lineMarginTopMap = new Map<string, number>();
  const lineMarginBottomMap = new Map<string, number>();
  for (const b of boxes) {
    const key = lineKey(b.pageIndex, b.absoluteY);
    const leftEdge = b.absoluteX;
    const rightEdge = b.absoluteX + b.box.width;

    const prevStart = lineStartMap.get(key);
    if (prevStart === undefined || leftEdge < prevStart) {
      lineStartMap.set(key, leftEdge);
    }
    const prevEnd = lineEndMap.get(key);
    if (prevEnd === undefined || rightEdge > prevEnd) {
      lineEndMap.set(key, rightEdge);
      lineEndStylesMap.set(key, b.box.computedStyle);
    }
    if (!lineMarginTopMap.has(key)) {
      lineMarginTopMap.set(key, b.lineMarginTop);
      lineMarginBottomMap.set(key, b.lineMarginBottom);
    }
  }
  return { lineStartMap, lineEndMap, lineEndStylesMap, lineMarginTopMap, lineMarginBottomMap };
}

/** Collect sorted unique line Y values per page. */
function collectPageLines(boxes: readonly AbsoluteTextBox[]): Map<number, number[]> {
  const pageLines = new Map<number, Set<number>>();
  for (const b of boxes) {
    let set = pageLines.get(b.pageIndex);
    if (set === undefined) {
      set = new Set();
      pageLines.set(b.pageIndex, set);
    }
    set.add(b.absoluteY);
  }
  const result = new Map<number, number[]>();
  for (const [pi, ys] of pageLines) {
    result.set(pi, [...ys].sort((a, b) => a - b));
  }
  return result;
}

/**
 * Compute visual highlight rectangles for a selection span.
 *
 * Zero-width rects are filtered out. Collapsed spans (anchor === focus)
 * return an empty array — callers that need a 1px caret rect should
 * synthesize it from `resolvePixelPosition(focus)`.
 *
 * Algorithm (mirrors `editor/selection-geometry-legacy.ts`, adapted for
 * new `Span` shape):
 *   1. Normalize the span to (start, end) in document order via
 *      `spanStart` / `spanEnd`.
 *   2. Resolve start and end to PixelPosition via `resolvePixelPosition`.
 *   3. Build line-edge / per-page line maps from layout text-runs.
 *   4. Same line / same page: one rect from startPos.x to endPos.x.
 *   5. Multi-line / multi-page: emit a "first line" rect from startPos.x
 *      to that line's right edge (+ paragraph-break indicator if the
 *      line is a block boundary), zero or more "middle line" rects each
 *      spanning the full content of the line, and a "last line" rect
 *      from that line's start to endPos.x.
 *   6. Virtual-line-break detection: when end.offset exceeds the inline
 *      content length of the end-block, add a small bridge after end.x
 *      so the last rect visually extends past the last character.
 */
export function computeSelectionRects(
  state: State,
  span: Span,
  layoutTree: LayoutBox,
  shaperOrMeasurer: TextShaper | TextMeasurer,
): SelectionRect[] {
  const t = markStart("cursor.selection-geometry");
  try {
    // Collapsed: no highlight rects.
    if (positionsEqual(span.anchor, span.focus)) return [];

    const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
      ? adaptShaperToMeasurer(shaperOrMeasurer)
      : shaperOrMeasurer;

    const start = spanStart(state, span);
    const end = spanEnd(state, span);

    const startPos = resolvePixelPosition(state, start, layoutTree, measurer);
    const endPos = resolvePixelPosition(state, end, layoutTree, measurer);
    if (startPos === null || endPos === null) return [];

    // Collect text boxes for line edges, line index, block boundaries.
    const boxes: AbsoluteTextBox[] = [];
    collectAllTextBoxes(layoutTree, 0, 0, boxes);
    const {
      lineStartMap,
      lineEndMap,
      lineEndStylesMap,
      lineMarginTopMap,
      lineMarginBottomMap,
    } = buildLineEdgeMaps(boxes);
    const pageLines = collectPageLines(boxes);

    const blockBoundaryLines = new Set<string>();
    collectBlockBoundaryLines(layoutTree, 0, 0, blockBoundaryLines);

    /** Measure a paragraph-break indicator using the trailing styles on a line. */
    const lineBreakIndicatorWidth = (
      pageIndex: number,
      lineY: number,
    ): number => {
      const styles = lineEndStylesMap.get(lineKey(pageIndex, lineY));
      if (styles === undefined) return 0;
      return measurer.measureWidth("  ", styles);
    };

    // Virtual-line-break detection: end-offset past end of the block's
    // inline content (e.g., selection from prev block ending at offset 0
    // of the next; the legacy module uses offset > textContentLength).
    const endBlock = getBlock(state, end.blockId);
    const endInlineLen =
      endBlock !== null && endBlock.inlineContent !== null
        ? inlineContentLength(endBlock.inlineContent)
        : 0;
    const isVirtualLineBreak = endBlock !== null && end.offset > endInlineLen;

    // Same line, same page.
    if (
      startPos.pageIndex === endPos.pageIndex &&
      startPos.lineY === endPos.lineY
    ) {
      const lb = isVirtualLineBreak
        ? lineBreakIndicatorWidth(startPos.pageIndex, startPos.lineY)
        : 0;
      const width = endPos.x - startPos.x + lb;
      if (width <= 0) return [];
      return [
        {
          x: startPos.x,
          y: startPos.lineY - startPos.lineMarginTop,
          width,
          height:
            startPos.lineMarginTop +
            startPos.lineHeight +
            startPos.lineMarginBottom,
          pageIndex: startPos.pageIndex,
        },
      ];
    }

    const rects: SelectionRect[] = [];

    // Iterate pages.
    for (let pi = startPos.pageIndex; pi <= endPos.pageIndex; pi++) {
      const lines = pageLines.get(pi) ?? [];
      if (lines.length === 0) continue;

      const isFirstPage = pi === startPos.pageIndex;
      const isLastPage = pi === endPos.pageIndex;

      let firstLineIdx: number;
      let lastLineIdx: number;

      if (isFirstPage) {
        firstLineIdx = lines.indexOf(startPos.lineY);
        if (firstLineIdx === -1) firstLineIdx = 0;
      } else {
        firstLineIdx = 0;
      }

      if (isLastPage) {
        lastLineIdx = lines.indexOf(endPos.lineY);
        if (lastLineIdx === -1) lastLineIdx = lines.length - 1;
      } else {
        lastLineIdx = lines.length - 1;
      }

      for (let li = firstLineIdx; li <= lastLineIdx; li++) {
        const lineY = lines[li];
        const key = lineKey(pi, lineY);
        const isFirstLine = isFirstPage && li === firstLineIdx;
        const isLastLine = isLastPage && li === lastLineIdx;

        const lineEnd = lineEndMap.get(key);
        const mt = lineMarginTopMap.get(key) ?? 0;
        const mb = lineMarginBottomMap.get(key) ?? 0;

        const rectY = lineY - mt;
        const rectHeight = (lh: number): number => mt + lh + mb;

        if (isFirstLine && isLastLine) {
          const lb = isVirtualLineBreak
            ? lineBreakIndicatorWidth(pi, lineY)
            : 0;
          rects.push({
            x: startPos.x,
            y: rectY,
            width: endPos.x - startPos.x + lb,
            height: rectHeight(startPos.lineHeight),
            pageIndex: pi,
          });
        } else if (isFirstLine) {
          const lineEndX = lineEnd ?? startPos.x;
          const indicator = blockBoundaryLines.has(key)
            ? lineBreakIndicatorWidth(pi, lineY)
            : 0;
          rects.push({
            x: startPos.x,
            y: rectY,
            width: Math.max(lineEndX + indicator - startPos.x, 0),
            height: rectHeight(startPos.lineHeight),
            pageIndex: pi,
          });
        } else if (isLastLine) {
          const lineStart = lineStartMap.get(key) ?? 0;
          const lb = isVirtualLineBreak
            ? lineBreakIndicatorWidth(pi, lineY)
            : 0;
          if (endPos.x > 0 || lb > 0) {
            rects.push({
              x: lineStart,
              y: rectY,
              width: endPos.x - lineStart + lb,
              height: rectHeight(endPos.lineHeight),
              pageIndex: pi,
            });
          }
        } else {
          const lineStart = lineStartMap.get(key) ?? 0;
          const indicator = blockBoundaryLines.has(key)
            ? lineBreakIndicatorWidth(pi, lineY)
            : 0;
          if (lineEnd !== undefined) {
            rects.push({
              x: lineStart,
              y: rectY,
              width: lineEnd + indicator - lineStart,
              height: rectHeight(startPos.lineHeight),
              pageIndex: pi,
            });
          } else if (indicator > 0) {
            rects.push({
              x: lineStart,
              y: rectY,
              width: indicator,
              height: rectHeight(startPos.lineHeight),
              pageIndex: pi,
            });
          }
        }
      }
    }

    return rects.filter((r) => r.width > 0);
  } finally {
    markEnd("cursor.selection-geometry", t);
  }
}

// Re-export for tests' convenience.
export type { PixelPosition };
