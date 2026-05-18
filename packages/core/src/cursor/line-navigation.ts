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
  collectAllTextBoxes,
  type AbsoluteTextBox,
} from "../editor/layout-utils";
import { markStart, markEnd } from "../perf/perf-trace";

interface PageLine {
  y: number;
  pageIndex: number;
}

/**
 * Move cursor to the line above or below `position`, preserving the
 * horizontal x-coordinate (caret-affinity).
 *
 * Returns `{ position, targetX }` for the new caret location. `targetX`
 * is the value to thread into the next vertical move (pass it back as
 * the `targetX` arg) so the caret remembers its column across multiple
 * up/down keystrokes.
 *
 * Edge cases (matching legacy):
 *   - At the topmost line moving up: return start-of-document
 *     (offset 0 of the first leaf block).
 *   - At the bottommost line moving down: return end-of-document
 *     (offset = inline-content length of the last leaf block).
 *   - Empty document or unresolvable position: return null.
 *
 * Composes T2's `resolvePixelPosition` and T3's `resolvePositionFromPixel`;
 * does not introduce any new spatial walks beyond `collectPageLines`.
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

    const currentPixel = resolvePixelPosition(
      state,
      position,
      layoutTree,
      measurer,
    );
    if (currentPixel === null) return null;

    const x = targetX ?? currentPixel.x;

    const lines = collectPageLines(layoutTree);
    if (lines.length === 0) return null;

    const currentLineIdx = findCurrentLine(
      lines,
      currentPixel.lineY,
      currentPixel.pageIndex,
    );

    if (direction === "up") {
      if (currentLineIdx <= 0) {
        // At the first line — return start-of-document.
        const firstLeaf = firstLeafBlock(state, state.rootId);
        if (firstLeaf === null) return null;
        return {
          position: createPosition(firstLeaf, 0),
          targetX: x,
        };
      }
      const target = lines[currentLineIdx - 1];
      const pos = resolvePositionFromPixel(
        state,
        layoutTree,
        measurer,
        x,
        target.y,
        target.pageIndex,
      );
      if (pos === null) return null;
      return { position: pos, targetX: x };
    }

    // direction === "down"
    if (currentLineIdx >= lines.length - 1) {
      // At the last line — return end-of-document.
      const lastLeaf = lastLeafBlock(state, state.rootId);
      if (lastLeaf === null) return null;
      const lastBlock = getBlock(state, lastLeaf);
      if (lastBlock === null) return null;
      const endOffset =
        lastBlock.inlineContent === null
          ? 0
          : inlineContentLength(lastBlock.inlineContent);
      return {
        position: createPosition(lastLeaf, endOffset),
        targetX: x,
      };
    }
    const target = lines[currentLineIdx + 1];
    const pos = resolvePositionFromPixel(
      state,
      layoutTree,
      measurer,
      x,
      target.y,
      target.pageIndex,
    );
    if (pos === null) return null;
    return { position: pos, targetX: x };
  } finally {
    markEnd("cursor.line-navigation.moveToLine", t);
  }
}

/**
 * Move cursor to the start or end of the current visual line (Home / End).
 *
 * Implementation: resolve current pixel position to find its line, then
 * use `resolvePositionFromPixel` with x = 0 (start) or Infinity (end).
 *
 * End-of-line wrap-edge case (matching legacy): when "end" lands on a
 * soft-wrap boundary that resolvePositionFromPixel snaps to the *next*
 * line, back up one offset so the caret stays at the visual end of the
 * source line.
 */
export function moveToLineBoundary(
  state: State,
  position: Position,
  layoutTree: LayoutBox,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  boundary: "start" | "end",
): Position | null {
  const t = markStart("cursor.line-navigation.moveToLineBoundary");
  try {
    const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
      ? adaptShaperToMeasurer(shaperOrMeasurer)
      : shaperOrMeasurer;

    const currentPixel = resolvePixelPosition(
      state,
      position,
      layoutTree,
      measurer,
    );
    if (currentPixel === null) return null;

    const x = boundary === "start" ? 0 : Number.POSITIVE_INFINITY;
    const result = resolvePositionFromPixel(
      state,
      layoutTree,
      measurer,
      x,
      currentPixel.lineY,
      currentPixel.pageIndex,
    );
    if (result === null || boundary === "start") return result;

    // End: if the resolved position's pixel coords are on a different
    // line, back up one offset (soft-wrap boundary).
    const resultPixel = resolvePixelPosition(
      state,
      result,
      layoutTree,
      measurer,
    );
    if (resultPixel === null) return result;
    if (
      resultPixel.lineY !== currentPixel.lineY ||
      resultPixel.pageIndex !== currentPixel.pageIndex
    ) {
      return createPosition(result.blockId, Math.max(0, result.offset - 1));
    }
    return result;
  } finally {
    markEnd("cursor.line-navigation.moveToLineBoundary", t);
  }
}

/** Collect unique (pageIndex, Y) pairs for all lines, sorted by page then Y. */
function collectPageLines(layoutTree: LayoutBox): PageLine[] {
  const boxes: AbsoluteTextBox[] = [];
  collectAllTextBoxes(layoutTree, 0, 0, boxes);

  const seen = new Set<string>();
  const lines: PageLine[] = [];
  for (const b of boxes) {
    const key = `${b.pageIndex}:${b.absoluteY}`;
    if (!seen.has(key)) {
      seen.add(key);
      lines.push({ y: b.absoluteY, pageIndex: b.pageIndex });
    }
  }
  lines.sort((a, b) =>
    a.pageIndex !== b.pageIndex ? a.pageIndex - b.pageIndex : a.y - b.y,
  );
  return lines;
}

/** Find the line index matching (pageIndex, y); closest-match fallback. */
function findCurrentLine(
  lines: readonly PageLine[],
  y: number,
  pageIndex: number,
): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].pageIndex === pageIndex && Math.abs(lines[i].y - y) < 1) {
      return i;
    }
  }
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < lines.length; i++) {
    const pageDist = Math.abs(lines[i].pageIndex - pageIndex) * 1e6;
    const yDist = Math.abs(lines[i].y - y);
    const dist = pageDist + yDist;
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}
