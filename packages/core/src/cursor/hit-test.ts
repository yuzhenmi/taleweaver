import type { State } from "../state/state";
import { getBlock } from "../state/state";
import type { Position } from "../state/block-position";
import { createPosition } from "../state/block-position";
import type { LayoutBox } from "../layout/layout-node";
import type { TextShaper } from "../layout/text-shaper";
import type { TextMeasurer } from "../layout/text-measurer";
import { isTextShaper, adaptShaperToMeasurer } from "../layout/text-measurer";
import type { ComputedStyle } from "../styles";
import {
  collectAllTextBoxes,
  type AbsoluteTextBox,
} from "../editor/layout-utils";
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
 *   6. Read the precomputed `targetBox.blockId` and
 *      `targetBox.prefixOffsetInBlock` (populated during
 *      `collectAllTextBoxes`). The hit position is
 *      `Position { blockId, offset }` where
 *      `offset = prefixOffsetInBlock + charOffset`.
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

    // 1. Collect all text boxes with absolute coordinates. We keep
    //    synthetic strut-line entries: clicks on an empty paragraph need to
    //    land at offset 0 of THAT paragraph (not fall through to the
    //    nearest real line). The synthetic entry carries the owning
    //    block's id (`blockId` field) so we can build a Position without
    //    parsing an inline-item key — parseInlineBoxKey returns null on
    //    `${lineKey}:strut` keys. See #170.
    const allBoxes: AbsoluteTextBox[] = [];
    collectAllTextBoxes(layoutTree, 0, 0, allBoxes);

    // 2. Filter to target page (when paginated). Real text-runs drive the
    //    pagination check — synthetic entries inherit their page index from
    //    the recursion but a doc with only synthetics is still page 0.
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

    // 5. Empty-line (strut) fallback: if the target line has only synthetic
    //    entries, the click landed on an empty paragraph's strut line. Use
    //    the synthetic's owning blockId to return offset 0 of that block.
    //    We check by looking for ANY non-synthetic entry on this line —
    //    a real-and-synthetic mix never occurs (the synthetic is only
    //    emitted when no real text-run produced an entry; see
    //    `collectAllTextBoxes`).
    const realOnLine = lineBoxes.filter((b) => b.synthetic !== true);
    if (realOnLine.length === 0) {
      // All entries on this line are synthetic. Take the first one's blockId.
      const synthetic = lineBoxes[0];
      if (synthetic.blockId === undefined) return null;
      if (getBlock(state, synthetic.blockId) === null) return null;
      return createPosition(synthetic.blockId, 0);
    }

    // 6. Pick target box by X among the real (non-synthetic) entries.
    let targetBox = realOnLine[realOnLine.length - 1];
    for (let i = 0; i < realOnLine.length; i++) {
      const b = realOnLine[i];
      if (x < b.absoluteX) {
        // In gap before this box — prefer previous, else this.
        targetBox = i > 0 ? realOnLine[i - 1] : b;
        break;
      }
      if (x < b.absoluteX + b.box.width) {
        targetBox = b;
        break;
      }
    }

    // 7. Char offset within target box.
    const localX = x - targetBox.absoluteX;
    const charOffset = findCharOffset(
      targetBox.box.text,
      localX,
      targetBox.box.computedStyle,
      measurer,
    );

    // 8. Resolve target box's blockId + base offset via precomputed
    //    per-block prefix accumulator on AbsoluteTextBox (populated
    //    during `collectAllTextBoxes`). O(1) here vs the previous
    //    O(N) walk that re-parsed every box key per click.
    const targetBlockId = targetBox.blockId;
    if (targetBlockId === undefined) return null;
    // Defensive: ensure the block exists in state.
    if (getBlock(state, targetBlockId) === null) return null;

    return createPosition(
      targetBlockId,
      targetBox.prefixOffsetInBlock + charOffset,
    );
  } finally {
    markEnd("cursor.hit-test", t);
  }
}

/**
 * Find the character offset closest to a given X position within `text`.
 * Compares midpoints between adjacent character widths (so a click closer
 * to char i than to char i+1 returns i).
 *
 * Binary search on prefix widths, with memoization of each prefix
 * measurement so no prefix is measured twice. Worst case O(log n)
 * `measureWidth` calls. The previous implementation did a linear scan
 * with two `measureWidth` calls per iteration (one for prefix i, one
 * for prefix i-1) — O(n) calls, each internally O(prefix), giving
 * O(n²) total.
 */
function findCharOffset(
  text: string,
  localX: number,
  styles: Readonly<ComputedStyle>,
  measurer: TextMeasurer,
): number {
  if (localX <= 0) return 0;
  if (text.length === 0) return 0;

  const widthCache = new Map<number, number>();
  widthCache.set(0, 0);
  const widthOfPrefix = (n: number): number => {
    let v = widthCache.get(n);
    if (v === undefined) {
      v = measurer.measureWidth(text.slice(0, n), styles);
      widthCache.set(n, v);
    }
    return v;
  };

  // Past the midpoint of the last character: snap to end. Safe because
  // the `text.length === 0` guard above ensures text.length >= 1 here.
  const fullW = widthOfPrefix(text.length);
  const lastMidpoint = (widthOfPrefix(text.length - 1) + fullW) / 2;
  if (localX >= lastMidpoint) return text.length;

  // Binary-search the smallest i in [1, text.length] such that the
  // midpoint between prefix(i-1) and prefix(i) is strictly greater than
  // localX. Returning i-1 matches the original "click closer to char i
  // than char i+1 returns i" semantics.
  let lo = 1;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const midpoint = (widthOfPrefix(mid - 1) + widthOfPrefix(mid)) / 2;
    if (midpoint > localX) hi = mid;
    else lo = mid + 1;
  }
  return lo - 1;
}
