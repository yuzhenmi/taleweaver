import type { BlockId } from "./block-id";

/**
 * A position in the document: a block identifier plus a UTF-16 code-unit
 * offset within that block's inline content. Stable across edits to other
 * parts of the document (the blockId names a specific block; offsets only
 * change when the named block itself is edited).
 */
export interface Position {
  readonly blockId: BlockId;
  readonly offset: number;
}

export function createPosition(blockId: BlockId, offset: number): Position {
  return Object.freeze({ blockId, offset });
}

/**
 * A span / selection range. anchor is where the selection started;
 * focus is the current end. anchor and focus must be in the same
 * selection context (validated at the action-handler level, not here).
 */
export interface Span {
  readonly anchor: Position;
  readonly focus: Position;
}

export function createSpan(anchor: Position, focus: Position): Span {
  return Object.freeze({ anchor, focus });
}

/** True iff a and b have the same blockId and offset. */
export function positionsEqual(a: Position, b: Position): boolean {
  return a.blockId === b.blockId && a.offset === b.offset;
}
