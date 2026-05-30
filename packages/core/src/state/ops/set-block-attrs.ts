import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { attrsEqual } from "../attrs";
import { getYBlock } from "../yjs-doc";
import { buildYAttrs } from "../y-block";
import { STATE_INTERNAL } from "../state-internal";
import type { AttrRegistry } from "../../cascade/attr-registry";

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
 * `registry` is consulted by `attrsEqual` for per-key custom equality (an
 * interpreter's `equals` overrides the default `deepValueEqual`) — e.g. a
 * `comment` attr whose `timestamp` field shouldn't affect "did anything
 * change?" decisions. Omitted → structural deep equality only. Callers from
 * the editor pass `config.attrRegistry`.
 *
 * Throws if the block does not exist.
 */
export function setBlockAttrs(
  state: State,
  blockId: BlockId,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): OperationResult {
  const resolved = resolveBlock(state, blockId);
  if (resolved === null) {
    throw new Error(`setBlockAttrs: block "${blockId}" not found`);
  }
  const { block, kind } = resolved;
  return applyOperation(state, () => {
    if (attrsEqual(block.attrs, attrs, registry)) {
      return;
    }
    const yBlock = getYBlock(state[STATE_INTERNAL].doc, blockId, "setBlockAttrs", kind);
    yBlock.set("attrs", buildYAttrs(attrs));
  });
}
