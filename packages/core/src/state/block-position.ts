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
