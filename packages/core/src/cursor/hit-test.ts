import type { State } from "../state/state";
import { getBlock } from "../state/state";
import type { Position } from "../state/block-position";
import { createPosition } from "../state/block-position";
import type { BlockId } from "../state/block-id";
import type { LayoutBox } from "../layout/layout-node";
import type { TextShaper } from "../layout/text-shaper";
import type { TextMeasurer } from "../layout/text-measurer";
import { isTextShaper, adaptShaperToMeasurer } from "../layout/text-measurer";
import type { ComputedStyle } from "../styles";
import {
  collectAllTextBoxes,
  type AbsoluteTextBox,
} from "../editor/layout-utils";
import { parseInlineBoxKey } from "./box-key-utils";
import { markStart, markEnd } from "../perf/perf-trace";

/**
 * Resolve a pixel (x, y) coordinate to a document Position using the layout
 * tree.
 *
 * Algorithm (mirrors `editor/hit-test-legacy.ts`, adapted for the new
 * box-key shape `${blockId}/inline/${itemIndex}[:${runIndex}]`):
 *   1. Collect every text-run box (with absolute coords) via
 *      `collectAllTextBoxes`.
 *   2. Filter to the requested `pageIndex` when the doc is paginated.
 *   3. Group boxes by line Y; pick the line whose Y range contains `y`,
 *      falling back to the last line for clicks below all content.
 *   4. Within the chosen line, pick the box whose X range contains `x`
 *      (or the last box for clicks past the line end).
 *   5. Binary-scan / linear-scan the character offset within that box's
 *      text via `measurer.measureWidth`.
 *   6. Map the box key → `{ blockId, itemIndex }` via `parseInlineBoxKey`.
 *      Accumulate a within-block offset by walking every text-run of the
 *      same blockId that spatially precedes the target box, summing
 *      `text.length`. The hit position is `Position { blockId, offset }`
 *      where `offset = accumulated + charOffset`.
 *
 * Returns `null` when:
 *   - The layout has no text-runs (e.g., empty document).
 *   - The target box's blockId is unknown to `state` (defensive).
 *
 * Block-level offsets here are inline-content offsets (UTF-16 code units
 * accumulated across text-runs of the same blockId). Embed items produce
 * no text-runs and contribute nothing to the accumulator — clicks at an
 * embed slot land on the closest text-run.
 */
export function resolvePositionFromPixel(
  state: State,
  layoutTree: LayoutBox,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  x: number,
  y: number,
  pageIndex: number = 0,
): Position | null {
  const t = markStart("cursor.hit-test");
  try {
    const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
      ? adaptShaperToMeasurer(shaperOrMeasurer)
      : shaperOrMeasurer;

    // 1. Collect all text boxes with absolute coordinates.
    const allBoxes: AbsoluteTextBox[] = [];
    collectAllTextBoxes(layoutTree, 0, 0, allBoxes);

    // 2. Filter to target page (when paginated).
    const hasPagination = allBoxes.some((b) => b.pageIndex > 0);
    const boxes = hasPagination
      ? allBoxes.filter((b) => b.pageIndex === pageIndex)
      : allBoxes;

    if (boxes.length === 0) return null;

    // 3. Group by line (same absolute Y).
    const lineMap = new Map<number, AbsoluteTextBox[]>();
    for (const b of boxes) {
      const lineY = b.absoluteY;
      const arr = lineMap.get(lineY);
      if (arr === undefined) {
        lineMap.set(lineY, [b]);
      } else {
        arr.push(b);
      }
    }
    const lineYs = [...lineMap.keys()].sort((a, b) => a - b);

    // 4. Find target line by Y. Default to last line for clicks below all.
    let targetLineY = lineYs[lineYs.length - 1];
    for (let i = 0; i < lineYs.length; i++) {
      const lineBoxes = lineMap.get(lineYs[i]);
      if (lineBoxes === undefined) continue;
      const first = lineBoxes[0];
      const lineBottom =
        lineYs[i] + first.box.height + first.lineMarginBottom;
      if (y < lineBottom || i === lineYs.length - 1) {
        // Snap to next line at floating-point boundary.
        if (i + 1 < lineYs.length && Math.abs(y - lineYs[i + 1]) < 0.5) {
          targetLineY = lineYs[i + 1];
        } else {
          targetLineY = lineYs[i];
        }
        break;
      }
    }

    const lineBoxes = lineMap.get(targetLineY);
    if (lineBoxes === undefined) {
      // Unreachable: keys come from lineMap.keys().
      return null;
    }
    // Sort by X within the line.
    lineBoxes.sort((a, b) => a.absoluteX - b.absoluteX);

    // 5. Pick target box by X.
    let targetBox = lineBoxes[lineBoxes.length - 1];
    for (let i = 0; i < lineBoxes.length; i++) {
      const b = lineBoxes[i];
      if (x < b.absoluteX) {
        // In gap before this box — prefer previous, else this.
        targetBox = i > 0 ? lineBoxes[i - 1] : b;
        break;
      }
      if (x < b.absoluteX + b.box.width) {
        targetBox = b;
        break;
      }
    }

    // 6. Char offset within target box.
    const localX = x - targetBox.absoluteX;
    const charOffset = findCharOffset(
      targetBox.box.text,
      localX,
      targetBox.box.computedStyle,
      measurer,
    );

    // 7. Resolve target box's blockId; accumulate block-level offset across
    //    every text-run with the same blockId that spatially precedes the
    //    target box. We walk `allBoxes` (NOT the page-filtered list) so
    //    that within-block fragmentation across page breaks doesn't reset
    //    the offset prematurely.
    const parsedTarget = parseInlineBoxKey(targetBox.box.key);
    if (parsedTarget === null) return null;
    const targetBlockId = parsedTarget.blockId;

    // Defensive: ensure the block exists in state.
    if (getBlock(state, targetBlockId) === null) return null;

    let baseOffset = 0;
    for (const b of allBoxes) {
      if (b === targetBox) break;
      const parsed = parseInlineBoxKey(b.box.key);
      if (parsed === null) continue;
      if (parsed.blockId === targetBlockId) {
        baseOffset += b.box.text.length;
      }
    }

    return createPosition(targetBlockId as BlockId, baseOffset + charOffset);
  } finally {
    markEnd("cursor.hit-test", t);
  }
}

/**
 * Find the character offset closest to a given X position within `text`.
 * Compares midpoints between adjacent character widths (so a click closer
 * to char i than to char i+1 returns i).
 */
function findCharOffset(
  text: string,
  localX: number,
  styles: Readonly<ComputedStyle>,
  measurer: TextMeasurer,
): number {
  if (localX <= 0) return 0;
  for (let i = 1; i <= text.length; i++) {
    const w = measurer.measureWidth(text.slice(0, i), styles);
    const prevW =
      i > 1 ? measurer.measureWidth(text.slice(0, i - 1), styles) : 0;
    const midpoint = (prevW + w) / 2;
    if (localX < midpoint) return i - 1;
  }
  return text.length;
}
