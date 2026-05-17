import type { State, OperationResult } from "./state";
import { applyOperation, getBlock } from "./state";
import type { BlockId } from "./block-id";
import type { ReadonlyAttrs } from "./attrs";
import { getBlocksMap } from "./yjs-doc";
import { buildYAttrs } from "./y-block";

/**
 * Replace a block's attrs with the given bag. Returns the new state and
 * a dirtyIds set containing the modified block id.
 *
 * Throws if the block does not exist.
 */
export function setBlockAttrs(
  state: State,
  blockId: BlockId,
  attrs: ReadonlyAttrs,
): OperationResult {
  const block = getBlock(state, blockId);
  if (block === null) {
    throw new Error(`setBlockAttrs: block "${blockId}" not found`);
  }
  return applyOperation(state, () => {
    const yBlock = getBlocksMap(state.doc).get(blockId)!;
    yBlock.set("attrs", buildYAttrs(attrs));
  });
}
