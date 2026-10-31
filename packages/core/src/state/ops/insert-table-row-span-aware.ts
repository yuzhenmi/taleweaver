import type * as Y from "yjs";
import type { Document, OperationResult } from "../state";
import { applyOperation, getBlock } from "../state";
import type { BlockId, IdAllocator } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { requireInTransaction } from "../yjs-doc";
import { insertRowEntry, implicitSlots, createCell } from "../table-storage";
import { assertNoIdCollision } from "../id-collision-check";
import { setBlockAttrsInTx } from "./set-block-attrs";
import { buildTableGrid } from "../table-context";
import type { TableContext } from "../table-context";
import type { RowPosition } from "./insert-table-row";
import { headerRowAttrsAfterRowEdit } from "./table-header-rows";

/**
 * Pre-computed mutation plan for `insertTableRowSpanAwareInTx`. Everything is read
 * from the PRE-mutation occupancy grid.
 */
export interface InsertTableRowSpanAwarePlan {
  readonly tableId: BlockId;
  readonly newRowId: BlockId;
  /** The new row's previous / next sibling in the table's row chain. */
  readonly prevRowId: BlockId | null;
  readonly nextRowId: BlockId | null;
  /** New empty 1×1 cells for the grid columns NOT covered by a crossing rowSpan,
   *  in grid-column order. May be empty (a row fully covered by crossing spans). */
  readonly newCells: readonly { readonly cellId: BlockId; readonly paragraphId: BlockId }[];
  /** Cells whose vertical span crosses the insertion boundary — their `rowSpan`
   *  grows by 1 to cover the new row. `newAttrs` is the full REPLACE bag. */
  readonly crossingBumps: readonly { readonly cellId: BlockId; readonly newAttrs: ReadonlyAttrs }[];
  /** The table's new attrs bag when the insert shifts `headerRowCount`, or
   *  `null` when unchanged. Written in the SAME tx as the row splice. */
  readonly headerAttrs: ReadonlyAttrs | null;
}

/**
 * Span-aware INSERT_TABLE_ROW: insert a row above/below the caret's
 * cell on a well-formed SPANNED table, as one atomic transaction. A cell whose
 * vertical span CROSSES the insertion boundary grows its `rowSpan` by 1 (it now
 * covers the new row); new empty 1×1 cells are created only in the grid columns
 * NOT covered by such a crossing span. The grid column count is unchanged, so
 * `columnWidths` is untouched.
 *
 * Caller (the editor handler) resolves `ctx` and routes here only for a SPANNED,
 * non-ragged table (1×1 tables go through the byte-identical plain `insertTableRow`).
 * NO-OP (same `state`) when the grid can't be built. MAIN-TREE ONLY.
 */
export function insertTableRowSpanAware(
  state: Document,
  ctx: TableContext,
  position: RowPosition,
  allocator: IdAllocator,
): OperationResult {
  const plan = planInsertTableRowSpanAware(state, ctx, position, allocator);
  if (plan === null) return { state, dirtyIds: new Set<BlockId>() };
  return applyOperation(state, (doc) => {
    insertTableRowSpanAwareInTx(doc, plan);
  });
}

/**
 * Build the plan, or null when the grid can't be built. The insertion boundary is
 * computed from the caret cell's FULL grid extent so it never bisects a rowSpanning
 * caret cell: insert-above → its origin row; insert-below → just past its last row.
 */
export function planInsertTableRowSpanAware(
  state: Document,
  ctx: TableContext,
  position: RowPosition,
  allocator: IdAllocator,
): InsertTableRowSpanAwarePlan | null {
  const grid = buildTableGrid(state, ctx.tableId);
  if (grid === null) return null;
  const caret = grid.cells.find((c) => c.cellId === ctx.cellId);
  if (caret === undefined) return null;

  const rowCount = grid.occupancy.length;
  const gr = position === "above" ? caret.gridRow : caret.gridRow + caret.rowSpan;

  // For each column, a cell that owns BOTH the slot directly above and directly
  // below the insertion line crosses it → grow its rowSpan; otherwise a new cell
  // is needed there.
  const crossingIds = new Set<BlockId>();
  const newColumns: number[] = [];
  for (let c = 0; c < grid.columnCount; c++) {
    const above = gr - 1 >= 0 ? (grid.occupancy[gr - 1]?.[c] ?? null) : null;
    const below = gr < rowCount ? (grid.occupancy[gr]?.[c] ?? null) : null;
    if (above !== null && above === below) crossingIds.add(above);
    else newColumns.push(c);
  }

  const crossingBumps = [...crossingIds].map((cellId) => {
    const cell = grid.cells.find((c) => c.cellId === cellId);
    const block = getBlock(state, cellId);
    // Unreachable by construction: crossingIds come from the occupancy grid, which
    // was just built from these same blocks. Throw rather than silently default to
    // `{}` — setBlockAttrsInTx REPLACES, so a bare `{rowSpan}` would wipe colSpan etc.
    if (cell === undefined || block === null) {
      throw new Error(`insertTableRowSpanAware: crossing cell "${cellId}" not found in state`);
    }
    return { cellId, newAttrs: { ...block.attrs, rowSpan: cell.rowSpan + 1 } as ReadonlyAttrs };
  });

  const newCells = newColumns.map(() => ({
    cellId: allocator.allocate(),
    paragraphId: allocator.allocate(),
  }));

  const prevRowId = gr - 1 >= 0 ? (ctx.rowIds[gr - 1] ?? null) : null;
  const nextRowId = gr < rowCount ? (ctx.rowIds[gr] ?? null) : null;

  // The new row's destination grid-row index is `gr` (the insertion
  // boundary). Keep `headerRowCount` naming the leading block.
  const headerAttrs = headerRowAttrsAfterRowEdit(state, ctx.tableId, "insert", gr);

  return {
    tableId: ctx.tableId,
    newRowId: allocator.allocate(),
    prevRowId,
    nextRowId,
    newCells,
    crossingBumps,
    headerAttrs,
  };
}

/**
 * Pure Y.Doc-mutation primitive: bumps the crossing cells' rowSpan, materializes
 * the new row + its (possibly empty) set of new cells, and splices the row into
 * the table's row chain. MUST run inside an already-open transaction.
 */
export function insertTableRowSpanAwareInTx(doc: Y.Doc, plan: InsertTableRowSpanAwarePlan): void {
  requireInTransaction(doc, "insertTableRowSpanAware");
  assertNoIdCollision(doc, plan.newRowId, "insertTableRowSpanAware");
  for (const c of plan.newCells) {
    assertNoIdCollision(doc, c.cellId, "insertTableRowSpanAware");
    assertNoIdCollision(doc, c.paragraphId, "insertTableRowSpanAware");
  }
  // Spans are id ranges: a row inserted inside a vertical span is covered by it
  // automatically (the planner's crossing bumps need no write). Cells go into the
  // slots left uncovered, in column order.
  insertRowEntry(doc, plan.tableId, plan.newRowId, plan.prevRowId);
  implicitSlots(doc, plan.tableId, plan.newRowId).forEach((col, i) => {
    const c = plan.newCells[i];
    if (c !== undefined) createCell(doc, plan.newRowId, col, c.cellId, c.paragraphId);
  });
  if (plan.headerAttrs !== null) {
    setBlockAttrsInTx(doc, plan.tableId, plan.headerAttrs, "insertTableRowSpanAware");
  }
}
