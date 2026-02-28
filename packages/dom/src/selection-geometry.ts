import type {
  StateNode,
  Selection,
  LayoutBox,
  TextMeasurer,
} from "@taleweaver/core";
import { isCollapsed, selectionStart, selectionEnd } from "@taleweaver/core";
import { resolvePixelPosition } from "./cursor-position";
import { collectAllTextBoxes, type AbsoluteTextBox } from "./layout-utils";

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Build a map from line Y → rightmost edge of text content on that line. */
function buildLineEndMap(boxes: AbsoluteTextBox[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const b of boxes) {
    const rightEdge = b.absoluteX + b.box.width;
    const prev = map.get(b.absoluteY);
    if (prev === undefined || rightEdge > prev) {
      map.set(b.absoluteY, rightEdge);
    }
  }
  return map;
}

/**
 * Compute visual highlight rectangles for a text selection.
 * Returns empty array for collapsed selections.
 */
export function computeSelectionRects(
  state: StateNode,
  selection: Selection,
  layoutTree: LayoutBox,
  measurer: TextMeasurer,
  _containerWidth: number,
): SelectionRect[] {
  if (isCollapsed(selection)) return [];

  const start = selectionStart(selection);
  const end = selectionEnd(selection);

  const startPos = resolvePixelPosition(state, start, layoutTree, measurer);
  const endPos = resolvePixelPosition(state, end, layoutTree, measurer);

  // Collect text boxes to find actual line content widths
  const boxes: AbsoluteTextBox[] = [];
  collectAllTextBoxes(layoutTree, 0, 0, boxes);
  const lineEndMap = buildLineEndMap(boxes);

  // Same line
  if (startPos.y === endPos.y) {
    return [
      {
        x: startPos.x,
        y: startPos.y,
        width: endPos.x - startPos.x,
        height: startPos.height,
      },
    ];
  }

  // Different lines
  const rects: SelectionRect[] = [];
  const lineHeight = startPos.height;

  // First line: from start to end of text content on that line
  const firstLineEnd = lineEndMap.get(startPos.y) ?? startPos.x;
  rects.push({
    x: startPos.x,
    y: startPos.y,
    width: Math.max(firstLineEnd - startPos.x, 0),
    height: lineHeight,
  });

  // Middle lines: from start of line to end of text content
  let y = startPos.y + lineHeight;
  while (y < endPos.y) {
    const lineEnd = lineEndMap.get(y) ?? 0;
    if (lineEnd > 0) {
      rects.push({
        x: 0,
        y,
        width: lineEnd,
        height: lineHeight,
      });
    }
    y += lineHeight;
  }

  // Last line: from start of line to end position
  if (endPos.x > 0) {
    rects.push({
      x: 0,
      y: endPos.y,
      width: endPos.x,
      height: endPos.height,
    });
  }

  return rects;
}
