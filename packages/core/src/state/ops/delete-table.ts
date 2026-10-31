import type { Document, OperationResult } from "../document";
import { applyOperation, getBlock } from "../document";
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
export function deleteTable(document: Document, tableId: BlockId): OperationResult {
  const table = getBlock(document, tableId);
  if (table === null) {
    throw new Error(`deleteTable: block "${tableId}" not found`);
  }
  if (table.parentId === null) {
    throw new Error(`deleteTable: "${tableId}" is the root (cannot delete)`);
  }
  const removePlan = planRemoveBlock(document, tableId);
  return applyOperation(document, (doc) => {
    removeBlockInTx(doc, removePlan);
  });
}
