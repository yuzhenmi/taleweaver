import type { State, OperationResult } from "./state";
import { applyOperation, getBlock } from "./state";
import type { BlockId, IdAllocator } from "./block-id";
import type { ReadonlyAttrs } from "./attrs";
import type { InlineContent } from "./inline-content";
import { getBlocksMap, getYBlock } from "./yjs-doc";
import { buildYBlock } from "./y-block";

export interface InsertBlockArgs {
  type: string;
  attrs?: ReadonlyAttrs;
  inlineContent?: InlineContent | null;
}

/**
 * Insert a new block as a child of `parentId`, immediately before
 * `beforeSiblingId`. If `beforeSiblingId` is null, the new block is
 * appended as the new last child.
 *
 * Returns OperationResult with the new state and dirtyIds containing:
 *   - the new block's id
 *   - the parent's id (firstChild/lastChild may have changed)
 *   - the previous sibling's id (its nextSiblingId is rewired)
 *   - the next sibling's id (its prevSiblingId is rewired)
 *
 * Throws if `parentId` does not exist, or if `beforeSiblingId` is
 * non-null and is not actually a child of `parentId`.
 */
export function insertBlock(
  state: State,
  parentId: BlockId,
  beforeSiblingId: BlockId | null,
  args: InsertBlockArgs,
  allocator: IdAllocator,
): OperationResult {
  const parent = getBlock(state, parentId);
  if (!parent) {
    throw new Error(`insertBlock: parent "${parentId}" not found`);
  }

  // Determine prev / next siblings.
  let prevSiblingId: BlockId | null;
  let nextSiblingId: BlockId | null;

  if (beforeSiblingId === null) {
    // Append: new block becomes lastChild; prev = current lastChild; next = null.
    prevSiblingId = parent.lastChildId;
    nextSiblingId = null;
  } else {
    const beforeSibling = getBlock(state, beforeSiblingId);
    if (!beforeSibling) {
      throw new Error(`insertBlock: beforeSibling "${beforeSiblingId}" not found`);
    }
    if (beforeSibling.parentId !== parentId) {
      throw new Error(
        `insertBlock: beforeSibling "${beforeSiblingId}" is not a child of parent "${parentId}"`,
      );
    }
    nextSiblingId = beforeSiblingId;
    prevSiblingId = beforeSibling.prevSiblingId;
  }

  // Allocate the new block's id outside the transaction so the allocator
  // is bumped exactly once even if the transaction body re-runs.
  const newId = allocator.allocate();
  const newFirstChildId = prevSiblingId === null ? newId : parent.firstChildId;
  const newLastChildId = nextSiblingId === null ? newId : parent.lastChildId;

  return applyOperation(state, () => {
    // Add the new block to the blocks map with full linkage.
    getBlocksMap(state.doc).set(
      newId,
      buildYBlock({
        type: args.type,
        attrs: args.attrs ?? {},
        parentId,
        prevSiblingId,
        nextSiblingId,
        firstChildId: null,
        lastChildId: null,
        inlineContent: args.inlineContent ?? null,
      }),
    );

    // Update prev sibling's nextSiblingId (if any) to point at the new block.
    if (prevSiblingId !== null) {
      const yPrev = getYBlock(state.doc, prevSiblingId, "insertBlock");
      yPrev.set("nextSiblingId", newId);
    }

    // Update next sibling's prevSiblingId (if any) to point at the new block.
    if (nextSiblingId !== null) {
      const yNext = getYBlock(state.doc, nextSiblingId, "insertBlock");
      yNext.set("prevSiblingId", newId);
    }

    // Update parent's firstChildId / lastChildId if the new block sits at a boundary.
    const yParent = getYBlock(state.doc, parentId, "insertBlock");
    yParent.set("firstChildId", newFirstChildId);
    yParent.set("lastChildId", newLastChildId);
  });
}
