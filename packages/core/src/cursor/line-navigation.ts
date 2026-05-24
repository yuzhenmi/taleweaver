import type { State } from "../state/state";
import { getBlock } from "../state/state";
import type { Position } from "../state/block-position";
import { createPosition } from "../state/block-position";
import type { LayoutBox } from "../layout/layout-node";
import type { TextShaper } from "../layout/text-shaper";
import type { TextMeasurer } from "../layout/text-measurer";
import { isTextShaper, adaptShaperToMeasurer } from "../layout/text-measurer";
import { firstLeafBlock, lastLeafBlock } from "../state/block-traversal";
import { inlineContentLength } from "../state/inline-content";
import { resolvePixelPosition } from "./cursor-position";
import { resolvePositionFromPixel } from "./hit-test";
import {
  getLineIndex,
  findLineForPosition,
} from "./line-flatten";
import { markStart, markEnd } from "../perf/perf-trace";

/**
 * Move cursor to the line above or below `position`, preserving the
 * horizontal x-coordinate (caret-affinity).
 *
 * Returns `{ position, targetX }` for the new caret location.
 * `targetX` is the value to thread into the next vertical move (pass
 * it back as the `targetX` arg) so the caret remembers its column
 * across multiple up/down keystrokes.
 *
 * Edge cases:
 *   - At the topmost line moving up: return start-of-document
 *     (offset 0 of the first leaf block).
 *   - At the bottommost line moving down: return end-of-document
 *     (offset = inline-content length of the last leaf block).
 *   - Empty document or unresolvable position: return null.
 *
 * Algorithm (LineBox-canonical):
 *   1. Resolve current position to a PixelPosition for the initial X.
 *   2. Collect all `AbsoluteLineBox`es and find the current one via
 *      `findLineForPosition`.
 *   3. Pick the previous / next entry in the flat list.
 *   4. Resolve the target X on the adjacent line's Y via
 *      `resolvePositionFromPixel`.
 *
 * Note on inline-block interleaving: `collectLineBoxes` interleaves
 * inline-block-internal lines into the flat array. Moving up/down
 * from an outer-paragraph line currently treats those as adjacent
 * (the up/down arrow can navigate into an inline-block's contents).
 * For a typical document without inline-blocks this is identical to
 * the prior behavior.
 */
export function moveToLine(
  state: State,
  position: Position,
  layoutTree: LayoutBox,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  direction: "up" | "down",
  targetX: number | null,
): { position: Position; targetX: number } | null {
  const t = markStart("cursor.line-navigation.moveToLine");
  try {
    const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
      ? adaptShaperToMeasurer(shaperOrMeasurer)
      : shaperOrMeasurer;

    const currentPixel = resolvePixelPosition(state, position, layoutTree, measurer);
    if (currentPixel === null) return null;

    const x = targetX ?? currentPixel.x;

    // L-PERF-D: reuse the doc-wide line index (WeakMap-cached on the
    // layoutTree root). Same instance as the one cursor-position +
    // selection-geometry consult this cycle, so a single
    // collectLineBoxes walk serves every consumer.
    const lines = getLineIndex(layoutTree).all;
    if (lines.length === 0) return null;

    const currentLineIdx = findLineForPosition(lines, position);
    if (currentLineIdx < 0) return null;

    if (direction === "up") {
      if (currentLineIdx === 0) {
        // At first line — return start-of-document.
        const firstLeaf = firstLeafBlock(state, state.rootId);
        if (firstLeaf === null) return null;
        return { position: createPosition(firstLeaf, 0), targetX: x };
      }
      const target = lines[currentLineIdx - 1];
      const pos = resolvePositionFromPixel(
        state, layoutTree, measurer, x, target.absoluteY, target.pageIndex,
      );
      if (pos === null) return null;
      return { position: pos, targetX: x };
    }

    // direction === "down"
    if (currentLineIdx === lines.length - 1) {
      // At last line — return end-of-document.
      const lastLeaf = lastLeafBlock(state, state.rootId);
      if (lastLeaf === null) return null;
      const lastBlock = getBlock(state, lastLeaf);
      if (lastBlock === null) return null;
      const endOffset =
        lastBlock.inlineContent === null
          ? 0
          : inlineContentLength(lastBlock.inlineContent);
      return { position: createPosition(lastLeaf, endOffset), targetX: x };
    }
    const target = lines[currentLineIdx + 1];
    const pos = resolvePositionFromPixel(
      state, layoutTree, measurer, x, target.absoluteY, target.pageIndex,
    );
    if (pos === null) return null;
    return { position: pos, targetX: x };
  } finally {
    markEnd("cursor.line-navigation.moveToLine", t);
  }
}

/**
 * Move cursor to the start or end of the current visual line
 * (Home / End).
 *
 * Algorithm (LineBox-canonical):
 *   1. Collect AbsoluteLineBoxes; find the line containing `position`
 *      via `findLineForPosition`.
 *   2. Return `(ownerBlockId, inlineOffsetStart)` for "start" or
 *      `(ownerBlockId, inlineOffsetEnd)` for "end".
 *
 * The prior implementation went `Position → PixelPosition →
 * resolvePositionFromPixel(x=∞)` and then needed a "step-back one
 * grapheme cluster" defense when the hit-test snapped to the next
 * line at a soft-wrap edge. By going directly through the LineBox's
 * offset range, we stay inside one LineBox by construction; the
 * step-back machinery dissolves. The E-A15 cross-block defense gap
 * is resolved structurally.
 */
export function moveToLineBoundary(
  _state: State,
  position: Position,
  layoutTree: LayoutBox,
  _shaperOrMeasurer: TextShaper | TextMeasurer,
  boundary: "start" | "end",
): Position | null {
  const t = markStart("cursor.line-navigation.moveToLineBoundary");
  try {
    const lines = getLineIndex(layoutTree).all;
    if (lines.length === 0) return null;

    const currentLineIdx = findLineForPosition(lines, position);
    if (currentLineIdx < 0) return null;

    const line = lines[currentLineIdx].line;
    const offset = boundary === "start" ? line.inlineOffsetStart : line.inlineOffsetEnd;
    return createPosition(line.ownerBlockId, offset);
  } finally {
    markEnd("cursor.line-navigation.moveToLineBoundary", t);
  }
}
