import type { State, OperationResult } from "./state";
import { applyOperation, getBlock } from "./state";
import type { BlockId } from "./block-id";
import type { ReadonlyAttrs } from "./attrs";
import { attrsEqual } from "./attrs";
import { getYBlock } from "./yjs-doc";
import { buildYAttrs } from "./y-block";
import { STATE_INTERNAL } from "./state-internal";

/**
 * Replace a block's attrs with the given bag. Returns the new state and
 * a dirtyIds set containing the modified block id.
 *
 * No-op short-circuit (matches `mergeBlockAttrs`): when the new bag equals
 * the block's existing attrs we skip the Y.Map write, so `applyOperation`'s
 * no-op contract returns the input `state` reference unchanged (callers can
 * use `result.state === state` as an O(1) "did anything change?" guard).
 * Without this, a same-value `Y.Map.set("attrs", …)` fires a spurious change
 * event that dirties the block and cascades into re-render/re-layout.
 *
 * NOTE: `attrsEqual` here uses structural equality (no `AttrRegistry`
 * custom-equality interpreters), matching `mergeBlockAttrs`. Wiring the
 * registry through both is a tracked follow-up; it does not change behavior
 * for any currently-registered attribute type.
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
    if (attrsEqual(block.attrs, attrs)) {
      return;
    }
    const yBlock = getYBlock(state[STATE_INTERNAL].doc, blockId, "setBlockAttrs");
    yBlock.set("attrs", buildYAttrs(attrs));
  });
}
