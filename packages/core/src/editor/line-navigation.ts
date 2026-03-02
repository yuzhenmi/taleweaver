import type { StateNode } from "../state/state-node";
import type { Position } from "../state/position";
import type { LayoutBox } from "../layout/layout-node";
import type { TextMeasurer } from "../layout/text-measurer";
import { createPosition } from "../state/position";
import { getNodeByPath } from "../state/operations";
import { getTextContentLength } from "../state/text-utils";
import { resolvePixelPosition } from "./cursor-position";
import { resolvePositionFromPixel } from "./hit-test";
import { collectAllTextBoxes, type AbsoluteTextBox } from "./layout-utils";
import { findFirstTextDescendant, findLastTextDescendant } from "./actions/helpers";

interface PageLine {
  y: number;
  pageIndex: number;
}

/**
 * Move cursor to the line above or below the current position.
 * Uses targetX to maintain horizontal position across vertical moves.
 * Returns the new position or null if at first/last line.
 */
export function moveToLine(
  state: StateNode,
  position: Position,
  layoutTree: LayoutBox,
  measurer: TextMeasurer,
  direction: "up" | "down",
  targetX: number | null,
): { position: Position; targetX: number } | null {
  // Resolve current pixel position
  const currentPixel = resolvePixelPosition(
    state,
    position,
    layoutTree,
    measurer,
  );

  const x = targetX ?? currentPixel.x;

  // Collect all lines with page info
  const lines = collectPageLines(layoutTree);
  if (lines.length === 0) return null;

  // Find current line
  const currentLineIdx = findCurrentLine(lines, currentPixel.lineY, currentPixel.pageIndex);

  if (direction === "up") {
    if (currentLineIdx <= 0) {
      // At first line → move to start of document
      const first = findFirstTextDescendant(state, []);
      if (!first) return null;
      return {
        position: createPosition(first.path, 0),
        targetX: x,
      };
    }
    const target = lines[currentLineIdx - 1];
    const pos = resolvePositionFromPixel(state, layoutTree, measurer, x, target.y, target.pageIndex);
    if (!pos) return null;
    return { position: pos, targetX: x };
  } else {
    if (currentLineIdx >= lines.length - 1) {
      // At last line → move to end of document
      const last = findLastTextDescendant(state, []);
      if (!last) return null;
      return {
        position: createPosition(last.path, getTextContentLength(last.node)),
        targetX: x,
      };
    }
    const target = lines[currentLineIdx + 1];
    const pos = resolvePositionFromPixel(state, layoutTree, measurer, x, target.y, target.pageIndex);
    if (!pos) return null;
    return { position: pos, targetX: x };
  }
}

/**
 * Move cursor to the start or end of the current visual line.
 * Returns the new position or null if no text boxes exist.
 */
export function moveToLineBoundary(
  state: StateNode,
  position: Position,
  layoutTree: LayoutBox,
  measurer: TextMeasurer,
  boundary: "start" | "end",
): Position | null {
  const currentPixel = resolvePixelPosition(state, position, layoutTree, measurer);
  const x = boundary === "start" ? 0 : Infinity;
  return resolvePositionFromPixel(state, layoutTree, measurer, x, currentPixel.lineY, currentPixel.pageIndex);
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
  // Sort by page index first, then by Y within page
  lines.sort((a, b) => a.pageIndex !== b.pageIndex ? a.pageIndex - b.pageIndex : a.y - b.y);
  return lines;
}

/** Find the line index matching (pageIndex, y). */
function findCurrentLine(lines: PageLine[], y: number, pageIndex: number): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].pageIndex === pageIndex && Math.abs(lines[i].y - y) < 1) return i;
  }
  // Find closest on same page first, then any
  let best = 0;
  let bestDist = Infinity;
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

