import type { StateNode } from "../state/state-node";
import type { Position } from "../state/position";
import type { LayoutBox } from "../layout/layout-node";
import type { TextMeasurer } from "../layout/text-measurer";
import type { RenderStyles } from "../render/render-node";
import { createPosition, } from "../state/position";
import { findPathById } from "../state/find-path";
import { collectAllTextBoxes, type AbsoluteTextBox } from "./layout-utils";

/**
 * Resolve a pixel (x, y) coordinate to a document Position using the layout tree.
 * Coordinates are page-relative; pageIndex specifies which page to search.
 * Returns null if no text boxes exist.
 */
export function resolvePositionFromPixel(
  state: StateNode,
  layoutTree: LayoutBox,
  measurer: TextMeasurer,
  x: number,
  y: number,
  pageIndex: number = 0,
): Position | null {
  // 1. Collect all text boxes with absolute coordinates
  const allBoxes: AbsoluteTextBox[] = [];
  collectAllTextBoxes(layoutTree, 0, 0, allBoxes);

  // Filter to target page (when paginated)
  const hasPagination = allBoxes.some((b) => b.pageIndex > 0);
  const boxes = hasPagination
    ? allBoxes.filter((b) => b.pageIndex === pageIndex)
    : allBoxes;

  if (boxes.length === 0) return null;

  // 2. Group by line (same absolute Y)
  const lineMap = new Map<number, typeof boxes>();
  for (const b of boxes) {
    const lineY = b.absoluteY;
    let arr = lineMap.get(lineY);
    if (!arr) {
      arr = [];
      lineMap.set(lineY, arr);
    }
    arr.push(b);
  }

  // Sort line Y values
  const lineYs = [...lineMap.keys()].sort((a, b) => a - b);

  // 3. Find target line by Y coordinate
  let targetLineY = lineYs[lineYs.length - 1]; // default: last line
  for (let i = 0; i < lineYs.length; i++) {
    const lineBoxes = lineMap.get(lineYs[i])!;
    const lineBottom = lineYs[i] + lineBoxes[0].box.height;
    if (y < lineBottom || i === lineYs.length - 1) {
      targetLineY = lineYs[i];
      break;
    }
  }

  const lineBoxes = lineMap.get(targetLineY)!;
  // Sort by X within the line
  lineBoxes.sort((a, b) => a.absoluteX - b.absoluteX);

  // 4. Find target text box by X coordinate
  let targetBox = lineBoxes[lineBoxes.length - 1]; // default: last box
  for (let i = 0; i < lineBoxes.length; i++) {
    const b = lineBoxes[i];
    if (x < b.absoluteX) {
      // Click is in a gap before this box (e.g. empty space in a table cell) —
      // pick the previous box if one exists
      targetBox = i > 0 ? lineBoxes[i - 1] : b;
      break;
    }
    if (x < b.absoluteX + b.box.width) {
      targetBox = b;
      break;
    }
  }

  // 5. Binary search within text box for character offset
  const localX = x - targetBox.absoluteX;
  const text = targetBox.box.text;
  const boxStyles = targetBox.box.styles ?? {};
  let charOffset = findCharOffset(text, localX, boxStyles, measurer);

  // 6. Map box key → node ID, find path, accumulate offset from earlier boxes
  const { nodeId, suffix } = parseBoxKey(targetBox.box.key);
  const path = findPathById(state, nodeId);
  if (!path) return null;

  // Accumulate offset from earlier boxes with same node ID (across all pages)
  let baseOffset = 0;
  for (const b of allBoxes) {
    const parsed = parseBoxKey(b.box.key);
    if (parsed.nodeId === nodeId && parsed.suffix < suffix) {
      baseOffset += b.box.text.length;
    }
  }

  return createPosition(path, baseOffset + charOffset);
}

/** Find the character offset closest to a given X position within text. */
function findCharOffset(
  text: string,
  localX: number,
  styles: RenderStyles,
  measurer: TextMeasurer,
): number {
  if (localX <= 0) return 0;

  // Linear scan — typically short text within a single word box
  for (let i = 1; i <= text.length; i++) {
    const w = measurer.measureWidth(text.slice(0, i), styles);
    const prevW = i > 1 ? measurer.measureWidth(text.slice(0, i - 1), styles) : 0;
    const midpoint = (prevW + w) / 2;
    if (localX < midpoint) return i - 1;
  }
  return text.length;
}

/** Parse a layout box key into node ID and suffix number.
 *  Returns suffix -1 for unsuffixed keys (single word box),
 *  or N for keys with :N suffix (split across multiple word boxes). */
function parseBoxKey(key: string): { nodeId: string; suffix: number } {
  const colonIdx = key.lastIndexOf(":");
  if (colonIdx === -1) return { nodeId: key, suffix: -1 };

  const suffixStr = key.slice(colonIdx + 1);
  const suffix = parseInt(suffixStr, 10);
  if (isNaN(suffix)) return { nodeId: key, suffix: -1 };

  return { nodeId: key.slice(0, colonIdx), suffix };
}
