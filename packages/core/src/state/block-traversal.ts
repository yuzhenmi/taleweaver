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
  const maxSteps = state.blocks.size + 1;
  let steps = 0;
  while (true) {
    if (++steps > maxSteps) {
      throw new Error(`nextBlockInDocOrder: cycle detected in block tree (visited >${maxSteps} blocks)`);
    }
    if (cursor.nextSiblingId) return cursor.nextSiblingId;
    if (!cursor.parentId) return null;
    const parent = state.blocks.get(cursor.parentId);
    if (!parent) return null;
    cursor = parent;
  }
}

/**
 * Walk to the previous block in document order:
 *   1. If this block has a previous sibling, descend into that sibling's
 *      deepest last child (the rightmost leaf of the previous-sibling subtree).
 *   2. Else, return the parent (when this block is its parent's first child).
 *   3. If no parent, return null (this is the document root).
 *
 * Symmetric to nextBlockInDocOrder. Each step is O(1) for the lookup, but
 * the deepest-last-child descent is O(depth) for blocks with deep subtrees.
 */
export function prevBlockInDocOrder(state: State, blockId: BlockId): BlockId | null {
  const block = state.blocks.get(blockId);
  if (!block) return null;
  if (block.prevSiblingId) {
    // Descend to the deepest last child of the previous sibling.
    let cursor = state.blocks.get(block.prevSiblingId);
    if (!cursor) return null;
    const maxSteps = state.blocks.size + 1;
    let steps = 0;
    while (cursor.lastChildId) {
      if (++steps > maxSteps) {
        throw new Error(`prevBlockInDocOrder: cycle detected in block tree (visited >${maxSteps} blocks)`);
      }
      const next = state.blocks.get(cursor.lastChildId);
      if (!next) break;
      cursor = next;
    }
    return cursor.id;
  }
  return block.parentId;
}

/**
 * Build the ancestor chain from a block up to and including the root.
 * Returns [blockId, parentId, grandparentId, ..., rootId].
 * Returns an empty array if blockId does not exist in state.
 * Throws if a parentId mid-walk references a missing block (malformed
 * state) — silently truncating would mask state corruption.
 */
export function ancestorChain(state: State, blockId: BlockId): BlockId[] {
  if (!state.blocks.has(blockId)) return [];
  const result: BlockId[] = [];
  let current: BlockId | null = blockId;
  const maxSteps = state.blocks.size + 1;
  let steps = 0;
  while (current) {
    if (++steps > maxSteps) {
      throw new Error(`ancestorChain: cycle detected in block tree (visited >${maxSteps} blocks)`);
    }
    const block = state.blocks.get(current);
    if (!block) {
      throw new Error(
        `ancestorChain: parentId "${current}" references a missing block ` +
        `(malformed state, partial chain: [${result.join(", ")}])`,
      );
    }
    result.push(current);
    current = block.parentId;
  }
  return result;
}

/**
 * Walk down via firstChildId to the leftmost leaf in the subtree rooted
 * at blockId. Returns blockId itself if it is a leaf (no firstChildId).
 * Returns null if blockId does not exist.
 */
export function firstLeafBlock(state: State, blockId: BlockId): BlockId | null {
  let cursor = state.blocks.get(blockId);
  if (!cursor) return null;
  const maxSteps = state.blocks.size + 1;
  let steps = 0;
  while (cursor.firstChildId) {
    if (++steps > maxSteps) {
      throw new Error(`firstLeafBlock: cycle detected in block tree (visited >${maxSteps} blocks)`);
    }
    const next = state.blocks.get(cursor.firstChildId);
    if (!next) break;
    cursor = next;
  }
  return cursor.id;
}

/**
 * Walk down via lastChildId to the rightmost leaf in the subtree rooted
 * at blockId. Returns blockId itself if it is a leaf (no lastChildId).
 * Returns null if blockId does not exist.
 */
export function lastLeafBlock(state: State, blockId: BlockId): BlockId | null {
  let cursor = state.blocks.get(blockId);
  if (!cursor) return null;
  const maxSteps = state.blocks.size + 1;
  let steps = 0;
  while (cursor.lastChildId) {
    if (++steps > maxSteps) {
      throw new Error(`lastLeafBlock: cycle detected in block tree (visited >${maxSteps} blocks)`);
    }
    const next = state.blocks.get(cursor.lastChildId);
    if (!next) break;
    cursor = next;
  }
  return cursor.id;
}
