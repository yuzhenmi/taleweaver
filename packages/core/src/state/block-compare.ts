import type { BlockId } from "./block-id";
import type { Block } from "./block";
import { resolveBlock, blockCount, type State } from "./state";
import type { Position, Span } from "./block-position";
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
  if (lcaId === undefined) {
    // Unreachable: the roots matched, so the while-loop decremented at least
    // once, leaving i <= chainA.length - 2 and i+1 a valid in-bounds index.
    throw new Error(`compareBlocksInDocOrder: LCA index ${i + 1} out of range in chainA`);
  }
  const lca = resolveBlock(state, lcaId)?.block ?? null;
  if (lca === null) throw new Error(`compareBlocksInDocOrder: LCA "${lcaId}" not found`);

  let cursor: BlockId | null = lca.firstChildId;
  while (cursor) {
    if (cursor === chainA[i]) return -1;
    if (cursor === chainB[j]) return 1;
    const block = resolveBlock(state, cursor)?.block ?? null;
    cursor = block !== null ? block.nextSiblingId : null;
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
 * Return the earlier position of a Span in document order. If anchor
 * precedes focus, returns anchor; otherwise returns focus. Collapsed spans
 * (anchor.equals(focus)) return anchor.
 *
 * Uses `comparePositions` (which dispatches to within-block or cross-block
 * compare). Constant-time when anchor and focus share a blockId;
 * O(depth + LCA-fanout) when they don't.
 */
export function spanStart(state: State, span: Span): Position {
  return comparePositions(state, span.anchor, span.focus) <= 0
    ? span.anchor
    : span.focus;
}

/**
 * Return the later position of a Span in document order. Mirror of
 * `spanStart`. Collapsed spans return focus.
 */
export function spanEnd(state: State, span: Span): Position {
  return comparePositions(state, span.anchor, span.focus) <= 0
    ? span.focus
    : span.anchor;
}

/**
 * Return the id of the selection-context root for the given block.
 *
 * A "selection context" is the root of a sub-tree within which selections
 * may extend (main document body, OR one specific footnote body, etc.).
 * Cross-context spans are not supported.
 *
 * Implementation: walk parentId until null; return the topmost block id.
 * For a main-document block this is `state.rootId`. For a block inside an
 * embed body (footnote body) or a template body (header/footer body) — which
 * live in the embedContents / templateContents trees with their own
 * `parentId === null` ROOT — this returns that BODY's root, NOT the main
 * `state.rootId`. The walk resolves blocks via `resolveBlock` (all three
 * trees), so it follows the parentId chain WITHIN whichever tree the block
 * lives in until it reaches that tree's root.
 *
 * This is the load-bearing cross-context signal: a span whose anchor and focus
 * land in different contexts (e.g. main body → header body) has different
 * `selectionContextOf` results, which the span ops use to refuse the
 * selection. Cross-context spans are not supported in the data model.
 *
 * Returns null if blockId does not exist in any tree.
 */
export function selectionContextOf(state: State, blockId: BlockId): BlockId | null {
  let cursor: Block | null = resolveBlock(state, blockId)?.block ?? null;
  if (cursor === null) return null;
  // Cycle-detection bound: see nextBlockInDocOrder in block-traversal.ts
  // for the rationale on why this uses the all-tree block count.
  const maxSteps = blockCount(state) + 1;
  let steps = 0;
  while (cursor.parentId) {
    if (++steps > maxSteps) {
      throw new Error(`selectionContextOf: cycle detected in block tree (visited >${maxSteps} blocks)`);
    }
    const parent: Block | null = resolveBlock(state, cursor.parentId)?.block ?? null;
    if (parent === null) break;
    cursor = parent;
  }
  return cursor.id;
}
