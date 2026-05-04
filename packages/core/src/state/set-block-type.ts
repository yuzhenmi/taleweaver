import type { State, OperationResult } from "./state";
import type { BlockId } from "./block-id";
import { createBlock } from "./block";

/**
 * Change a block's type. Returns the new state and a dirtyIds set
 * containing the modified block id. All other fields preserved.
 *
 * Throws if the block does not exist.
 *
 * Note: changing type from container to leaf (or vice versa) is allowed
 * but the caller is responsible for ensuring the block's children
 * (firstChildId/lastChildId) and inlineContent fields make sense for
 * the new type. This operation just updates the type tag.
 */
export function setBlockType(
  state: State,
  blockId: BlockId,
  type: string,
): OperationResult {
  const block = state.blocks.get(blockId);
  if (!block) {
    throw new Error(`setBlockType: block "${blockId}" not found`);
  }
  const updated = createBlock({
    id: block.id,
    type,
    attrs: block.attrs,
    parentId: block.parentId,
    prevSiblingId: block.prevSiblingId,
    nextSiblingId: block.nextSiblingId,
    firstChildId: block.firstChildId,
    lastChildId: block.lastChildId,
    inlineContent: block.inlineContent,
  });
  return {
    state: { ...state, blocks: state.blocks.set(blockId, updated) },
    dirtyIds: new Set([blockId]),
  };
}
