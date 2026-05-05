import type { State, OperationResult } from "./state";
import type { BlockId, IdAllocator } from "./block-id";
import type { ReadonlyAttrs } from "./attrs";
import type { InlineContent } from "./inline-content";
import { createBlock, updateBlock } from "./block";

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
  const parent = state.blocks.get(parentId);
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
    const beforeSibling = state.blocks.get(beforeSiblingId);
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

  // Create the new block with proper linkage.
  const newId = allocator.allocate();
  const newBlock = createBlock({
    id: newId,
    type: args.type,
    attrs: args.attrs,
    parentId,
    prevSiblingId,
    nextSiblingId,
    inlineContent: args.inlineContent,
  });

  // Build the updated blocks map.
  let blocks = state.blocks.set(newId, newBlock);
  const dirtyIds = new Set<BlockId>([newId, parentId]);

  // Update prev sibling's nextSiblingId, OR parent's firstChildId if there's no prev sibling.
  if (prevSiblingId) {
    const prev = state.blocks.get(prevSiblingId);
    if (!prev) throw new Error(`insertBlock: prev sibling "${prevSiblingId}" not found`);
    blocks = blocks.set(prevSiblingId, updateBlock(prev, { nextSiblingId: newId }));
    dirtyIds.add(prevSiblingId);
  }

  // Update next sibling's prevSiblingId, OR parent's lastChildId if there's no next sibling.
  if (nextSiblingId) {
    const next = state.blocks.get(nextSiblingId);
    if (!next) throw new Error(`insertBlock: next sibling "${nextSiblingId}" not found`);
    blocks = blocks.set(nextSiblingId, updateBlock(next, { prevSiblingId: newId }));
    dirtyIds.add(nextSiblingId);
  }

  // Update parent's firstChildId / lastChildId if the new block sits at a boundary.
  const newFirstChildId = prevSiblingId === null ? newId : parent.firstChildId;
  const newLastChildId = nextSiblingId === null ? newId : parent.lastChildId;
  blocks = blocks.set(
    parentId,
    updateBlock(parent, { firstChildId: newFirstChildId, lastChildId: newLastChildId }),
  );

  return {
    state: { ...state, blocks },
    dirtyIds,
  };
}
