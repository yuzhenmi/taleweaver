import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, getBlock } from "../state";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { requireInTransaction } from "../yjs-doc";
import { planRemoveBlock, removeBlockInTx } from "./remove-block";
import type { RemoveBlockPlan } from "./remove-block";
import { setBlockAttrsInTx } from "./set-block-attrs";
import { removeColumnWidth, isColumnWidths } from "../table-column-widths";
import type { TableContext } from "../table-context";

/**
 * Pre-computed mutation plan for `deleteTableColumnInTx`. One `RemoveBlockPlan`
 * per row removes the caret column's cell (and its subtree); the table's
 * `columnWidths` attr is re-removed when present. All reads happen pre-tx.
 */
export interface DeleteTableColumnPlan {
  readonly tableId: BlockId;
  /** One per row, in document order: removes the cell at the caret column. */
  readonly cellPlans: readonly RemoveBlockPlan[];
  /** The table's new attrs bag (with the column dropped from `columnWidths`), or
   *  null when the table uses auto-layout (no `columnWidths` attr). */
  readonly newTableAttrs: ReadonlyAttrs | null;
}

/**
 * Delete the caret's column (one cell per row, with its subtree) as a single
 * atomic transaction (one undo entry). When the table has an explicit
 * `columnWidths` attr, the dropped column is removed from it (`removeColumnWidth`)
 * and rewritten in the SAME transaction so cells and widths revert together.
 *
 * Caller (the editor handler) must have already resolved `ctx` via
 * `resolveTableContext`, guarded on `ctx.ragged` (no-op on a degenerate ragged
 * table), routed a `ctx.spanned` table to the span-aware op (this op assumes
 * `!ctx.spanned`), AND ensured this is NOT the last column — a single-column table
 * collapses to a whole-table delete via `deleteTableWithReplacement`. This op THROWS on a
 * 1-column table (caller contract).
 *
 * MAIN-TREE ONLY. dirtyIds covers the table (its `columnWidths` attr write and/or
 * a row's child-list change) plus every touched row + removed cell subtree.
 */
export function deleteTableColumn(state: State, ctx: TableContext): OperationResult {
  const plan = planDeleteTableColumn(state, ctx);
  return applyOperation(state, (doc) => {
    deleteTableColumnInTx(doc, plan);
  });
}

/** Build the plan: one `planRemoveBlock` per row for the caret-column cell, plus
 *  the re-removed `columnWidths` attrs bag when present. */
export function planDeleteTableColumn(state: State, ctx: TableContext): DeleteTableColumnPlan {
  const colIndex = ctx.colIndex;
  const caretRowCells = ctx.cellIdsByRow[ctx.rowIndex];
  if (caretRowCells === undefined) {
    throw new Error(`deleteTableColumn: caret row ${ctx.rowIndex} missing (unreachable)`);
  }
  const colCount = caretRowCells.length;
  // The single-column case collapses the whole table; the caller routes it to
  // deleteTableWithReplacement and must never reach this op.
  if (colCount <= 1) {
    throw new Error("deleteTableColumn: last column must collapse the whole table");
  }

  const cellPlans = ctx.rowIds.map((_rowId, r) => {
    // Non-ragged (hasSpans === false) → every row has the same column count, so
    // colIndex indexes a valid cell in every row.
    const rowCells = ctx.cellIdsByRow[r];
    const cellId = rowCells?.[colIndex];
    if (cellId === undefined) {
      throw new Error(`deleteTableColumn: cell at row ${r}, col ${colIndex} missing (unreachable)`);
    }
    return planRemoveBlock(state, cellId);
  });

  const table = getBlock(state, ctx.tableId);
  const cw = table?.attrs.columnWidths;
  const newTableAttrs: ReadonlyAttrs | null =
    table !== null && isColumnWidths(cw)
      ? { ...table.attrs, columnWidths: removeColumnWidth(cw, colIndex) }
      : null;

  return { tableId: ctx.tableId, cellPlans, newTableAttrs };
}

/**
 * Pure Y.Doc-mutation primitive: removes each row's caret-column cell subtree and
 * rewrites the table's `columnWidths` attr when present. MUST run inside an
 * already-open transaction.
 */
export function deleteTableColumnInTx(doc: Y.Doc, plan: DeleteTableColumnPlan): void {
  requireInTransaction(doc, "deleteTableColumn");

  // Each plan removes one cell in a distinct row (disjoint sibling chains), so
  // the N removals computed from the same pre-mutation snapshot do not interfere.
  for (const cellPlan of plan.cellPlans) {
    removeBlockInTx(doc, cellPlan);
  }

  if (plan.newTableAttrs !== null) {
    setBlockAttrsInTx(doc, plan.tableId, plan.newTableAttrs, "deleteTableColumn");
  }
}
