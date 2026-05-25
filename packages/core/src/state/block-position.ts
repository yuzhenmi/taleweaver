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

/**
 * `Selection` is the editor/cursor-facing name for a `Span` (anchor + focus,
 * each a `Position`). It is a pure alias — no added type-level distinction —
 * KEPT DELIBERATELY (not legacy-compat): "selection" is the domain term at the
 * editing boundary, where a directed anchor→focus pair models the user's
 * selection, while "span" reads as the generic geometric/range pair used by
 * lower layers. The split mirrors how top editors model selection as a
 * first-class concept (ProseMirror `Selection`, Lexical `RangeSelection`).
 *
 * Convention: editor + cursor + history code spell it `Selection`; state-layer
 * range math spells it `Span`. Do NOT churn-replace one with the other — the
 * name carries reader intent. (Resolves the "remove the alias" review item:
 * the decision is to keep.)
 */
export type Selection = Span;

/** True iff a and b have the same blockId and offset. */
export function positionsEqual(a: Position, b: Position): boolean {
  return a.blockId === b.blockId && a.offset === b.offset;
}

/**
 * Compare two positions in the same block. Returns negative/zero/positive
 * by offset. Throws if blockIds differ — cross-block compare requires
 * walking the block tree and lives in `block-compare.ts` (Layer 2 utility,
 * added in Phase 2).
 */
export function comparePositionsWithinBlock(a: Position, b: Position): number {
  if (a.blockId !== b.blockId) {
    throw new Error(
      `comparePositionsWithinBlock called on positions in different blocks (` +
      `${a.blockId} vs ${b.blockId}); use compareBlocksInDocOrder for cross-block compare`,
    );
  }
  return a.offset - b.offset;
}
