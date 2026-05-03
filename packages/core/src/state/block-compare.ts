import type { BlockId } from "./block-id";
import type { State } from "./state";
import type { Position } from "./block-position";
import { ancestorChain } from "./block-traversal";

/**
 * Compare two blocks in document order.
 * Returns negative if a is before b, positive if a is after b, zero if equal.
 *
 * Algorithm (LCA walk):
 *   1. Build ancestor chains from each block up to (and including) the root.
 *   2. Walk from the roots downward to find the lowest common ancestor (LCA).
 *      Since chains end at the root, walking back from the end of each chain
 *      gives us the path from root to each block.
 *   3. At the LCA, the two child branches of the LCA are different blocks
 *      (or one is the LCA itself if one is an ancestor of the other).
 *   4. If one block IS the LCA: the LCA (ancestor) comes first.
 *   5. Else: walk LCA's child linked list to determine which branch comes
 *      first; that block (and its subtree) is in document order first.
 *
 * Worst case: O(depth + LCA-fanout). At target scale (depth 3-5, fanout
 * typically <100), bounded by ~100 sibling-pointer hops.
 *
 * Throws if either id does not exist, or if blocks have no common ancestor.
 */
export function compareBlocksInDocOrder(state: State, idA: BlockId, idB: BlockId): number {
  if (idA === idB) return 0;

  const chainA = ancestorChain(state, idA);
  const chainB = ancestorChain(state, idB);
  if (chainA.length === 0) throw new Error(`compareBlocksInDocOrder: block "${idA}" not found`);
  if (chainB.length === 0) throw new Error(`compareBlocksInDocOrder: block "${idB}" not found`);

  // Roots must match for blocks to be comparable.
  const rootA = chainA[chainA.length - 1];
  const rootB = chainB[chainB.length - 1];
  if (rootA !== rootB) {
    throw new Error(
      `compareBlocksInDocOrder: blocks "${idA}" and "${idB}" have no common ancestor`,
    );
  }

  // Walk from root toward each block to find LCA.
  // chainA / chainB go [self, ..., root]; reverse the indexing.
  let i = chainA.length - 1;
  let j = chainB.length - 1;
  while (i >= 0 && j >= 0 && chainA[i] === chainB[j]) {
    i--;
    j--;
  }

  // If one chain ran out, that block is an ancestor of the other; ancestor comes first.
  if (i < 0) return -1; // a is ancestor of b
  if (j < 0) return 1;  // b is ancestor of a

  // chainA[i] and chainB[j] are different children of the LCA (which is chainA[i+1] === chainB[j+1]).
  // Walk the LCA's child linked list to see which child comes first.
  const lcaId = chainA[i + 1];
  const lca = state.blocks.get(lcaId);
  if (!lca) throw new Error(`compareBlocksInDocOrder: LCA "${lcaId}" not found`);

  let cursor: BlockId | null = lca.firstChildId;
  while (cursor) {
    if (cursor === chainA[i]) return -1;
    if (cursor === chainB[j]) return 1;
    const block = state.blocks.get(cursor);
    cursor = block ? block.nextSiblingId : null;
  }

  throw new Error(
    `compareBlocksInDocOrder: branches "${chainA[i]}" / "${chainB[j]}" not found in LCA "${lcaId}" children`,
  );
}

/**
 * Compare two positions in document order.
 * Same block: compare offsets.
 * Different blocks: delegate to compareBlocksInDocOrder.
 */
export function comparePositions(state: State, a: Position, b: Position): number {
  if (a.blockId === b.blockId) return a.offset - b.offset;
  return compareBlocksInDocOrder(state, a.blockId, b.blockId);
}

/**
 * Return the id of the selection-context root for the given block.
 *
 * A "selection context" is the root of a sub-tree within which selections
 * may extend (main document body, OR one specific footnote body, etc.).
 * Cross-context spans are not supported.
 *
 * Implementation: walk parentId until null; return the topmost block id.
 * For Phase 2, this is always state.rootId because embed-content sub-trees
 * (with parentId === null) don't exist yet. Future phases will introduce
 * such sub-trees; this function will then correctly return their own root
 * ids as separate contexts.
 *
 * Returns null if blockId does not exist.
 */
export function selectionContextOf(state: State, blockId: BlockId): BlockId | null {
  let cursor = state.blocks.get(blockId);
  if (!cursor) return null;
  const maxSteps = state.blocks.size + 1;
  let steps = 0;
  while (cursor.parentId) {
    if (++steps > maxSteps) {
      throw new Error(`selectionContextOf: cycle detected in block tree (visited >${maxSteps} blocks)`);
    }
    const parent = state.blocks.get(cursor.parentId);
    if (!parent) break;
    cursor = parent;
  }
  return cursor.id;
}
