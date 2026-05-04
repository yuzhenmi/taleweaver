import type { State, OperationResult } from "./state";
import type { BlockId } from "./block-id";
import type { ReadonlyAttrs } from "./attrs";
import { createBlock } from "./block";

/**
 * Replace a block's attrs with the given bag. Returns the new state and
 * a dirtyIds set containing the modified block id.
 *
 * `attrs` replaces wholesale — to merge with existing attrs, compose
 * `{ ...block.attrs, ...newPartial }` at the call site.
 *
 * Throws if the block does not exist.
 */
export function setBlockAttrs(
  state: State,
  blockId: BlockId,
  attrs: ReadonlyAttrs,
): OperationResult {
  const block = state.blocks.get(blockId);
  if (!block) {
    throw new Error(`setBlockAttrs: block "${blockId}" not found`);
  }
  const updated = createBlock({
    id: block.id,
    type: block.type,
    attrs,
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
