/** A position in the state tree: a path to a text node + offset within its content. */
export interface Position {
  /** Path of child indices from root to the target node. */
  readonly path: readonly number[];
  /** Character offset within the node's text content. */
  readonly offset: number;
}

/**
 * A span between two positions.
 * - `anchor`: where the span starts (or where a selection began)
 * - `focus`: where the span ends (or the current caret position)
 */
export interface Span {
  readonly anchor: Position;
  readonly focus: Position;
}

/** Create a position. */
export function createPosition(path: readonly number[], offset: number): Position {
  return Object.freeze({ path: Object.freeze([...path]), offset });
}

/** Create a span from two positions. */
export function createSpan(anchor: Position, focus: Position): Span {
  return Object.freeze({ anchor, focus });
}

/**
 * Compare two positions in document order.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 *
 * Handles positions at different tree depths: compares path components
 * from root down. If one path is a prefix of the other, the shorter path
 * (ancestor) is considered to come first in document order.
 */
export function comparePositions(a: Position, b: Position): number {
  const minLen = Math.min(a.path.length, b.path.length);
  for (let i = 0; i < minLen; i++) {
    if (a.path[i] !== b.path[i]) return a.path[i] - b.path[i];
  }
  // If paths diverge in length, the shorter path (ancestor) comes first
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  return a.offset - b.offset;
}

/** Normalize a span so anchor <= focus. */
export function normalizeSpan(span: Span): Span {
  if (comparePositions(span.anchor, span.focus) > 0) {
    return createSpan(span.focus, span.anchor);
  }
  return span;
}

