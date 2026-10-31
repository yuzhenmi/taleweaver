import type * as Y from "yjs";
import type { Document, OperationResult } from "../document";
import { applyOperation, getBlock } from "../document";
import type { BlockId, IdAllocator } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { requireInTransaction } from "../yjs-doc";
import { setCellSpan, implicitSlots, createCell } from "../table-storage";
import { getRegistry } from "../registry";
import { assertNoIdCollision } from "../id-collision-check";
import { setBlockAttrsInTx } from "./set-block-attrs";
import { buildTableGrid } from "../table-context";
import type { TableContext } from "../table-context";

/**
 * Pre-computed mutation plan for `splitCellInTx`. Everything is derived from the
 * PRE-mutation occupancy grid: the surviving cell's de-spanned attrs and,
 * per affected grid row, the run of brand-new 1×1 cells to splice in plus the
 * existing sibling cells they sit between.
 */
export interface SplitCellPlan {
  /** The cell being unmerged — its `rowSpan`/`colSpan` attrs are dropped. */
  readonly cellId: BlockId;
  /** `cellId`'s attrs with `rowSpan`/`colSpan` removed (REPLACE write). */
  readonly survivorAttrs: ReadonlyAttrs;
  /** One entry per grid row that gains new cells, in document order. */
  readonly rows: readonly {
    readonly rowId: BlockId;
    /** Existing sibling the new run is spliced AFTER (null → row head). */
    readonly prevCellId: BlockId | null;
    /** Existing sibling the new run is spliced BEFORE (null → row tail). */
    readonly nextCellId: BlockId | null;
    /** The new 1×1 cells (+ their empty paragraphs), in grid-column order. */
    readonly newCells: readonly { readonly cellId: BlockId; readonly paragraphId: BlockId }[];
  }[];
}

/**
 * Unmerge a merged (spanned) table cell into 1×1 cells, as a single atomic
 * transaction (one undo entry). The original cell keeps its content and becomes
 * the top-left 1×1 cell; the remaining `rowSpan*colSpan − 1` grid slots are
 * filled with new empty 1×1 cells. Caret is unchanged (the handler's concern).
 *
 * Caller (the editor handler) must have resolved `ctx` via `resolveTableContext`
 * and guarded the ragged case. This op is a NO-OP (returns the same `document`) when
 * the caret cell is not a real span — `planSplitCell` returns null.
 *
 * MAIN-TREE ONLY. The grid column count is unchanged (the rectangle's columns
 * already existed), so `columnWidths` is untouched.
 */
export function splitCell(
  document: Document,
  ctx: TableContext,
  allocator: IdAllocator,
): OperationResult {
  const plan = planSplitCell(document, ctx, allocator);
  if (plan === null) return { document, dirtyIds: new Set<BlockId>() };
  return applyOperation(document, (doc) => {
    splitCellInTx(doc, plan);
  });
}

/**
 * Build the split plan from a resolved context, or null when the caret cell is
 * not a real span (nothing to unmerge). All ids are allocated here (outside any
 * transaction) and all splice positions are read from the pre-mutation grid.
 *
 * Splice positions are computed from the cells ORIGINATING in each grid row
 * (`AssignedCell.gridRow === r`) — exactly the cells in that row's sibling chain.
 * A cell that merely spans down into row `r` originates in an earlier row, so it
 * is correctly excluded, and the new cells land relative to the row's own cells.
 */
export function planSplitCell(
  document: Document,
  ctx: TableContext,
  allocator: IdAllocator,
): SplitCellPlan | null {
  const grid = buildTableGrid(document, ctx.tableId);
  if (grid === null) return null;
  const target = grid.cells.find((c) => c.cellId === ctx.cellId);
  if (target === undefined) return null;
  if (target.rowSpan === 1 && target.colSpan === 1) return null; // not a span → no-op

  const r0 = target.gridRow;
  const c0 = target.gridCol;
  const lastRow = r0 + target.rowSpan - 1;
  const lastCol = c0 + target.colSpan - 1;

  const cell = getBlock(document, ctx.cellId);
  if (cell === null) return null;
  const survivorAttrs = dropSpanAttrs(cell.attrs);

  const rows: SplitCellPlan["rows"][number][] = [];
  for (let r = r0; r <= lastRow; r++) {
    // The origin row keeps the survivor at c0, so its new cells start at c0+1.
    const startCol = r === r0 ? c0 + 1 : c0;
    if (startCol > lastCol) continue; // origin row of a pure rowSpan (colSpan 1)

    const originating = grid.cells
      .filter((c) => c.gridRow === r)
      .sort((a, b) => a.gridCol - b.gridCol);

    // Nearest originating cell left of the insertion run (null → row head). For
    // the origin row this is the survivor itself (gridCol c0 < startCol).
    let prevCellId: BlockId | null = null;
    for (const c of originating) {
      if (c.gridCol < startCol) prevCellId = c.cellId;
    }
    // Nearest originating cell right of the run (null → row tail).
    let nextCellId: BlockId | null = null;
    for (const c of originating) {
      if (c.gridCol > lastCol) { nextCellId = c.cellId; break; }
    }

    const newCells: { cellId: BlockId; paragraphId: BlockId }[] = [];
    for (let col = startCol; col <= lastCol; col++) {
      newCells.push({ cellId: allocator.allocate(), paragraphId: allocator.allocate() });
    }
    const rowId = ctx.rowIds[r];
    if (rowId === undefined) {
      throw new Error(`splitCell: row id at grid row ${r} missing (unreachable)`);
    }
    rows.push({ rowId, prevCellId, nextCellId, newCells });
  }

  return { cellId: ctx.cellId, survivorAttrs, rows };
}

/** A copy of `attrs` without the `rowSpan`/`colSpan` keys. */
function dropSpanAttrs(attrs: ReadonlyAttrs): ReadonlyAttrs {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "rowSpan" || k === "colSpan") continue;
    next[k] = v;
  }
  return next;
}

/**
 * Pure Y.Doc-mutation primitive: drops the survivor's span attrs and materializes
 * each grid row's run of new empty 1×1 cells, splicing the run into the row's
 * cell chain between `prevCellId` and `nextCellId`. MUST run inside an already-open
 * transaction.
 */
export function splitCellInTx(doc: Y.Doc, plan: SplitCellPlan): void {
  requireInTransaction(doc, "splitCell");
  for (const row of plan.rows) {
    for (const nc of row.newCells) {
      assertNoIdCollision(doc, nc.cellId, "splitCell");
      assertNoIdCollision(doc, nc.paragraphId, "splitCell");
    }
  }
  // Unmerge = drop the span keys: every covered cell shows its PHYSICAL flow again
  // (nothing moves). Slots without a real cell get the planner's fresh cells.
  const reg = getRegistry(doc);
  const ce = reg.get(plan.cellId);
  const tableId = ce === undefined ? undefined : reg.get(String(ce.get("row")))?.get("table");
  setCellSpan(doc, plan.cellId, null, null);
  setBlockAttrsInTx(doc, plan.cellId, plan.survivorAttrs, "splitCell");
  if (typeof tableId !== "string") return;
  for (const row of plan.rows) {
    implicitSlots(doc, tableId, row.rowId).forEach((col, i) => {
      const nc = row.newCells[i];
      if (nc !== undefined) createCell(doc, row.rowId, col, nc.cellId, nc.paragraphId);
    });
  }
}
