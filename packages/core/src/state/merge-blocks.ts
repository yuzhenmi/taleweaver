import * as Y from "yjs";
import type { State, OperationResult } from "./state";
import { applyOperation, getBlock } from "./state";
import type { BlockId } from "./block-id";
import { getBlocksMap, getYBlock } from "./yjs-doc";
import { cloneInlineItem, mergeAdjacentSameAttrsTextItems } from "./y-utils";

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
 *
 * Y.Doc identity: right's items are deep-cloned onto left's inlineContent
 * Y.Array (Yjs forbids re-parenting a Y type). Left's existing items retain
 * their Y.Text identity EXCEPT when the seam converges (last-of-left and
 * first-of-right have value-equal attrs): the same-attrs merge pass replaces
 * both seam items with a single fresh Y.Text holding the concatenated
 * content. Items away from the seam are never touched.
 */
export function mergeAdjacentBlocks(
  state: State,
  leftId: BlockId,
  rightId: BlockId,
): OperationResult {
  if (leftId === rightId) {
    throw new Error(`mergeAdjacentBlocks: left and right are the same block "${leftId}"`);
  }

  const left = getBlock(state, leftId);
  if (left === null) {
    throw new Error(`mergeAdjacentBlocks: left block "${leftId}" not found`);
  }
  const right = getBlock(state, rightId);
  if (right === null) {
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
  const parentId = left.parentId;
  if (parentId === null) {
    throw new Error(
      `mergeAdjacentBlocks: blocks "${leftId}" and "${rightId}" have null parent (state corruption)`,
    );
  }

  return applyOperation(state, () => {
    const yBlocks = getBlocksMap(state.doc);
    const yLeft = getYBlock(state.doc, leftId, "mergeAdjacentBlocks");
    const yRight = getYBlock(state.doc, rightId, "mergeAdjacentBlocks");
    const yLeftItems = yLeft.get("inlineContent") as Y.Array<Y.Map<unknown>>;
    const yRightItems = yRight.get("inlineContent") as Y.Array<Y.Map<unknown>>;

    // Append clones of right's items to left. Yjs forbids re-parenting a Y
    // type, so we clone — left keeps its existing items' Y.Text identity;
    // only right's items get freshly materialized on the left side.
    const cloned: Y.Map<unknown>[] = [];
    for (let i = 0; i < yRightItems.length; i++) {
      cloned.push(cloneInlineItem(yRightItems.get(i)));
    }
    if (cloned.length > 0) {
      yLeftItems.push(cloned);
      // Same-attrs merge pass to uphold the normalized inline-content invariant.
      // Only needed when we actually appended items.
      mergeAdjacentSameAttrsTextItems(yLeftItems);
    }

    // Rewire siblings around right (right.next becomes left.next).
    const rightNextId = (yRight.get("nextSiblingId") as BlockId | null) ?? null;
    yLeft.set("nextSiblingId", rightNextId);
    if (rightNextId !== null) {
      getYBlock(state.doc, rightNextId, "mergeAdjacentBlocks").set(
        "prevSiblingId",
        leftId,
      );
    } else {
      // Right was the last child — rewire parent.lastChildId to left.
      // Preconditions guarantee parent.lastChildId is rightId (same-parent
      // + adjacent-sibling + right.nextSibling===null). Unconditional
      // rewire matches the documented contract; an upstream invariant
      // violation would surface as a getYBlock throw.
      const yParent = getYBlock(state.doc, parentId, "mergeAdjacentBlocks");
      yParent.set("lastChildId", leftId);
    }

    // Delete right last (after reads of yRight are done).
    yBlocks.delete(rightId);
  });
}
