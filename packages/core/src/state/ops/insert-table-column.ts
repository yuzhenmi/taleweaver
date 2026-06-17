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
import type { TableContext } from "../table-context";

/** Where the new column goes relative to the caret's column. */
export type ColumnPosition = "left" | "right";

/**
 * Pre-computed mutation plan for `insertTableColumnInTx`. All ids are allocated
 * once (outside any transaction); per-row neighbour cells are read from the
 * pre-mutation snapshot via the supplied `TableContext`.
 */
export interface InsertTableColumnPlan {
  readonly tableId: BlockId;
  /** Column index the new cells are inserted AT (0..colCount). */
  readonly targetCol: number;
  /** One entry per row, in document order: the new cell + its empty paragraph
   *  plus the existing neighbour cells it splices between. */
  readonly rows: readonly {
    readonly rowId: BlockId;
    readonly cellId: BlockId;
    readonly paragraphId: BlockId;
    readonly prevCellId: BlockId | null;
    readonly nextCellId: BlockId | null;
  }[];
  /** The table's new attrs bag (with spliced `columnWidths`), or null when the
   *  table uses auto-layout (no `columnWidths` attr → no attr change). */
  readonly newTableAttrs: ReadonlyAttrs | null;
}

/**
 * Insert a new table column (one empty cell per row) left or right of the
 * caret's column, as a single atomic transaction (one undo entry). When the
 * table has an explicit `columnWidths` attr, it is re-spliced in the SAME
 * transaction so the cells and the widths revert together on one undo.
 *
 * Caller (the editor handler) must have already resolved `ctx` via
 * `resolveTableContext` and guarded on `ctx.ragged` (no-op on a degenerate ragged
 * table) AND routed a `ctx.spanned` table to the span-aware op: this op assumes a
 * well-formed no-span (`!ctx.spanned`, `!ctx.ragged`) table.
 *
 * MAIN-TREE ONLY. dirtyIds covers the table (its `columnWidths` attr write
 * and/or a row's child-list change) plus every touched row + new cell.
 */
export function insertTableColumn(
  state: State,
  ctx: TableContext,
  position: ColumnPosition,
  allocator: IdAllocator,
): OperationResult {
  const plan = planInsertTableColumn(state, ctx, position, allocator);
  return applyOperation(state, (doc) => {
    insertTableColumnInTx(doc, plan);
  });
}

/** Build the plan from a resolved context. Allocates one cell + paragraph id per
 *  row, and computes the spliced `columnWidths` attrs bag when present. */
export function planInsertTableColumn(
  state: State,
  ctx: TableContext,
  position: ColumnPosition,
  allocator: IdAllocator,
): InsertTableColumnPlan {
  const targetCol = position === "left" ? ctx.colIndex : ctx.colIndex + 1;

  const rows = ctx.rowIds.map((rowId, r) => {
    const cells = ctx.cellIdsByRow[r];
    if (cells === undefined) {
      throw new Error(`insertTableColumn: row ${r} cells missing (unreachable)`);
    }
    // Non-ragged (hasSpans === false) → every row has the same column count, so
    // targetCol ∈ [0, colCount] indexes consistently across rows.
    const prevCellId = targetCol === 0 ? null : (cells[targetCol - 1] ?? null);
    const nextCellId = cells[targetCol] ?? null;
    return {
      rowId,
      cellId: allocator.allocate(),
      paragraphId: allocator.allocate(),
      prevCellId,
      nextCellId,
    };
  });

  // columnWidths lives in the table's block attrs. Present → splice + renormalize
  // (one new fraction at targetCol); absent → auto-layout, no attr change (M2/D3).
  const table = getBlock(state, ctx.tableId);
  const cw = table?.attrs.columnWidths;
  const newTableAttrs: ReadonlyAttrs | null =
    table !== null && isColumnWidths(cw)
      ? { ...table.attrs, columnWidths: spliceColumnWidth(cw, targetCol) }
      : null;

  return { tableId: ctx.tableId, targetCol, rows, newTableAttrs };
}

/**
 * Pure Y.Doc-mutation primitive: materializes one new cell (+ empty paragraph)
 * per row, splices each into its row's cell chain at `targetCol`, and rewrites
 * the table's `columnWidths` attr when present. MUST run inside an already-open
 * transaction.
 */
export function insertTableColumnInTx(doc: Y.Doc, plan: InsertTableColumnPlan): void {
  requireInTransaction(doc, "insertTableColumn");

  const blocksMap = getBlocksMap(doc);
  for (const r of plan.rows) {
    assertNoIdCollision(doc, r.cellId, "insertTableColumn");
    assertNoIdCollision(doc, r.paragraphId, "insertTableColumn");
  }

  for (const r of plan.rows) {
    blocksMap.set(
      r.cellId,
      buildYBlock({
        type: "table-cell",
        attrs: {},
        parentId: r.rowId,
        prevSiblingId: r.prevCellId,
        nextSiblingId: r.nextCellId,
        firstChildId: r.paragraphId,
        lastChildId: r.paragraphId,
        inlineContent: null,
      }),
    );
    blocksMap.set(
      r.paragraphId,
      buildYBlock({
        type: "paragraph",
        attrs: {},
        parentId: r.cellId,
        prevSiblingId: null,
        nextSiblingId: null,
        firstChildId: null,
        lastChildId: null,
        inlineContent: { items: [] },
      }),
    );

    // Splice into the row's cell chain (insertBlock boundary discipline: write
    // the row's first/lastChildId only at a boundary).
    if (r.prevCellId !== null) {
      getYBlock(doc, r.prevCellId, "insertTableColumn").set("nextSiblingId", r.cellId);
    }
    if (r.nextCellId !== null) {
      getYBlock(doc, r.nextCellId, "insertTableColumn").set("prevSiblingId", r.cellId);
    }
    if (r.prevCellId === null || r.nextCellId === null) {
      const yRow = getYBlock(doc, r.rowId, "insertTableColumn");
      if (r.prevCellId === null) yRow.set("firstChildId", r.cellId);
      if (r.nextCellId === null) yRow.set("lastChildId", r.cellId);
    }
  }

  if (plan.newTableAttrs !== null) {
    setBlockAttrsInTx(doc, plan.tableId, plan.newTableAttrs, "insertTableColumn");
  }
}
