import type * as Y from "yjs";
import type { Document, OperationResult } from "../state";
import { applyOperation } from "../state";
import type { BlockId, IdAllocator } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { requireInTransaction } from "../yjs-doc";
import { insertRowEntry, implicitSlots, createCell } from "../table-storage";
import { assertNoIdCollision } from "../id-collision-check";
import { setBlockAttrsInTx } from "./set-block-attrs";
import type { TableContext } from "../table-context";
import { headerRowAttrsAfterRowEdit } from "./table-header-rows";

/** Where the new row goes relative to the caret's row. */
export type RowPosition = "above" | "below";

/**
 * Pre-computed mutation plan for `insertTableRowInTx`. All ids are allocated
 * once (outside any transaction) and the table-chain neighbours are read from
 * the pre-mutation snapshot via the supplied `TableContext`.
 */
export interface InsertTableRowPlan {
  readonly tableId: BlockId;
  readonly rowId: BlockId;
  /** The new row's previous / next sibling in the table's row chain. */
  readonly prevRowId: BlockId | null;
  readonly nextRowId: BlockId | null;
  /** One entry per column, in document order: the new cell + its empty paragraph. */
  readonly cells: readonly { readonly cellId: BlockId; readonly paragraphId: BlockId }[];
  /** The table's new attrs bag when the insert shifts `headerRowCount`, or
   *  `null` when the count is unchanged (no `headerRowCount`, or the insert is at/
   *  past the header boundary). Written in the SAME tx as the row splice. */
  readonly headerAttrs: ReadonlyAttrs | null;
}

/**
 * Insert a new table row (with one empty cell per column) above or below the
 * caret's row, as a single atomic transaction (one undo entry). The new row has
 * the same column count as the caret's row; each cell holds one empty-leaf
 * paragraph.
 *
 * Caller (the editor handler) must have already resolved `ctx` via
 * `resolveTableContext` and guarded on `ctx.ragged` (no-op on a degenerate ragged
 * table) AND routed a `ctx.spanned` table to the span-aware op: this op assumes a
 * well-formed no-span (`!ctx.spanned`, `!ctx.ragged`) table.
 *
 * MAIN-TREE ONLY (writes the main `blocks` map). dirtyIds covers the table (its
 * first/last-child or a row's sibling pointer changes) plus every new block.
 */
export function insertTableRow(
  state: Document,
  ctx: TableContext,
  position: RowPosition,
  allocator: IdAllocator,
): OperationResult & { readonly newRowId: BlockId } {
  const plan = planInsertTableRow(state, ctx, position, allocator);
  const result = applyOperation(state, (doc) => {
    insertTableRowInTx(doc, plan);
  });
  return { ...result, newRowId: plan.rowId };
}

/** Build the plan from a resolved context. Allocates row + per-column cell +
 *  paragraph ids once each, outside any transaction. `state` is read only to
 *  compute the `headerRowCount` adjustment. Throws when the caret row has
 *  no cells (degenerate). */
export function planInsertTableRow(
  state: Document,
  ctx: TableContext,
  position: RowPosition,
  allocator: IdAllocator,
): InsertTableRowPlan {
  const caretRowCells = ctx.cellIdsByRow[ctx.rowIndex];
  if (caretRowCells === undefined) {
    throw new Error(`insertTableRow: caret row ${ctx.rowIndex} missing (unreachable)`);
  }
  const colCount = caretRowCells.length;
  // resolveTableContext only returns a context with colIndex >= 0 (≥ 1 cell), so
  // this is unreachable in practice — guard anyway since the op indexes cells[0].
  if (colCount === 0) {
    throw new Error("insertTableRow: caret row has no cells (degenerate table)");
  }
  const prevRowId =
    position === "above"
      ? (ctx.rowIds[ctx.rowIndex - 1] ?? null)
      : ctx.rowId;
  const nextRowId =
    position === "above"
      ? ctx.rowId
      : (ctx.rowIds[ctx.rowIndex + 1] ?? null);

  const rowId = allocator.allocate();
  const cells = Array.from({ length: colCount }, () => ({
    cellId: allocator.allocate(),
    paragraphId: allocator.allocate(),
  }));

  // Keep `headerRowCount` naming the leading block. The new row's
  // destination grid-row index is `rowIndex` (insert-above) or `rowIndex + 1`
  // (insert-below). This op runs only on a NON-spanned table (the handler routes
  // spanned tables to the span-aware op), so `ctx.rowIndex` IS the grid row.
  const destIndex = position === "above" ? ctx.rowIndex : ctx.rowIndex + 1;
  const headerAttrs = headerRowAttrsAfterRowEdit(state, ctx.tableId, "insert", destIndex);

  return { tableId: ctx.tableId, rowId, prevRowId, nextRowId, cells, headerAttrs };
}

/**
 * Pure Y.Doc-mutation primitive: materializes the row subtree and splices it
 * into the table's row chain. MUST run inside an already-open transaction.
 */
export function insertTableRowInTx(doc: Y.Doc, plan: InsertTableRowPlan): void {
  requireInTransaction(doc, "insertTableRow");
  assertNoIdCollision(doc, plan.rowId, "insertTableRow");
  for (const c of plan.cells) {
    assertNoIdCollision(doc, c.cellId, "insertTableRow");
    assertNoIdCollision(doc, c.paragraphId, "insertTableRow");
  }
  insertRowEntry(doc, plan.tableId, plan.rowId, plan.prevRowId);
  // One cell per uncovered column, in column order.
  implicitSlots(doc, plan.tableId, plan.rowId).forEach((col, i) => {
    const c = plan.cells[i];
    if (c !== undefined) createCell(doc, plan.rowId, col, c.cellId, c.paragraphId);
  });
  if (plan.headerAttrs !== null) {
    setBlockAttrsInTx(doc, plan.tableId, plan.headerAttrs, "insertTableRow");
  }
}
