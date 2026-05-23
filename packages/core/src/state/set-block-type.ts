import type { State, OperationResult } from "./state";
import { applyOperation, getBlock } from "./state";
import type { BlockId } from "./block-id";
import { getYBlock } from "./yjs-doc";
import type { BlockKindResolver } from "./block-kinds";
import { blockKindOf } from "./block-kinds";
import { STATE_INTERNAL } from "./state-internal";

/**
 * Change a block's type. Returns the new state and a dirtyIds set
 * containing the modified block id. All other fields preserved.
 *
 * Throws if the block does not exist, or if either the existing or new
 * type is not registered with the resolver.
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
 *
 * The `resolver` parameter is REQUIRED: the function cannot operate
 * without knowing the taxonomy. Callers supply a `BlockKindResolver`
 * (typically the editor's `ComponentRegistry`).
 */
export function setBlockType(
  state: State,
  blockId: BlockId,
  type: string,
  resolver: BlockKindResolver,
): OperationResult {
  const block = getBlock(state, blockId);
  if (block === null) {
    throw new Error(`setBlockType: block "${blockId}" not found`);
  }
  const oldKind = blockKindOf(block.type, resolver);
  if (oldKind === null) {
    throw new Error(
      `setBlockType: existing block's type "${block.type}" is not registered`,
    );
  }
  const newKind = blockKindOf(type, resolver);
  if (newKind === null) {
    throw new Error(`setBlockType: new type "${type}" is not registered`);
  }
  if (oldKind !== newKind) {
    throw new Error(
      `setBlockType: cross-kind change refused — ` +
        `block "${blockId}" is ${oldKind} ("${block.type}"), ` +
        `new type "${type}" is ${newKind}. ` +
        `Compose remove + insert instead of changing kind.`,
    );
  }
  return applyOperation(state, () => {
    const yBlock = getYBlock(state[STATE_INTERNAL].doc, blockId, "setBlockType");
    yBlock.set("type", type);
  });
}
