import type { StateNode } from "../state/state-node";
import type { Selection } from "../cursor/selection";
import type { LayoutBox } from "../layout/layout-node";
import type { TextMeasurer } from "../layout/text-measurer";
import type { RenderStyles } from "../render/render-node";
import { selectionStart, selectionEnd } from "../cursor/selection";
import { getNodeByPath } from "../state/operations";
import { getTextContentLength } from "../state/text-utils";
import { resolvePixelPosition } from "./cursor-position";
import { collectAllTextBoxes, type AbsoluteTextBox } from "./layout-utils";

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
}

/** Build maps from (pageIndex, lineY) → leftmost/rightmost edge and trailing styles. */
function buildLineEdgeMaps(boxes: AbsoluteTextBox[]): LineEdgeInfo {
  const lineStartMap = new Map<string, number>();
  const lineEndMap = new Map<string, number>();
  const lineEndStylesMap = new Map<string, RenderStyles>();
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
  }
  return { lineStartMap, lineEndMap, lineEndStylesMap };
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
 * Collapsed selections in empty text nodes produce an EOL indicator rect;
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
  const { lineStartMap, lineEndMap, lineEndStylesMap } = buildLineEdgeMaps(boxes);
  const pageLines = collectPageLines(boxes);

  /** Measure an end-of-line indicator using the trailing text styles on a line. */
  const eolIndicatorWidth = (pageIndex: number, lineY: number) =>
    measurer.measureWidth("  ", lineEndStylesMap.get(lineKey(pageIndex, lineY)) ?? {});

  // Offset-based virtual EOL check: end.offset > textContentLength means virtual EOL
  const endNode = getNodeByPath(state, end.path);
  const isVirtualEol = endNode != null && end.offset > getTextContentLength(endNode);

  // Same line, same page
  if (startPos.pageIndex === endPos.pageIndex && startPos.lineY === endPos.lineY) {
    const eol = isVirtualEol ? eolIndicatorWidth(startPos.pageIndex, startPos.lineY) : 0;
    const width = endPos.x - startPos.x + eol;
    if (width <= 0) return [];
    return [
      {
        x: startPos.x,
        y: startPos.lineY,
        width,
        height: startPos.lineHeight,
        pageIndex: startPos.pageIndex,
      },
    ];
  }

  const rects: SelectionRect[] = [];
  const lineHeight = startPos.lineHeight;

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
      const y = lines[li];
      const key = lineKey(pi, y);
      const isFirstLine = isFirstPage && li === firstLineIdx;
      const isLastLine = isLastPage && li === lastLineIdx;

      const lineEnd = lineEndMap.get(key);

      if (isFirstLine && isLastLine) {
        const eol = isVirtualEol ? eolIndicatorWidth(pi, y) : 0;
        rects.push({
          x: startPos.x,
          y,
          width: endPos.x - startPos.x + eol,
          height: lineHeight,
          pageIndex: pi,
        });
      } else if (isFirstLine) {
        // First line of selection: always includes paragraph break → EOL indicator
        const lineEndX = lineEnd ?? startPos.x;
        rects.push({
          x: startPos.x,
          y,
          width: Math.max(lineEndX + eolIndicatorWidth(pi, y) - startPos.x, 0),
          height: lineHeight,
          pageIndex: pi,
        });
      } else if (isLastLine) {
        // Last line of selection: EOL indicator only if virtual EOL offset
        const lineStart = lineStartMap.get(key) ?? 0;
        const eol = isVirtualEol ? eolIndicatorWidth(pi, y) : 0;
        if (endPos.x > 0 || eol > 0) {
          rects.push({
            x: lineStart,
            y,
            width: endPos.x - lineStart + eol,
            height: endPos.lineHeight,
            pageIndex: pi,
          });
        }
      } else {
        // Middle line: always includes paragraph break → EOL indicator
        const lineStart = lineStartMap.get(key) ?? 0;
        if (lineEnd !== undefined) {
          rects.push({
            x: lineStart,
            y,
            width: lineEnd + eolIndicatorWidth(pi, y) - lineStart,
            height: lineHeight,
            pageIndex: pi,
          });
        } else {
          // Empty line
          rects.push({
            x: lineStart,
            y,
            width: eolIndicatorWidth(pi, y),
            height: lineHeight,
            pageIndex: pi,
          });
        }
      }
    }
  }

  return rects.filter((r) => r.width > 0);
}
