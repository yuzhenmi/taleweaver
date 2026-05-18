import type { StateNode } from "../state/state-node-legacy";
import type { Position } from "../state/position";
import type { LayoutBox } from "../layout/layout-node";
import type { TextShaper } from "../layout/text-shaper";
import type { TextMeasurer } from "../layout/text-measurer";
import { isTextShaper, adaptShaperToMeasurer } from "../layout/text-measurer";
import type { ComputedStyle } from "../styles";
import { createPosition, } from "../state/position";
import { findPathById } from "../state/find-path-legacy";
import { collectAllTextBoxes, type AbsoluteTextBox } from "./layout-utils";
import { markStart, markEnd } from "../perf/perf-trace";

/**
 * Resolve a pixel (x, y) coordinate to a document Position using the layout tree.
 * Coordinates are page-relative; pageIndex specifies which page to search.
 * Returns null if no text boxes exist.
 */
export function resolvePositionFromPixel(
  state: StateNode,
  layoutTree: LayoutBox,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  x: number,
  y: number,
  pageIndex: number = 0,
): Position | null {
  const t = markStart("editor.hit-test");
  try {
  const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
    ? adaptShaperToMeasurer(shaperOrMeasurer)
    : shaperOrMeasurer;
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

  // 3. Find target line by Y coordinate (including margin area)
  let targetLineY = lineYs[lineYs.length - 1]; // default: last line
  for (let i = 0; i < lineYs.length; i++) {
    const lineBoxes = lineMap.get(lineYs[i]);
    if (!lineBoxes) continue; // unreachable: keys come from lineMap.keys()
    const lineBottom = lineYs[i] + lineBoxes[0].box.height + lineBoxes[0].lineMarginBottom;
    if (y < lineBottom || i === lineYs.length - 1) {
      // At the floating-point boundary between two lines, prefer the later line
      if (i + 1 < lineYs.length && Math.abs(y - lineYs[i + 1]) < 0.5) {
        targetLineY = lineYs[i + 1];
      } else {
        targetLineY = lineYs[i];
      }
      break;
    }
  }

  const lineBoxes = lineMap.get(targetLineY);
  if (!lineBoxes) {
    throw new Error("hit-test: targetLineY not in lineMap (unreachable: keys come from lineMap.keys())");
  }
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
  const boxStyles = targetBox.box.computedStyle;
  let charOffset = findCharOffset(text, localX, boxStyles, measurer);

  // 6. Map box key → node ID, find path, accumulate offset from earlier boxes
  const { nodeId } = parseBoxKey(targetBox.box.key);
  const path = findPathById(state, nodeId);
  if (!path) return null;

  // Accumulate character offset from all same-nodeId boxes that spatially
  // precede the target box. We use spatial ordering (pageIndex, absoluteY,
  // absoluteX) rather than keySuffix ordering, because within-block
  // fragmentation resets the run counter to 0 on each page — so the same
  // keySuffix can appear on multiple pages for the same source node.
  let baseOffset = 0;
  for (const b of allBoxes) {
    if (b === targetBox) break; // spatial walk: first occurrence of targetBox ends the prefix
    const parsed = parseBoxKey(b.box.key);
    if (parsed.nodeId === nodeId) {
      baseOffset += b.box.text.length;
    }
  }

  return createPosition(path, baseOffset + charOffset);
  } finally {
    markEnd("editor.hit-test", t);
  }
}

/** Find the character offset closest to a given X position within text. */
function findCharOffset(
  text: string,
  localX: number,
  styles: Readonly<ComputedStyle>,
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
