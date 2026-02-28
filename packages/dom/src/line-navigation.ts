import type {
  StateNode,
  Position,
  LayoutBox,
  TextMeasurer,
} from "@taleweaver/core";
import {
  createPosition,
  getNodeByPath,
  getTextContentLength,
} from "@taleweaver/core";
import { resolvePixelPosition } from "./cursor-position";
import { resolvePositionFromPixel } from "./hit-test";
import { collectAllTextBoxes, type AbsoluteTextBox } from "./layout-utils";

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

  // Collect all lines
  const lineYs = collectLineYs(layoutTree);
  if (lineYs.length === 0) return null;

  // Find current line
  const currentLineIdx = findCurrentLine(lineYs, currentPixel.y);

  if (direction === "up") {
    if (currentLineIdx <= 0) {
      // At first line → move to start of document
      const firstTextPath = findFirstTextPath(state);
      if (!firstTextPath) return null;
      return {
        position: createPosition(firstTextPath, 0),
        targetX: x,
      };
    }
    const targetLineY = lineYs[currentLineIdx - 1];
    const pos = resolvePositionFromPixel(state, layoutTree, measurer, x, targetLineY);
    if (!pos) return null;
    return { position: pos, targetX: x };
  } else {
    if (currentLineIdx >= lineYs.length - 1) {
      // At last line → move to end of document
      const lastTextPath = findLastTextPath(state);
      if (!lastTextPath) return null;
      const lastNode = getNodeByPath(state, lastTextPath)!;
      return {
        position: createPosition(lastTextPath, getTextContentLength(lastNode)),
        targetX: x,
      };
    }
    const targetLineY = lineYs[currentLineIdx + 1];
    const pos = resolvePositionFromPixel(state, layoutTree, measurer, x, targetLineY);
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
  return resolvePositionFromPixel(state, layoutTree, measurer, x, currentPixel.y);
}

/** Collect unique Y positions of all text boxes (each represents a line). */
function collectLineYs(layoutTree: LayoutBox): number[] {
  const boxes: AbsoluteTextBox[] = [];
  collectAllTextBoxes(layoutTree, 0, 0, boxes);

  const ys = new Set<number>();
  for (const b of boxes) {
    ys.add(b.absoluteY);
  }
  return [...ys].sort((a, b) => a - b);
}

/** Find the line index closest to the given Y. */
function findCurrentLine(lineYs: number[], y: number): number {
  for (let i = 0; i < lineYs.length; i++) {
    if (Math.abs(lineYs[i] - y) < 1) return i;
  }
  // Find closest
  let best = 0;
  let bestDist = Math.abs(lineYs[0] - y);
  for (let i = 1; i < lineYs.length; i++) {
    const dist = Math.abs(lineYs[i] - y);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

/** Find path to first text node in document. */
function findFirstTextPath(state: StateNode): number[] | null {
  if (state.type === "text") return [];
  for (let i = 0; i < state.children.length; i++) {
    const result = findFirstTextPath(state.children[i]);
    if (result !== null) return [i, ...result];
  }
  return null;
}

/** Find path to last text node in document. */
function findLastTextPath(state: StateNode): number[] | null {
  if (state.type === "text") return [];
  for (let i = state.children.length - 1; i >= 0; i--) {
    const result = findLastTextPath(state.children[i]);
    if (result !== null) return [i, ...result];
  }
  return null;
}
