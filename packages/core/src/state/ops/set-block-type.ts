import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import { getYBlock } from "../yjs-doc";
import type { BlockKindResolver } from "../block-kinds";

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
 * No-op short-circuit (matches `setBlockAttrs` / `mergeBlockAttrs`): when
 * the requested `type` equals the block's existing type we skip the Y.Map
 * write and return the LITERAL input `state` reference with an empty
 * `dirtyIds`, so callers can use `result.state === state` as an O(1) "did
 * anything change?" guard. Without it, a same-value `Y.Map.set("type", …)`
 * fires a spurious change event that dirties the block and cascades into
 * re-render/re-layout. The short-circuit is positioned AFTER the existence
 * and registration/cross-kind guards, so a same-type call on a missing,
 * unregistered, or shape-invalid block still throws exactly as before.
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
  const resolved = resolveBlock(state, blockId);
  if (resolved === null) {
    throw new Error(`setBlockType: block "${blockId}" not found`);
  }
  const { block, kind } = resolved;
  const oldKind = resolver.getBlockKind(block.type);
  if (oldKind === null) {
    throw new Error(
      `setBlockType: existing block's type "${block.type}" is not registered`,
    );
  }
  const newKind = resolver.getBlockKind(type);
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
  if (type === block.type) {
    // No-op: requested type already in place. Return the input state
    // reference unchanged (identity-preserving "did anything change?"
    // contract); placed after the guards above so a same-type call on a
    // missing/unregistered/shape-invalid block still throws.
    return { state, dirtyIds: new Set() };
  }
  return applyOperation(state, (doc) => {
    const yBlock = getYBlock(doc, blockId, "setBlockType", kind);
    yBlock.set("type", type);
  });
}
