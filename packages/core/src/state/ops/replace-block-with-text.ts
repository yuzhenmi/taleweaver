import type { State, OperationResult } from "../state";
import { applyOperation } from "../state";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { planRemoveBlock, removeBlockInTx } from "./remove-block";
import { planInsertText, insertTextInTx } from "./insert-text";
import type { AttrRegistry } from "../../cascade/attr-registry";

/**
 * Replace a whole block with `text` inserted into a sibling text block — in ONE
 * transaction (one undo entry / one collab event). Used by image
 * OBJECT-SELECTION (#525): when an atomic-leaf object is selected and the user
 * types, the object block is removed AND the typed character lands in the
 * neighbouring text block, as a SINGLE undoable edit.
 *
 * `removeBlockId` — the block removed as a unit (an atomic-leaf object).
 * `insertAt` — the `{ blockId, offset }` the text is inserted at, in a DIFFERENT
 *   (sibling) block that survives the removal. The caller resolves which sibling
 *   (the following block's start, or the preceding block's end) and validates it
 *   is a text-bearing leaf.
 *
 * Composition mirrors `replaceRange` (#161): both `*InTx` sub-primitives run
 * inside the single `applyOperation` transaction. The insert plan is computed
 * from the PRE-mutation snapshot (the sibling block is untouched by the removal —
 * `removeBlock` only deletes the target subtree and relinks neighbours, it does
 * NOT rewrite the sibling's `inlineContent`), so the plan is valid when applied
 * after `removeBlockInTx`.
 *
 * MAIN-TREE atomic-leaf objects only (mirrors `removeBlock`); the insert target
 * is resolved by the caller via `resolveBlock`, so an insert into a body-tree
 * sibling routes correctly through `planInsertText`'s `kind`.
 *
 * Throws (via the sub-planners) if `removeBlockId` is the root / missing, or if
 * `insertAt` is not a valid text-leaf position. No-op identity is impossible
 * here: a removal always changes state.
 */
export function replaceBlockWithText(
  state: State,
  removeBlockId: BlockId,
  insertAt: { readonly blockId: BlockId; readonly offset: number },
  text: string,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): OperationResult {
  const removePlan = planRemoveBlock(state, removeBlockId);
  // The insert plan is computed against the pre-mutation snapshot. The insert
  // target is a SIBLING of the removed block, so the removal (which only deletes
  // the target's subtree + relinks neighbour sibling pointers) leaves the
  // target's `inlineContent` Y.Array identity intact — the plan's in-place /
  // full-replace decision stays valid post-removal.
  const insertPlan = planInsertText(
    state,
    { blockId: insertAt.blockId, offset: insertAt.offset },
    text,
    attrs,
    registry,
  );
  return applyOperation(state, (doc) => {
    removeBlockInTx(doc, removePlan);
    insertTextInTx(doc, insertPlan);
  });
}
