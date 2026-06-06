import type { BlockId, State, OperationResult } from "../index";
import { mergeBlockAttrs } from "../index";

/**
 * Set or clear a list item's per-item counter override (Google Docs'
 * "restart numbering at N" / "continue previous numbering"). The numbering
 * engine consumes the `listCounterOverride` attr; a number restarts the
 * sequence at that value, `undefined` removes the override so the item resumes
 * the natural sequence.
 *
 * This is a normal block-attr edit (no dirty-union needed): `mergeBlockAttrs`
 * captures the item id through standard dirty tracking. Per the `mergeAttrs`
 * contract, an `undefined` incoming value DELETES the key rather than storing a
 * literal `undefined`, so passing `value === undefined` makes the attr absent.
 */
export function setListRestart(
  state: State,
  blockId: BlockId,
  value: number | undefined,
): OperationResult {
  return mergeBlockAttrs(state, blockId, { listCounterOverride: value });
}
