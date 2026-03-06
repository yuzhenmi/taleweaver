import type { StateNode } from "../state/state-node";
import type { Selection } from "../cursor/selection";
import type { LayoutBox } from "../layout/layout-node";
import type { TextMeasurer } from "../layout/text-measurer";
import type { RenderStyles } from "../render/render-node";
import { selectionStart, selectionEnd } from "../cursor/selection";
import { getNodeByPath } from "../state/operations";
import { getTextContentLength } from "../state/text-utils";
import { resolvePixelPosition } from "./cursor-position";
import { collectAllTextBoxes, collectBlockBoundaryLines, type AbsoluteTextBox } from "./layout-utils";

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
  pageIndex: number;
}

/** Composite key for (pageIndex, lineY) → string. */
function lineKey(pageIndex: number, y: number): string {
  return `${pageIndex}:${y}`;
}

interface LineEdgeInfo {
  lineStartMap: Map<string, number>;
  lineEndMap: Map<string, number>;
  lineEndStylesMap: Map<string, RenderStyles>;
  lineMarginTopMap: Map<string, number>;
  lineMarginBottomMap: Map<string, number>;
}

/** Build maps from (pageIndex, lineY) → leftmost/rightmost edge, trailing styles, and margins. */
function buildLineEdgeMaps(boxes: AbsoluteTextBox[]): LineEdgeInfo {
  const lineStartMap = new Map<string, number>();
  const lineEndMap = new Map<string, number>();
  const lineEndStylesMap = new Map<string, RenderStyles>();
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
      lineEndStylesMap.set(key, b.box.styles ?? {});
    }
    if (!lineMarginTopMap.has(key)) {
      lineMarginTopMap.set(key, b.lineMarginTop);
      lineMarginBottomMap.set(key, b.lineMarginBottom);
    }
  }
  return { lineStartMap, lineEndMap, lineEndStylesMap, lineMarginTopMap, lineMarginBottomMap };
}

/** Collect sorted unique line Y values per page. */
function collectPageLines(
  boxes: AbsoluteTextBox[],
): Map<number, number[]> {
  const pageLines = new Map<number, Set<number>>();
  for (const b of boxes) {
    let set = pageLines.get(b.pageIndex);
    if (!set) {
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
 * Compute visual highlight rectangles for a text selection.
 * Zero-width rects (e.g. from collapsed selections mid-line) are filtered out.
 * Collapsed selections in empty text nodes produce a line break indicator rect;
 * callers should gate on isCollapsed() when a cursor shouldn't show highlights.
 */
export function computeSelectionRects(
  state: StateNode,
  selection: Selection,
  layoutTree: LayoutBox,
  measurer: TextMeasurer,
  _containerWidth: number,
): SelectionRect[] {

  const start = selectionStart(selection);
  const end = selectionEnd(selection);

  const startPos = resolvePixelPosition(state, start, layoutTree, measurer);
  const endPos = resolvePixelPosition(state, end, layoutTree, measurer);

  // Collect text boxes to find actual line content edges
  const boxes: AbsoluteTextBox[] = [];
  collectAllTextBoxes(layoutTree, 0, 0, boxes);
  const { lineStartMap, lineEndMap, lineEndStylesMap, lineMarginTopMap, lineMarginBottomMap } = buildLineEdgeMaps(boxes);
  const pageLines = collectPageLines(boxes);

  // Collect which lines are at paragraph boundaries (last line of a block)
  const blockBoundaryLines = new Set<string>();
  collectBlockBoundaryLines(layoutTree, 0, 0, blockBoundaryLines);

  /** Measure a line break indicator using the trailing text styles on a line. */
  const lineBreakIndicatorWidth = (pageIndex: number, lineY: number) =>
    measurer.measureWidth("  ", lineEndStylesMap.get(lineKey(pageIndex, lineY)) ?? {});

  // Offset-based virtual line break check: end.offset > textContentLength means virtual line break
  const endNode = getNodeByPath(state, end.path);
  const isVirtualLineBreak = endNode != null && end.offset > getTextContentLength(endNode);

  // Same line, same page
  if (startPos.pageIndex === endPos.pageIndex && startPos.lineY === endPos.lineY) {
    const lb = isVirtualLineBreak ? lineBreakIndicatorWidth(startPos.pageIndex, startPos.lineY) : 0;
    const width = endPos.x - startPos.x + lb;
    if (width <= 0) return [];
    return [
      {
        x: startPos.x,
        y: startPos.lineY - startPos.lineMarginTop,
        width,
        height: startPos.lineMarginTop + startPos.lineHeight + startPos.lineMarginBottom,
        pageIndex: startPos.pageIndex,
      },
    ];
  }

  const rects: SelectionRect[] = [];

  // Iterate pages from startPos.pageIndex to endPos.pageIndex
  for (let pi = startPos.pageIndex; pi <= endPos.pageIndex; pi++) {
    const lines = pageLines.get(pi) ?? [];
    if (lines.length === 0) continue;

    const isFirstPage = pi === startPos.pageIndex;
    const isLastPage = pi === endPos.pageIndex;

    // Determine which lines on this page are in the selection
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

      /** Rect y and height spanning the margin area. */
      const rectY = lineY - mt;
      const rectHeight = (lh: number) => mt + lh + mb;

      if (isFirstLine && isLastLine) {
        const lb = isVirtualLineBreak ? lineBreakIndicatorWidth(pi, lineY) : 0;
        rects.push({
          x: startPos.x,
          y: rectY,
          width: endPos.x - startPos.x + lb,
          height: rectHeight(startPos.lineHeight),
          pageIndex: pi,
        });
      } else if (isFirstLine) {
        const lineEndX = lineEnd ?? startPos.x;
        const indicator = blockBoundaryLines.has(key) ? lineBreakIndicatorWidth(pi, lineY) : 0;
        rects.push({
          x: startPos.x,
          y: rectY,
          width: Math.max(lineEndX + indicator - startPos.x, 0),
          height: rectHeight(startPos.lineHeight),
          pageIndex: pi,
        });
      } else if (isLastLine) {
        const lineStart = lineStartMap.get(key) ?? 0;
        const lb = isVirtualLineBreak ? lineBreakIndicatorWidth(pi, lineY) : 0;
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
        const indicator = blockBoundaryLines.has(key) ? lineBreakIndicatorWidth(pi, lineY) : 0;
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
}
