import type { BlockId } from "./block-id";
import type { Block } from "./block";
import { resolveBlock, blockCount, createWalkGuard, type State } from "./state";

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
  const block = resolveBlock(state, blockId)?.block ?? null;
  if (block === null) return null;
  if (block.firstChildId) return block.firstChildId;
  let cursor = block;
  // Cycle-detection bound: total block count across all three trees (main
  // `blocks`, `embedContents`, `templateContents`) via the `blockCount`
  // Layer-1 accessor. This helper is map-agnostic (it resolves
  // blocks via `resolveBlock`, which checks all three trees), so a walk WITHIN
  // an embed or template body subtree (a header/footer body, footnote body) is
  // a legitimate traversal — its depth is bounded by that body's block count,
  // not the main map's. A main-map-sized bound would under-bound such a walk
  // and spuriously throw. Summing all three is a safe upper limit on the
  // distinct blocks any single doc-order traversal can visit.
  const guard = createWalkGuard(state);
  while (true) {
    if (guard.step()) {
      throw new Error(`nextBlockInDocOrder: cycle detected in block tree (visited >${blockCount(state) + 1} blocks)`);
    }
    if (cursor.nextSiblingId) return cursor.nextSiblingId;
    if (!cursor.parentId) return null;
    const parent = resolveBlock(state, cursor.parentId)?.block ?? null;
    if (parent === null) return null;
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
  const block = resolveBlock(state, blockId)?.block ?? null;
  if (block === null) return null;
  if (block.prevSiblingId) {
    // Descend to the deepest last child of the previous sibling.
    let cursor: Block | null = resolveBlock(state, block.prevSiblingId)?.block ?? null;
    if (cursor === null) return null;
    // Cycle-detection bound: see nextBlockInDocOrder for the rationale
    // on why this uses the all-tree block count.
    const guard = createWalkGuard(state);
    while (cursor.lastChildId) {
      if (guard.step()) {
        throw new Error(`prevBlockInDocOrder: cycle detected in block tree (visited >${blockCount(state) + 1} blocks)`);
      }
      const next: Block | null = resolveBlock(state, cursor.lastChildId)?.block ?? null;
      if (next === null) break;
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
  if (resolveBlock(state, blockId) === null) return [];
  const result: BlockId[] = [];
  let current: BlockId | null = blockId;
  // Cycle-detection bound: see nextBlockInDocOrder for the rationale
  // on why this uses the all-tree block count.
  const guard = createWalkGuard(state);
  while (current) {
    if (guard.step()) {
      throw new Error(`ancestorChain: cycle detected in block tree (visited >${blockCount(state) + 1} blocks)`);
    }
    const block: Block | null = resolveBlock(state, current)?.block ?? null;
    if (block === null) {
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
  let cursor: Block | null = resolveBlock(state, blockId)?.block ?? null;
  if (cursor === null) return null;
  // Cycle-detection bound: see nextBlockInDocOrder for the rationale
  // on why this uses the all-tree block count.
  const guard = createWalkGuard(state);
  while (cursor.firstChildId) {
    if (guard.step()) {
      throw new Error(`firstLeafBlock: cycle detected in block tree (visited >${blockCount(state) + 1} blocks)`);
    }
    const next: Block | null = resolveBlock(state, cursor.firstChildId)?.block ?? null;
    if (next === null) break;
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
  let cursor: Block | null = resolveBlock(state, blockId)?.block ?? null;
  if (cursor === null) return null;
  // Cycle-detection bound: see nextBlockInDocOrder for the rationale
  // on why this uses the all-tree block count.
  const guard = createWalkGuard(state);
  while (cursor.lastChildId) {
    if (guard.step()) {
      throw new Error(`lastLeafBlock: cycle detected in block tree (visited >${blockCount(state) + 1} blocks)`);
    }
    const next: Block | null = resolveBlock(state, cursor.lastChildId)?.block ?? null;
    if (next === null) break;
    cursor = next;
  }
  return cursor.id;
}

/**
 * The document's top-level blocks in order: the children of each of the root's
 * sections (the root's children are always sections — the final one always exists).
 * O(top-level blocks).
 */
export function topLevelBlockIds(state: State): BlockId[] {
  const out: BlockId[] = [];
  const guard = createWalkGuard(state);
  for (let s = resolveBlock(state, state.rootId)?.block.firstChildId ?? null; s !== null; ) {
    const section = resolveBlock(state, s)?.block ?? null;
    if (section === null) break;
    for (let c = section.firstChildId; c !== null; ) {
      if (guard.step()) throw new Error("topLevelBlockIds: cycle in the sibling chain");
      out.push(c);
      c = resolveBlock(state, c)?.block.nextSiblingId ?? null;
    }
    s = section.nextSiblingId;
  }
  return out;
}
