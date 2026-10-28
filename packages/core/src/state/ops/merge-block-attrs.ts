import { attrRegistryOf } from "../mark-attrs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { attrsEqual, mergeAttrs } from "../attrs";
import { writeBlockAttrs } from "../flow-ops";

/**
 * Merge attrs into a block's existing attrs.
 *
 * Differs from `setBlockAttrs` (which REPLACES the bag): `mergeBlockAttrs`
 * preserves existing keys not present in `incoming`, overwrites keys
 * present in both, and removes keys whose incoming value is `undefined`
 * (per the `mergeAttrs` contract in `./attrs`).
 *
 * No-op short-circuit: when the merged attrs are equal to the block's
 * existing attrs we skip the Y.Map write entirely. `applyOperation`'s
 * no-op contract then returns the input `state` reference unchanged
 * (callers can use `result.state === state` as an O(1) "did anything
 * change?" guard). Without this short-circuit, `Y.Map.set("attrs", ...)`
 * would always produce a change record even when the new bag is
 * structurally identical.
 *
 * The attr registry bound to the doc supplies per-key custom equality to
 * `attrsEqual` (an interpreter's `equals` overrides the default `deepValueEqual`,
 * e.g. a `comment` attr whose `timestamp` must not count); none bound → structural
 * deep equality only.
 *
 * Throws if the block does not exist.
 */
export function mergeBlockAttrs(
  state: State,
  blockId: BlockId,
  incoming: ReadonlyAttrs,
): OperationResult {
  const resolved = resolveBlock(state, blockId);
  if (resolved === null) {
    throw new Error(`mergeBlockAttrs: block "${blockId}" not found`);
  }
  const { block } = resolved;
  const merged = mergeAttrs(block.attrs, incoming);
  return applyOperation(state, (doc) => {
    if (attrsEqual(block.attrs, merged, attrRegistryOf(doc))) {
      return;
    }
    writeBlockAttrs(doc, blockId, merged);
  });
}
