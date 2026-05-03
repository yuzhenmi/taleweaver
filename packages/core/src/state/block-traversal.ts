import type { BlockId } from "./block-id";
import type { State } from "./state";

/**
 * Walk to the next block in document order:
 *   1. If this block has a first child, that's next.
 *   2. Else, walk up via parent pointers until a block with a nextSibling
 *      is found; return that nextSibling.
 *   3. If we exhaust the parent chain, return null (end of document).
 *
 * Each step is O(1) (HAMT lookup + pointer follow).
 */
export function nextBlockInDocOrder(state: State, blockId: BlockId): BlockId | null {
  const block = state.blocks.get(blockId);
  if (!block) return null;
  if (block.firstChildId) return block.firstChildId;
  let cursor = block;
  while (true) {
    if (cursor.nextSiblingId) return cursor.nextSiblingId;
    if (!cursor.parentId) return null;
    const parent = state.blocks.get(cursor.parentId);
    if (!parent) return null;
    cursor = parent;
  }
}
