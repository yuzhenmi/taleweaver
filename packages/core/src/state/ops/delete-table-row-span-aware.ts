import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, getBlock } from "../state";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { getBlocksMap, getEmbedContentsMap, getYBlock, requireInTransaction } from "../yjs-doc";
import { setBlockAttrsInTx } from "./set-block-attrs";
import { planRemoveBlock } from "./remove-block";
import { buildTableGrid } from "../table-context";
import type { TableContext } from "../table-context";
import { headerRowAttrsAfterRowEdit } from "./table-header-rows";

/**
 * Pre-computed mutation plan for `deleteTableRowSpanAwareInTx`. Everything is read
 * from the PRE-mutation occupancy grid + tree (the `computeReparentWrites` discipline).
 */
export interface DeleteTableRowSpanAwarePlan {
  readonly tableId: BlockId;
  readonly deletedRowId: BlockId;
  /** The deleted row's prev/next sibling in the table's row chain. */
  readonly prevRowId: BlockId | null;
  readonly nextRowId: BlockId | null;
  readonly removingFirstRow: boolean;
  readonly removingLastRow: boolean;
  /** Every main-tree id to delete: the row block + the removed (1×1) cells' subtrees. */
  readonly blockIdsToDelete: ReadonlySet<BlockId>;
  /** Embed-content bodies anchored only in the deleted cells (cascade). */
  readonly embedContentIdsToDelete: ReadonlySet<BlockId>;
  /** Cells covering the deleted row from above → `rowSpan -= 1`. */
  readonly coveringBumps: readonly { readonly cellId: BlockId; readonly newAttrs: ReadonlyAttrs }[];
  /** Cells ORIGINATING in the deleted row with `rowSpan > 1` → re-home one row down
   *  (`parentId` ← the next row, `rowSpan -= 1`; content kept). */
  readonly rehomed: readonly { readonly cellId: BlockId; readonly newAttrs: ReadonlyAttrs }[];
  /** The next row's final cell chain after the re-homed cells join it (grid-column
   *  order), or null when nothing re-homes. */
  readonly reHomeRow: { readonly rowId: BlockId; readonly cellIds: readonly BlockId[] } | null;
  /** The table's new attrs bag when the delete shifts `headerRowCount` (#487), or
   *  `null` when unchanged. Written in the SAME tx as the row removal. */
  readonly headerAttrs: ReadonlyAttrs | null;
}

/**
 * Span-aware DELETE_TABLE_ROW (P15b / D5): delete the caret cell's grid row on a
 * well-formed SPANNED table, as one atomic transaction. A cell COVERING the row
 * from above shrinks its `rowSpan` by 1; a cell ORIGINATING in the row with
 * `rowSpan > 1` re-homes one row down (keeps its content, `rowSpan -= 1`); a plain
 * 1×1 cell is removed (subtree + embed cascade). The now-empty row block is removed.
 *
 * Caller routes here only for a SPANNED, non-ragged table with MORE THAN ONE grid
 * row (the last-row case collapses the whole table via `deleteTableWithReplacement`,
 * handled by the editor handler as in P15a). NO-OP (same `state`) when the grid
 * can't be built or there is only one row. Caret-after is the handler's concern.
 * MAIN-TREE ONLY. Column count unchanged → `columnWidths` untouched.
 */
export function deleteTableRowSpanAware(state: State, ctx: TableContext): OperationResult {
  const plan = planDeleteTableRowSpanAware(state, ctx);
  if (plan === null) return { state, dirtyIds: new Set<BlockId>() };
  return applyOperation(state, (doc) => {
    deleteTableRowSpanAwareInTx(doc, plan);
  });
}

/** Build the plan, or null when the grid can't be built or the table has ≤1 grid row. */
export function planDeleteTableRowSpanAware(state: State, ctx: TableContext): DeleteTableRowSpanAwarePlan | null {
  const grid = buildTableGrid(state, ctx.tableId);
  if (grid === null) return null;
  const caret = grid.cells.find((c) => c.cellId === ctx.cellId);
  if (caret === undefined) return null;

  const rowCount = grid.occupancy.length;
  if (rowCount <= 1) return null; // last row → whole-table collapse (handler's job)
  const gr = caret.gridRow;

  const deletedRowId = ctx.rowIds[gr];
  if (deletedRowId === undefined) return null;
  const deletedRow = getBlock(state, deletedRowId);
  if (deletedRow === null) return null;

  const coveringBumps: { cellId: BlockId; newAttrs: ReadonlyAttrs }[] = [];
  const rehomed: { cellId: BlockId; newAttrs: ReadonlyAttrs }[] = [];
  const removedCells: BlockId[] = []; // 1×1 cells originating in the deleted row
  for (const c of grid.cells) {
    if (c.gridRow < gr && c.gridRow + c.rowSpan - 1 >= gr) {
      coveringBumps.push({ cellId: c.cellId, newAttrs: withRowSpan(state, c.cellId, c.rowSpan - 1) });
    } else if (c.gridRow === gr) {
      if (c.rowSpan > 1) rehomed.push({ cellId: c.cellId, newAttrs: withRowSpan(state, c.cellId, c.rowSpan - 1) });
      else removedCells.push(c.cellId);
    }
  }

  // Deletion set: the row block + every removed cell's subtree (+ its embed cascade).
  const blockIdsToDelete = new Set<BlockId>([deletedRowId]);
  const embedContentIdsToDelete = new Set<BlockId>();
  for (const cellId of removedCells) {
    const p = planRemoveBlock(state, cellId);
    for (const id of p.subtreeIds) blockIdsToDelete.add(id);
    for (const id of p.embedContentIds) embedContentIdsToDelete.add(id);
  }

  // Re-home target = the next row; its final chain = its own cells + the re-homed
  // cells, in grid-column order. (rowSpan>1 at gr implies gr is not the last row,
  // so reHomeRowId exists whenever `rehomed` is non-empty.)
  let reHomeRow: { rowId: BlockId; cellIds: BlockId[] } | null = null;
  if (rehomed.length > 0) {
    const reHomeRowId = ctx.rowIds[gr + 1];
    if (reHomeRowId === undefined) return null; // unreachable by the span argument
    const rehomedIds = new Set<BlockId>(rehomed.map((r) => r.cellId));
    const merged = grid.cells
      .filter((c) => c.gridRow === gr + 1 || rehomedIds.has(c.cellId))
      .sort((a, b) => a.gridCol - b.gridCol)
      .map((c) => c.cellId);
    reHomeRow = { rowId: reHomeRowId, cellIds: merged };
  }

  const table = getBlock(state, ctx.tableId);
  // #487: the deleted grid row is `gr`. Keep `headerRowCount` naming the leading
  // block (delete at r < count → count-1; deleting the last header row → 0).
  const headerAttrs = headerRowAttrsAfterRowEdit(state, ctx.tableId, "delete", gr);
  return {
    tableId: ctx.tableId,
    deletedRowId,
    prevRowId: deletedRow.prevSiblingId,
    nextRowId: deletedRow.nextSiblingId,
    removingFirstRow: table?.firstChildId === deletedRowId,
    removingLastRow: table?.lastChildId === deletedRowId,
    blockIdsToDelete,
    embedContentIdsToDelete,
    coveringBumps,
    rehomed,
    reHomeRow,
    headerAttrs,
  };
}

/** `attrs` of `cellId` with `rowSpan` set to `n` (key dropped when n ≤ 1). */
function withRowSpan(state: State, cellId: BlockId, n: number): ReadonlyAttrs {
  const block = getBlock(state, cellId);
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(block?.attrs ?? {})) {
    if (k === "rowSpan") continue;
    next[k] = v;
  }
  if (n > 1) next.rowSpan = n;
  return next;
}

/**
 * Pure Y.Doc-mutation primitive: shrinks covering cells, re-homes the originating
 * spans onto the next row (re-chaining it), splices the deleted row out of the
 * table chain, and deletes the row block + removed cells' subtrees (+ embeds). MUST
 * run inside an already-open transaction.
 */
export function deleteTableRowSpanAwareInTx(doc: Y.Doc, plan: DeleteTableRowSpanAwarePlan): void {
  requireInTransaction(doc, "deleteTableRowSpanAware");
  const blocksMap = getBlocksMap(doc);

  for (const bump of plan.coveringBumps) {
    setBlockAttrsInTx(doc, bump.cellId, bump.newAttrs, "deleteTableRowSpanAware");
  }

  // Re-home: drop a row of span + reparent onto the next row.
  for (const rh of plan.rehomed) {
    setBlockAttrsInTx(doc, rh.cellId, rh.newAttrs, "deleteTableRowSpanAware");
    if (plan.reHomeRow !== null) {
      getYBlock(doc, rh.cellId, "deleteTableRowSpanAware").set("parentId", plan.reHomeRow.rowId);
    }
  }
  if (plan.reHomeRow !== null) {
    const { rowId, cellIds } = plan.reHomeRow;
    for (const [i, cellId] of cellIds.entries()) {
      const yCell = getYBlock(doc, cellId, "deleteTableRowSpanAware");
      yCell.set("prevSiblingId", i === 0 ? null : (cellIds[i - 1] ?? null));
      yCell.set("nextSiblingId", i === cellIds.length - 1 ? null : (cellIds[i + 1] ?? null));
    }
    const yRow = getYBlock(doc, rowId, "deleteTableRowSpanAware");
    yRow.set("firstChildId", cellIds[0] ?? null);
    yRow.set("lastChildId", cellIds[cellIds.length - 1] ?? null);
  }

  // Splice the deleted row out of the table's row chain.
  if (plan.prevRowId !== null) {
    getYBlock(doc, plan.prevRowId, "deleteTableRowSpanAware").set("nextSiblingId", plan.nextRowId);
  }
  if (plan.nextRowId !== null) {
    getYBlock(doc, plan.nextRowId, "deleteTableRowSpanAware").set("prevSiblingId", plan.prevRowId);
  }
  if (plan.removingFirstRow || plan.removingLastRow) {
    const yTable = getYBlock(doc, plan.tableId, "deleteTableRowSpanAware");
    if (plan.removingFirstRow) yTable.set("firstChildId", plan.nextRowId);
    if (plan.removingLastRow) yTable.set("lastChildId", plan.prevRowId);
  }

  // #487: re-write the table's `headerRowCount` (same tx) when the delete shifted
  // it. The table block survives the delete; write before the deletion loop.
  if (plan.headerAttrs !== null) {
    setBlockAttrsInTx(doc, plan.tableId, plan.headerAttrs, "deleteTableRowSpanAware");
  }

  // Delete embed bodies first, then the row block + removed cells' subtrees.
  if (plan.embedContentIdsToDelete.size > 0) {
    const yEmbeds = getEmbedContentsMap(doc);
    for (const id of plan.embedContentIdsToDelete) yEmbeds.delete(id);
  }
  for (const id of plan.blockIdsToDelete) blocksMap.delete(id);
}
