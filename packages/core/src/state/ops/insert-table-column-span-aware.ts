import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, getBlock } from "../state";
import type { BlockId, IdAllocator } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { getBlocksMap, getYBlock, requireInTransaction } from "../yjs-doc";
import { buildYBlock } from "../y-block";
import { assertNoIdCollision } from "../id-collision-check";
import { setBlockAttrsInTx } from "./set-block-attrs";
import { spliceColumnWidth, isColumnWidths } from "../table-column-widths";
import { buildTableGrid } from "../table-context";
import type { TableContext } from "../table-context";
import type { ColumnPosition } from "./insert-table-column";

/**
 * Pre-computed mutation plan for `insertTableColumnSpanAwareInTx`. Everything is
 * read from the PRE-mutation occupancy grid (the `computeReparentWrites` discipline).
 */
export interface InsertTableColumnSpanAwarePlan {
  readonly tableId: BlockId;
  /** New empty 1×1 cells for the grid ROWS not covered by a crossing colSpan, each
   *  spliced into its row at the correct sibling position. */
  readonly newCells: readonly {
    readonly rowId: BlockId;
    readonly cellId: BlockId;
    readonly paragraphId: BlockId;
    readonly prevCellId: BlockId | null;
    readonly nextCellId: BlockId | null;
  }[];
  /** Cells whose horizontal span crosses the insertion boundary — `colSpan += 1`. */
  readonly crossingBumps: readonly { readonly cellId: BlockId; readonly newAttrs: ReadonlyAttrs }[];
  /** Table attrs with `columnWidths` spliced (a new column raises the count), or null
   *  for an auto-layout table (no `columnWidths` attr → no change). */
  readonly newTableAttrs: ReadonlyAttrs | null;
}

/**
 * Span-aware INSERT_TABLE_COLUMN (P15b / D5): insert a column left/right of the
 * caret's cell on a well-formed SPANNED table, as one atomic transaction. A cell
 * whose horizontal span CROSSES the insertion boundary grows its `colSpan` by 1
 * (now covering the new column); new empty 1×1 cells are created only in the grid
 * ROWS NOT covered by such a crossing span, each spliced into its row. When the
 * table carries an explicit `columnWidths` attr it is re-spliced in the SAME
 * transaction (one undo reverts cells + widths).
 *
 * Caller routes here only for a SPANNED, non-ragged table (1×1 tables use the
 * byte-identical P15a `insertTableColumn`). NO-OP (same `state`) when the grid
 * can't be built. MAIN-TREE ONLY.
 */
export function insertTableColumnSpanAware(
  state: State,
  ctx: TableContext,
  position: ColumnPosition,
  allocator: IdAllocator,
): OperationResult {
  const plan = planInsertTableColumnSpanAware(state, ctx, position, allocator);
  if (plan === null) return { state, dirtyIds: new Set<BlockId>() };
  return applyOperation(state, (doc) => {
    insertTableColumnSpanAwareInTx(doc, plan);
  });
}

/**
 * Build the plan, or null when the grid can't be built. The insertion boundary is
 * computed from the caret cell's FULL grid extent so it never bisects a colSpanning
 * caret cell: left → its origin column; right → just past its last column. Per-row
 * splice positions use the cells ORIGINATING in each row (a down-/right-spanning
 * neighbour from another row is excluded), mirroring `split-cell`.
 */
export function planInsertTableColumnSpanAware(
  state: State,
  ctx: TableContext,
  position: ColumnPosition,
  allocator: IdAllocator,
): InsertTableColumnSpanAwarePlan | null {
  const grid = buildTableGrid(state, ctx.tableId);
  if (grid === null) return null;
  const caret = grid.cells.find((c) => c.cellId === ctx.cellId);
  if (caret === undefined) return null;

  const rowCount = grid.occupancy.length;
  const gc = position === "left" ? caret.gridCol : caret.gridCol + caret.colSpan;

  // Per row: a cell owning BOTH the slot directly left and directly right of the
  // insertion line crosses it → grow its colSpan; otherwise that row needs a new cell.
  const crossingIds = new Set<BlockId>();
  const uncoveredRows: number[] = [];
  for (let r = 0; r < rowCount; r++) {
    const left = gc - 1 >= 0 ? (grid.occupancy[r]?.[gc - 1] ?? null) : null;
    const right = gc < grid.columnCount ? (grid.occupancy[r]?.[gc] ?? null) : null;
    if (left !== null && left === right) crossingIds.add(left);
    else uncoveredRows.push(r);
  }

  const crossingBumps = [...crossingIds].map((cellId) => {
    const cell = grid.cells.find((c) => c.cellId === cellId);
    const block = getBlock(state, cellId);
    if (cell === undefined || block === null) {
      throw new Error(`insertTableColumnSpanAware: crossing cell "${cellId}" not found in state`);
    }
    return { cellId, newAttrs: { ...block.attrs, colSpan: cell.colSpan + 1 } as ReadonlyAttrs };
  });

  const newCells = uncoveredRows.map((r) => {
    const originating = grid.cells
      .filter((c) => c.gridRow === r)
      .sort((a, b) => a.gridCol - b.gridCol);
    let prevCellId: BlockId | null = null;
    for (const c of originating) {
      if (c.gridCol < gc) prevCellId = c.cellId;
    }
    let nextCellId: BlockId | null = null;
    for (const c of originating) {
      if (c.gridCol >= gc) { nextCellId = c.cellId; break; }
    }
    const rowId = ctx.rowIds[r];
    if (rowId === undefined) {
      throw new Error(`insertTableColumnSpanAware: row id at grid row ${r} missing (unreachable)`);
    }
    return {
      rowId,
      cellId: allocator.allocate(),
      paragraphId: allocator.allocate(),
      prevCellId,
      nextCellId,
    };
  });

  // columnWidths lives on the table; a new column raises the count → splice at gc.
  const table = getBlock(state, ctx.tableId);
  const cw = table?.attrs.columnWidths;
  const newTableAttrs: ReadonlyAttrs | null =
    table !== null && isColumnWidths(cw)
      ? { ...table.attrs, columnWidths: spliceColumnWidth(cw, gc) }
      : null;

  return { tableId: ctx.tableId, newCells, crossingBumps, newTableAttrs };
}

/**
 * Pure Y.Doc-mutation primitive: bumps the crossing cells' colSpan, materializes
 * one new cell per uncovered row (spliced into the row chain), and re-splices the
 * table's `columnWidths`. MUST run inside an already-open transaction.
 */
export function insertTableColumnSpanAwareInTx(doc: Y.Doc, plan: InsertTableColumnSpanAwarePlan): void {
  requireInTransaction(doc, "insertTableColumnSpanAware");

  const blocksMap = getBlocksMap(doc);
  for (const nc of plan.newCells) {
    assertNoIdCollision(doc, nc.cellId, "insertTableColumnSpanAware");
    assertNoIdCollision(doc, nc.paragraphId, "insertTableColumnSpanAware");
  }

  for (const bump of plan.crossingBumps) {
    setBlockAttrsInTx(doc, bump.cellId, bump.newAttrs, "insertTableColumnSpanAware");
  }

  for (const nc of plan.newCells) {
    blocksMap.set(
      nc.cellId,
      buildYBlock({
        type: "table-cell",
        attrs: {},
        parentId: nc.rowId,
        prevSiblingId: nc.prevCellId,
        nextSiblingId: nc.nextCellId,
        firstChildId: nc.paragraphId,
        lastChildId: nc.paragraphId,
        inlineContent: null,
      }),
    );
    blocksMap.set(
      nc.paragraphId,
      buildYBlock({
        type: "paragraph",
        attrs: {},
        parentId: nc.cellId,
        prevSiblingId: null,
        nextSiblingId: null,
        firstChildId: null,
        lastChildId: null,
        inlineContent: { items: [] },
      }),
    );

    if (nc.prevCellId !== null) {
      getYBlock(doc, nc.prevCellId, "insertTableColumnSpanAware").set("nextSiblingId", nc.cellId);
    }
    if (nc.nextCellId !== null) {
      getYBlock(doc, nc.nextCellId, "insertTableColumnSpanAware").set("prevSiblingId", nc.cellId);
    }
    if (nc.prevCellId === null || nc.nextCellId === null) {
      const yRow = getYBlock(doc, nc.rowId, "insertTableColumnSpanAware");
      if (nc.prevCellId === null) yRow.set("firstChildId", nc.cellId);
      if (nc.nextCellId === null) yRow.set("lastChildId", nc.cellId);
    }
  }

  if (plan.newTableAttrs !== null) {
    setBlockAttrsInTx(doc, plan.tableId, plan.newTableAttrs, "insertTableColumnSpanAware");
  }
}
