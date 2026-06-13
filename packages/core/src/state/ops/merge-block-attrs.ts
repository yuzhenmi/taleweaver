import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { attrsEqual, mergeAttrs } from "../attrs";
import { getYBlock } from "../yjs-doc";
import { buildYAttrs } from "../y-block";
import type { AttrRegistry } from "../../cascade/attr-registry";

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
 * `registry` is consulted by `attrsEqual` for per-key custom equality (an
 * interpreter's `equals` overrides the default `deepValueEqual`); omitted →
 * structural deep equality only. Mirrors `setBlockAttrs`. Editor callers pass
 * `config.attrRegistry`.
 *
 * Throws if the block does not exist.
 */
export function mergeBlockAttrs(
  state: State,
  blockId: BlockId,
  incoming: ReadonlyAttrs,
  registry?: AttrRegistry,
): OperationResult {
  const resolved = resolveBlock(state, blockId);
  if (resolved === null) {
    throw new Error(`mergeBlockAttrs: block "${blockId}" not found`);
  }
  const { block, kind } = resolved;
  const merged = mergeAttrs(block.attrs, incoming);
  return applyOperation(state, (doc) => {
    if (attrsEqual(block.attrs, merged, registry)) {
      return;
    }
    const yBlock = getYBlock(doc, blockId, "mergeBlockAttrs", kind);
    yBlock.set("attrs", buildYAttrs(merged));
  });
}
