import type { State, OperationResult } from "../state";
import { applyOperation, getBlock } from "../state";
import type { BlockId } from "../block-id";
import { planRemoveBlock, removeBlockInTx } from "./remove-block";

/**
 * Remove a whole block object (a table, an image — object-selection delete) and
 * its subtree, in one transaction (one undo entry). Under invariant I (Word / Google
 * Docs: a paragraph follows every table) the paragraph after the
 * object always exists and survives, so the flow is never left empty and no
 * replacement paragraph is needed. Span-agnostic (deleting a whole table is always
 * safe). MAIN-TREE ONLY (mirrors `removeBlock`).
 */
export function deleteTable(state: State, tableId: BlockId): OperationResult {
  const table = getBlock(state, tableId);
  if (table === null) {
    throw new Error(`deleteTable: block "${tableId}" not found`);
  }
  if (table.parentId === null) {
    throw new Error(`deleteTable: "${tableId}" is the root (cannot delete)`);
  }
  const removePlan = planRemoveBlock(state, tableId);
  return applyOperation(state, (doc) => {
    removeBlockInTx(doc, removePlan);
  });
}
