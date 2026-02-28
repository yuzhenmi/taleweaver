import type { Position, Span } from "../state/position";
import { createPosition, createSpan, comparePositions } from "../state/position";

/** A selection is a Span — anchor (start) and focus (caret). */
export type Selection = Span;

/** Create a selection. */
export function createSelection(
  anchor: Position,
  focus: Position,
): Selection {
  return createSpan(anchor, focus);
}

/** Create a collapsed selection (cursor at a single point). */
export function createCursor(path: readonly number[], offset: number): Selection {
  const pos = createPosition(path, offset);
  return createSelection(pos, pos);
}

/** Check if a selection is collapsed (no range selected). */
export function isCollapsed(selection: Selection): boolean {
  return comparePositions(selection.anchor, selection.focus) === 0;
}

/** Get the start (earlier) position of a selection. */
export function selectionStart(selection: Selection): Position {
  return comparePositions(selection.anchor, selection.focus) <= 0
    ? selection.anchor
    : selection.focus;
}

/** Get the end (later) position of a selection. */
export function selectionEnd(selection: Selection): Position {
  return comparePositions(selection.anchor, selection.focus) <= 0
    ? selection.focus
    : selection.anchor;
}
