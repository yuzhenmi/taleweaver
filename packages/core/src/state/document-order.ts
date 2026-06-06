import type { BlockId } from "./block-id";
import type { Block } from "./block";
import { getBlock, blockCount, type State } from "./state";

/**
 * Yield every BODY block in document order (depth-first: a block, then its
 * children, then its next sibling), starting from the root. Follows
 * firstChildId / nextSiblingId pointers.
 *
 * Cycle detection runs in two dimensions, because this is a RECURSIVE walk
 * (unlike the iterative traversals in `block-traversal.ts`):
 *   - the `firstChildId` recursion carries an active-path `visited` set —
 *     a `firstChildId` pointing back at an ancestor would otherwise recurse
 *     to a stack overflow before any counter fired. This mirrors the render
 *     pass's active-path guard (`render-core.ts`). The id is removed from the
 *     set once its subtree completes, so a DAG-shaped reuse later in the walk
 *     is still permitted; only a live ancestor cycle throws.
 *   - the `nextSiblingId` sibling loop carries a `blockCount(state) + 1` bound
 *     mirroring the other state traversals — a safe upper limit on the distinct
 *     blocks a doc-order traversal can visit (it sums all three trees; see
 *     `nextBlockInDocOrder`). A sibling chain longer than this can only be a cycle.
 */
export function* iterateBlocksInDocumentOrder(state: State): Iterable<Block> {
  const root = getBlock(state, state.rootId);
  if (root === null) return;
  yield* walk(state, state.rootId, new Set<BlockId>());
}

function* walk(state: State, id: BlockId, visited: Set<BlockId>): Iterable<Block> {
  if (visited.has(id)) {
    throw new Error(
      `iterateBlocksInDocumentOrder: cycle detected — block "${id}" is its own ancestor`,
    );
  }
  const block = getBlock(state, id);
  if (block === null) return;
  visited.add(id);
  try {
    yield block;
    // Sibling-chain cycle bound: see the module docstring + block-traversal.ts.
    const maxSteps = blockCount(state) + 1;
    let childId = block.firstChildId;
    let steps = 0;
    while (childId !== null) {
      if (++steps > maxSteps) {
        throw new Error(
          `iterateBlocksInDocumentOrder: cycle detected in block tree (visited >${maxSteps} siblings of "${id}")`,
        );
      }
      yield* walk(state, childId, visited);
      const child = getBlock(state, childId);
      childId = child === null ? null : child.nextSiblingId;
    }
  } finally {
    visited.delete(id);
  }
}
