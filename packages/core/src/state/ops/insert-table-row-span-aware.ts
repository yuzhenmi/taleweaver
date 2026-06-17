import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, getBlock } from "../state";
import type { BlockId, IdAllocator } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { getBlocksMap, getYBlock, requireInTransaction } from "../yjs-doc";
import { buildYBlock } from "../y-block";
import { assertNoIdCollision } from "../id-collision-check";
import { setBlockAttrsInTx } from "./set-block-attrs";
import { buildTableGrid } from "../table-context";
import type { TableContext } from "../table-context";
import type { RowPosition } from "./insert-table-row";
import { headerRowAttrsAfterRowEdit } from "./table-header-rows";

/**
 * Pre-computed mutation plan for `insertTableRowSpanAwareInTx`. Everything is read
 * from the PRE-mutation occupancy grid (the `computeReparentWrites` discipline).
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
  /** The table's new attrs bag when the insert shifts `headerRowCount` (#487), or
   *  `null` when unchanged. Written in the SAME tx as the row splice. */
  readonly headerAttrs: ReadonlyAttrs | null;
}

/**
 * Span-aware INSERT_TABLE_ROW (P15b / D5): insert a row above/below the caret's
 * cell on a well-formed SPANNED table, as one atomic transaction. A cell whose
 * vertical span CROSSES the insertion boundary grows its `rowSpan` by 1 (it now
 * covers the new row); new empty 1×1 cells are created only in the grid columns
 * NOT covered by such a crossing span. The grid column count is unchanged, so
 * `columnWidths` is untouched.
 *
 * Caller (the editor handler) resolves `ctx` and routes here only for a SPANNED,
 * non-ragged table (1×1 tables go through the byte-identical P15a `insertTableRow`).
 * NO-OP (same `state`) when the grid can't be built. MAIN-TREE ONLY.
 */
export function insertTableRowSpanAware(
  state: State,
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
  state: State,
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

  // #487: the new row's destination grid-row index is `gr` (the insertion
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

  const blocksMap = getBlocksMap(doc);
  assertNoIdCollision(doc, plan.newRowId, "insertTableRowSpanAware");
  for (const c of plan.newCells) {
    assertNoIdCollision(doc, c.cellId, "insertTableRowSpanAware");
    assertNoIdCollision(doc, c.paragraphId, "insertTableRowSpanAware");
  }

  for (const bump of plan.crossingBumps) {
    setBlockAttrsInTx(doc, bump.cellId, bump.newAttrs, "insertTableRowSpanAware");
  }

  const cells = plan.newCells;
  const lastCell = cells.length - 1;
  for (const [i, cell] of cells.entries()) {
    const { cellId, paragraphId } = cell;
    const prevCell = cells[i - 1];
    const nextCell = cells[i + 1];
    blocksMap.set(
      cellId,
      buildYBlock({
        type: "table-cell",
        attrs: {},
        parentId: plan.newRowId,
        prevSiblingId: i === 0 ? null : (prevCell?.cellId ?? null),
        nextSiblingId: i === lastCell ? null : (nextCell?.cellId ?? null),
        firstChildId: paragraphId,
        lastChildId: paragraphId,
        inlineContent: null,
      }),
    );
    blocksMap.set(
      paragraphId,
      buildYBlock({
        type: "paragraph",
        attrs: {},
        parentId: cellId,
        prevSiblingId: null,
        nextSiblingId: null,
        firstChildId: null,
        lastChildId: null,
        inlineContent: { items: [] },
      }),
    );
  }

  blocksMap.set(
    plan.newRowId,
    buildYBlock({
      type: "table-row",
      attrs: {},
      parentId: plan.tableId,
      prevSiblingId: plan.prevRowId,
      nextSiblingId: plan.nextRowId,
      firstChildId: cells[0]?.cellId ?? null,
      lastChildId: cells[lastCell]?.cellId ?? null,
      inlineContent: null,
    }),
  );

  if (plan.prevRowId !== null) {
    getYBlock(doc, plan.prevRowId, "insertTableRowSpanAware").set("nextSiblingId", plan.newRowId);
  }
  if (plan.nextRowId !== null) {
    getYBlock(doc, plan.nextRowId, "insertTableRowSpanAware").set("prevSiblingId", plan.newRowId);
  }
  if (plan.prevRowId === null || plan.nextRowId === null) {
    const yTable = getYBlock(doc, plan.tableId, "insertTableRowSpanAware");
    if (plan.prevRowId === null) yTable.set("firstChildId", plan.newRowId);
    if (plan.nextRowId === null) yTable.set("lastChildId", plan.newRowId);
  }

  // #487: re-write the table's `headerRowCount` (same tx) when the insert
  // shifted it. `null` when unchanged.
  if (plan.headerAttrs !== null) {
    setBlockAttrsInTx(doc, plan.tableId, plan.headerAttrs, "insertTableRowSpanAware");
  }
}
