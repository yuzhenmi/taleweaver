import type { BlockId } from "../block";

export interface ModelPosition {
  readonly blockId: BlockId;
  readonly offset: number;
  /**
   * A LEADING endpoint (offset 0 only): before the block objects that directly
   * precede the paragraph, not at its first caret position. Produced by select-all
   * and by a TOC's object selection; a range starting here deletes those objects (C9).
   */
  readonly leading?: true;
}

export interface ModelSelection {
  readonly anchor: ModelPosition;
  readonly focus: ModelPosition;
}

export const position = (blockId: BlockId, offset: number): ModelPosition => ({ blockId, offset });

export function caretAt(blockId: BlockId, offset: number): ModelSelection {
  const p = position(blockId, offset);
  return { anchor: p, focus: p };
}

/** Which side an ambiguous position sticks to: `-1` stays before an insertion at it, `1` moves after (ProseMirror's convention). */
export type Assoc = -1 | 1;
