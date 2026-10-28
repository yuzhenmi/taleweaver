import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, getBlock } from "../state";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { requireInTransaction } from "../yjs-doc";
import { deleteColumnEntry, liveColumns } from "../table-storage";
import { removeBlockStorage } from "../flow-ops";
import { setBlockAttrsInTx } from "./set-block-attrs";
import { planRemoveBlock } from "./remove-block";
import { removeColumnWidth, isColumnWidths } from "../table-column-widths";
import { buildTableGrid } from "../table-context";
import type { TableContext } from "../table-context";

/**
 * Pre-computed mutation plan for `deleteTableColumnSpanAwareInTx`. Everything is read
 * from the PRE-mutation occupancy grid + tree.
 */
export interface DeleteTableColumnSpanAwarePlan {
  readonly tableId: BlockId;
  /** Cells whose horizontal span COVERS the deleted column from the left, OR
   *  ORIGINATE at it with `colSpan > 1` → `colSpan -= 1`. Both keep their tree
   *  position (deleting a column never reparents a cell — unlike row delete's
   *  re-home); the origin column simply renumbers down by one. */
  readonly spanBumps: readonly { readonly cellId: BlockId; readonly newAttrs: ReadonlyAttrs }[];
  /** The plain 1×1 cells ORIGINATING in the deleted column, each spliced out of its
   *  OWN row (the cells live in distinct rows, so the splices never interfere). */
  readonly removedCells: readonly {
    readonly rowId: BlockId;
    readonly cellId: BlockId;
    readonly prevSiblingId: BlockId | null;
    readonly nextSiblingId: BlockId | null;
    readonly removingFirstChild: boolean;
    readonly removingLastChild: boolean;
  }[];
  /** Every main-tree id to delete: the removed (1×1) cells' subtrees. */
  readonly blockIdsToDelete: ReadonlySet<BlockId>;
  /** Embed-content bodies anchored only in the removed cells (cascade). */
  readonly embedContentIdsToDelete: ReadonlySet<BlockId>;
  /** Table attrs with `columnWidths` shrunk (a removed column lowers the count), or
   *  null for an auto-layout table (no `columnWidths` attr → no change). */
  readonly newTableAttrs: ReadonlyAttrs | null;
  /** Grid column index being deleted. */
  readonly targetCol: number;
}

/**
 * Span-aware DELETE_TABLE_COLUMN: delete the caret cell's grid column on
 * a well-formed SPANNED table, as one atomic transaction. A cell whose horizontal
 * span COVERS the column from the left shrinks its `colSpan` by 1; a cell
 * ORIGINATING in the column with `colSpan > 1` likewise shrinks (its origin column
 * renumbers down by one, staying in place — a column delete never reparents a cell);
 * a plain 1×1 cell is removed (subtree + embed cascade). When the table carries an
 * explicit `columnWidths` attr it is re-shrunk in the SAME transaction (one undo
 * reverts cells + widths).
 *
 * Caller routes here only for a SPANNED, non-ragged table with MORE THAN ONE grid
 * column (the last-column case collapses the whole table via
 * `deleteTable`, handled by the editor handler). NO-OP
 * (same `state`) when the grid can't be built or there is only one column.
 * Caret-after is the handler's concern. MAIN-TREE ONLY.
 */
export function deleteTableColumnSpanAware(state: State, ctx: TableContext): OperationResult {
  const plan = planDeleteTableColumnSpanAware(state, ctx);
  if (plan === null) return { state, dirtyIds: new Set<BlockId>() };
  return applyOperation(state, (doc) => {
    deleteTableColumnSpanAwareInTx(doc, plan);
  });
}

/** Build the plan, or null when the grid can't be built or the table has ≤1 grid column. */
export function planDeleteTableColumnSpanAware(state: State, ctx: TableContext): DeleteTableColumnSpanAwarePlan | null {
  const grid = buildTableGrid(state, ctx.tableId);
  if (grid === null) return null;
  const caret = grid.cells.find((c) => c.cellId === ctx.cellId);
  if (caret === undefined) return null;

  const columnCount = grid.columnCount;
  if (columnCount <= 1) return null; // last column → whole-table collapse (handler's job)
  const gc = caret.gridCol;

  const spanBumps: { cellId: BlockId; newAttrs: ReadonlyAttrs }[] = [];
  const removedCells: DeleteTableColumnSpanAwarePlan["removedCells"][number][] = [];
  const blockIdsToDelete = new Set<BlockId>();
  const embedContentIdsToDelete = new Set<BlockId>();

  for (const c of grid.cells) {
    if (c.gridCol < gc && c.gridCol + c.colSpan - 1 >= gc) {
      spanBumps.push({ cellId: c.cellId, newAttrs: withColSpan(state, c.cellId, c.colSpan - 1) });
    } else if (c.gridCol === gc) {
      if (c.colSpan > 1) {
        spanBumps.push({ cellId: c.cellId, newAttrs: withColSpan(state, c.cellId, c.colSpan - 1) });
      } else {
        const p = planRemoveBlock(state, c.cellId); // throws on an orphan cell (no row parent)
        removedCells.push({
          rowId: p.parentId,
          cellId: c.cellId,
          prevSiblingId: p.prevSiblingId,
          nextSiblingId: p.nextSiblingId,
          removingFirstChild: p.removingFirstChild,
          removingLastChild: p.removingLastChild,
        });
        for (const id of p.subtreeIds) blockIdsToDelete.add(id);
        for (const id of p.embedContentIds) embedContentIdsToDelete.add(id);
      }
    }
  }

  // columnWidths lives on the table; a removed column lowers the count → drop index gc.
  const table = getBlock(state, ctx.tableId);
  const cw = table?.attrs.columnWidths;
  const newTableAttrs: ReadonlyAttrs | null =
    table !== null && isColumnWidths(cw)
      ? { ...table.attrs, columnWidths: removeColumnWidth(cw, gc) }
      : null;

  return {
    tableId: ctx.tableId,
    spanBumps,
    removedCells,
    blockIdsToDelete,
    embedContentIdsToDelete,
    newTableAttrs,
    targetCol: gc,
  };
}

/** `attrs` of `cellId` with `colSpan` set to `n` (key dropped when n ≤ 1). */
function withColSpan(state: State, cellId: BlockId, n: number): ReadonlyAttrs {
  const block = getBlock(state, cellId);
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(block?.attrs ?? {})) {
    if (k === "colSpan") continue;
    next[k] = v;
  }
  if (n > 1) next.colSpan = n;
  return next;
}

/**
 * Pure Y.Doc-mutation primitive: shrinks covering / originating spans, splices the
 * removed 1×1 cells out of their rows, deletes their subtrees (+ embeds), and
 * re-shrinks the table's `columnWidths`. MUST run inside an already-open transaction.
 */
export function deleteTableColumnSpanAwareInTx(doc: Y.Doc, plan: DeleteTableColumnSpanAwarePlan): void {
  requireInTransaction(doc, "deleteTableColumnSpanAware");
  // Grid model: spans crossing the column shrink by themselves (id ranges); an
  // anchor in it whose span continues moves to the next column.
  for (const id of plan.embedContentIdsToDelete) removeBlockStorage(doc, id);
  const colId = liveColumns(doc, plan.tableId)[plan.targetCol];
  if (colId !== undefined) deleteColumnEntry(doc, plan.tableId, colId);
  if (plan.newTableAttrs !== null) {
    setBlockAttrsInTx(doc, plan.tableId, plan.newTableAttrs, "deleteTableColumnSpanAware");
  }
}
