import type { State, OperationResult } from "./state";
import type { BlockId } from "./block-id";
import { createInlineContent, mergeAdjacentTextItems } from "./inline-content";
import { updateBlock } from "./block";

/**
 * Merge two adjacent leaf siblings into one block.
 *
 * Left wins: keeps id, type, attrs, parentId, prevSiblingId. Its
 * nextSiblingId is rewired to right.nextSiblingId. Its inlineContent
 * becomes [...left.items, ...right.items] with a run-merging post-pass
 * across the seam.
 *
 * Right is removed from state.blocks. If right had a nextSibling, that
 * sibling's prevSiblingId is rewired to leftId. If right was the parent's
 * lastChildId, the parent's lastChildId is rewired to leftId.
 *
 * Returns OperationResult with dirtyIds containing:
 *   - left's id (content + nextSiblingId changed)
 *   - right's id (removed from state.blocks)
 *   - right's old nextSibling, if non-null (its prevSiblingId was rewired)
 *   - parent's id, if right was the last child (parent's lastChildId rewired)
 *
 * Throws if:
 *   - either block does not exist,
 *   - leftId === rightId,
 *   - either block is a container (firstChildId !== null OR inlineContent === null),
 *   - blocks have different parents,
 *   - blocks are not adjacent siblings (left.nextSiblingId !== rightId
 *     OR right.prevSiblingId !== leftId).
 */
export function mergeAdjacentBlocks(
  state: State,
  leftId: BlockId,
  rightId: BlockId,
): OperationResult {
  if (leftId === rightId) {
    throw new Error(`mergeAdjacentBlocks: left and right are the same block "${leftId}"`);
  }

  const left = state.blocks.get(leftId);
  if (!left) {
    throw new Error(`mergeAdjacentBlocks: left block "${leftId}" not found`);
  }
  const right = state.blocks.get(rightId);
  if (!right) {
    throw new Error(`mergeAdjacentBlocks: right block "${rightId}" not found`);
  }

  if (!left.inlineContent || left.firstChildId !== null) {
    throw new Error(
      `mergeAdjacentBlocks: left block "${leftId}" is a container, not a leaf`,
    );
  }
  if (!right.inlineContent || right.firstChildId !== null) {
    throw new Error(
      `mergeAdjacentBlocks: right block "${rightId}" is a container, not a leaf`,
    );
  }

  if (left.parentId !== right.parentId) {
    throw new Error(
      `mergeAdjacentBlocks: blocks "${leftId}" and "${rightId}" have different parents ` +
      `("${left.parentId}" vs "${right.parentId}")`,
    );
  }

  if (left.nextSiblingId !== rightId || right.prevSiblingId !== leftId) {
    throw new Error(
      `mergeAdjacentBlocks: blocks "${leftId}" and "${rightId}" are not adjacent siblings ` +
      `(left.nextSiblingId="${left.nextSiblingId}", right.prevSiblingId="${right.prevSiblingId}")`,
    );
  }

  // Defensive — same-parent + adjacency implies non-null parent (siblings can't
  // both be the root, since the root is unique and has no siblings).
  if (left.parentId === null) {
    throw new Error(
      `mergeAdjacentBlocks: blocks "${leftId}" and "${rightId}" have null parent (state corruption)`,
    );
  }

  const mergedItems = mergeAdjacentTextItems([
    ...left.inlineContent.items,
    ...right.inlineContent.items,
  ]);

  const updatedLeft = updateBlock(left, {
    nextSiblingId: right.nextSiblingId,
    inlineContent: createInlineContent(mergedItems),
  });

  let blocks = state.blocks.set(leftId, updatedLeft).delete(rightId);
  const dirtyIds = new Set<BlockId>([leftId, rightId]);

  if (right.nextSiblingId) {
    const oldRightNext = state.blocks.get(right.nextSiblingId);
    if (!oldRightNext) {
      throw new Error(
        `mergeAdjacentBlocks: right's next sibling "${right.nextSiblingId}" not found`,
      );
    }
    blocks = blocks.set(right.nextSiblingId, updateBlock(oldRightNext, { prevSiblingId: leftId }));
    dirtyIds.add(right.nextSiblingId);
  } else {
    const parent = state.blocks.get(left.parentId);
    if (!parent) {
      throw new Error(
        `mergeAdjacentBlocks: parent "${left.parentId}" of merged blocks not found`,
      );
    }
    blocks = blocks.set(left.parentId, updateBlock(parent, { lastChildId: leftId }));
    dirtyIds.add(left.parentId);
  }

  return {
    state: { ...state, blocks },
    dirtyIds,
  };
}
