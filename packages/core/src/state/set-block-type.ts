import type { State, OperationResult } from "./state";
import { applyOperation, getBlock } from "./state";
import type { BlockId } from "./block-id";
import { getYBlock } from "./yjs-doc";
import { blockKindOf } from "./block-kinds";

/**
 * Change a block's type. Returns the new state and a dirtyIds set
 * containing the modified block id. All other fields preserved.
 *
 * Throws if the block does not exist.
 *
 * Shape-invariance contract (T11): cross-kind transitions are REFUSED.
 * A block's kind (inline-bearing-leaf / atomic-leaf / container — see
 * `block-kinds.ts`) determines which of its structural fields are
 * meaningful: `inlineContent.items` for inline-bearing-leaves (paragraph,
 * heading, list-item), neither for atomic-leaves (image, horizontal-line),
 * `firstChildId`/`lastChildId` for containers (document, list, table,
 * table-row, table-cell). A bare `type` swap across kinds would leave
 * those fields inconsistent with the new shape — the rendered tree would
 * point at children that don't belong, or inline runs that have no slot.
 *
 * Callers that need to change a block's kind must compose remove +
 * insert (which lets them construct the new shape's structural fields
 * correctly) rather than calling setBlockType.
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
  const oldKind = blockKindOf(block.type);
  const newKind = blockKindOf(type);
  if (oldKind !== newKind) {
    throw new Error(
      `setBlockType: cross-kind change refused — ` +
        `block "${blockId}" is ${oldKind} ("${block.type}"), ` +
        `new type "${type}" is ${newKind}. ` +
        `Compose remove + insert instead of changing kind.`,
    );
  }
  return applyOperation(state, () => {
    const yBlock = getYBlock(state.doc, blockId, "setBlockType");
    yBlock.set("type", type);
  });
}
