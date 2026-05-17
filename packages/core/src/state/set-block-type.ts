import type { State, OperationResult } from "./state";
import { applyOperation, getBlock } from "./state";
import type { BlockId } from "./block-id";
import { getBlocksMap } from "./yjs-doc";

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
  const block = getBlock(state, blockId);
  if (block === null) {
    throw new Error(`setBlockType: block "${blockId}" not found`);
  }
  return applyOperation(state, () => {
    const yBlock = getBlocksMap(state.doc).get(blockId);
    if (yBlock === undefined) {
      throw new Error(`setBlockType: block "${blockId}" not found`);
    }
    yBlock.set("type", type);
  });
}
