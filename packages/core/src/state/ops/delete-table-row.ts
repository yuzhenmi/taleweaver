import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation } from "../state";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { requireInTransaction } from "../yjs-doc";
import { planRemoveBlock, removeBlockInTx } from "./remove-block";
import type { RemoveBlockPlan } from "./remove-block";
import { setBlockAttrsInTx } from "./set-block-attrs";
import { headerRowAttrsAfterRowEdit } from "./table-header-rows";
import type { TableContext } from "../table-context";

/**
 * Pre-computed mutation plan for `deleteTableRowInTx`. A single `RemoveBlockPlan`
 * removes the caret's row (and its cell subtree); the table's `headerRowCount`
 * attr is re-derived when the delete shifts the header boundary (#487). All reads
 * happen pre-tx.
 */
export interface DeleteTableRowPlan {
  readonly tableId: BlockId;
  /** Removes the caret's row block + its cell subtree. */
  readonly rowPlan: RemoveBlockPlan;
  /** The table's new attrs bag when the delete shifts `headerRowCount` (#487), or
   *  `null` when unchanged (no `headerRowCount`, or a body row went). Written in the
   *  SAME tx as the row removal. */
  readonly headerAttrs: ReadonlyAttrs | null;
}

/**
 * Delete the caret's row (the row block + its cell subtree) on a well-formed
 * NO-SPAN table, as a single atomic transaction (one undo entry). When the table
 * carries a `headerRowCount` attr (repeating-header rows, #487), the count is
 * re-derived in the SAME transaction so the row removal and the header adjustment
 * revert together.
 *
 * Caller (the editor handler) must have already resolved `ctx` via
 * `resolveTableContext`, guarded on `ctx.ragged` (no-op on a degenerate ragged
 * table), routed a `ctx.spanned` table to the span-aware op (this op assumes a
 * well-formed no-span `!ctx.spanned` table — so `ctx.rowIndex` IS the grid row),
 * AND ensured this is NOT the last remaining row (a single-row table collapses to a
 * whole-table delete via `deleteTableWithReplacement`).
 *
 * MAIN-TREE ONLY. dirtyIds covers the removed row subtree + the table (its
 * first/last-child or a sibling-row pointer change, and/or its `headerRowCount`
 * attr write).
 */
export function deleteTableRow(state: State, ctx: TableContext): OperationResult {
  const plan = planDeleteTableRow(state, ctx);
  return applyOperation(state, (doc) => {
    deleteTableRowInTx(doc, plan);
  });
}

/** Build the plan: the caret row's `planRemoveBlock`, plus the re-derived
 *  `headerRowCount` attrs bag when the delete shifts the header boundary (#487).
 *  On a no-span table `ctx.rowIndex` IS the deleted grid row. */
export function planDeleteTableRow(state: State, ctx: TableContext): DeleteTableRowPlan {
  const rowPlan = planRemoveBlock(state, ctx.rowId);
  const headerAttrs = headerRowAttrsAfterRowEdit(state, ctx.tableId, "delete", ctx.rowIndex);
  return { tableId: ctx.tableId, rowPlan, headerAttrs };
}

/**
 * Pure Y.Doc-mutation primitive: removes the caret row's subtree and rewrites the
 * table's `headerRowCount` attr when present. MUST run inside an already-open
 * transaction.
 */
export function deleteTableRowInTx(doc: Y.Doc, plan: DeleteTableRowPlan): void {
  requireInTransaction(doc, "deleteTableRow");

  // #487: re-write the table's `headerRowCount` (same tx) when the delete shifted
  // it. The table block survives the delete; write before the row removal.
  if (plan.headerAttrs !== null) {
    setBlockAttrsInTx(doc, plan.tableId, plan.headerAttrs, "deleteTableRow");
  }

  removeBlockInTx(doc, plan.rowPlan);
}
