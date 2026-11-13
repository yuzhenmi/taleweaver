/**
 * The table cell a row / column command acts on (N4), and reads of its table's stored form
 * (`TableForm`, N2) shared by those commands.
 */
import type * as Y from "yjs";
import type { BlockId } from "../../block";
import { peekBlock } from "../../document/blocks";
import type { Document, FlowState } from "../../document/types";
import { type TableForm, columnCountOf, nextMarkId, slotsOf } from "../../derive/table/table-form";
import type { Carry } from "../../../table-grid/assign-table-grid";
import { virtualCellId } from "../../ids";
import { edgeParagraphOf } from "../../position/block-object";
import { type ModelSelection, caretAt, isAllSelection, isCellSelection, isTextSelection } from "../../position/model-position";
import { mappedSelection } from "../helpers/build-plan";
import { type StoragePoint, paragraphLayout, terminatorOf } from "../../position/paragraph-layout";
import { pointBefore, pointOf } from "../../position/storage-points";
import { tableExtent } from "../../position/table-extent";
import { isWriteScalar } from "../../storage/scalar";
import type { Scalar } from "../../storage/scalar";
import type { CommandContext } from "../command-context";
import { containerKey, rangeOf } from "../helpers/at";

/** A cell of a table with its clipped grid rectangle. */
export interface CellAt {
  readonly d: Document;
  readonly fs: FlowState;
  readonly tableId: BlockId;
  readonly form: TableForm;
  readonly cellId: BlockId;
  /** Its `⟨c⟩`, or null for a virtual end cell. */
  readonly map: Y.Map<unknown> | null;
  readonly row: number;
  readonly col: number;
  readonly rowSpan: number;
  readonly colSpan: number;
  readonly columnCount: number;
}

/**
 * The cell the selection is in: a caret, a range inside one cell, or a cell's select-all (the innermost table's cell
 * when nested). Null for anything else (a body select-all, an object selection, a range across containers).
 */
export function selectedCell(ctx: CommandContext): CellAt | null {
  const sel = ctx.selection;
  const r = rangeOf(ctx);
  if (r === null) return null;
  const d = ctx.version;
  const cellId = containerKey(d, r.start.L);
  if (cellId === "" || containerKey(d, r.end.L) !== cellId) return null;
  if (isAllSelection(sel) && sel.container !== cellId) return null;
  return cellAt(d, r.start.L.fs, cellId);
}

/** Cell `cellId` (real or virtual) of a table of flow `fs`; null when it is no cell of a formed table there. */
export function cellAt(d: Document, fs: FlowState, cellId: BlockId): CellAt | null {
  const rowId = peekBlock(d, cellId)?.parentId ?? null;
  const tableId = rowId === null ? null : (peekBlock(d, rowId)?.parentId ?? null);
  const form = tableId === null ? undefined : fs.tables.get(tableId);
  const row = rowId === null || form === undefined ? undefined : form.rowIndex.get(rowId);
  if (tableId === null || form === undefined || row === undefined) return null;
  const R = form.rows.length;
  const columnCount = columnCountOf(form);
  const base = { d, fs, tableId, form, cellId, row, columnCount };
  const p = form.rows[row]?.placed.find((c) => c.cellId === cellId);
  if (p !== undefined) {
    const map = markOf(d, fs, cellId);
    return map === null ? null : { ...base, map, col: p.gridCol, colSpan: p.colSpan, rowSpan: Math.min(p.rowSpan, R - row) };
  }
  const next = nextMarkId(form, tableId, row);
  for (let col = 0; col < columnCount; col++) if (virtualCellId(next, col) === cellId) return { ...base, map: null, col, colSpan: 1, rowSpan: 1 };
  return null;
}

export { nextMarkId, slotsOf } from "../../derive/table/table-form";

/** The distinct heads of a carry, each with its rows left at that carry's row. */
export function headsIn(carry: Carry<BlockId>): { head: BlockId; rowsLeft: number }[] {
  const seen = new Map<BlockId, number>();
  for (const s of carry) if (s !== undefined && !seen.has(s.head)) seen.set(s.head, s.rowsLeft);
  return [...seen].map(([head, rowsLeft]) => ({ head, rowsLeft }));
}

/** The map of the table mark (or ¶) `id` of flow `fs`. */
export const markOf = (d: Document, fs: FlowState, id: BlockId): Y.Map<unknown> | null => terminatorOf(d, fs, id)?.token.map ?? null;

/** The storage point right before the mark `id` of flow `fs`. */
export function markPoint(d: Document, fs: FlowState, id: BlockId): StoragePoint | null {
  const t = terminatorOf(d, fs, id);
  return t === null ? null : pointOf(fs, t);
}

/** The point where row `i` ends: before the next row's `⟨r⟩`, the `⟧`, or (unclosed) the table's extent end. */
export function rowEndPoint(c: CellAt, i: number): StoragePoint | null {
  const next = c.form.rows[i + 1]?.id ?? c.form.closeId;
  if (next !== null) return markPoint(c.d, c.fs, next);
  const open = terminatorOf(c.d, c.fs, c.tableId);
  return open === null ? null : (tableExtent(c.fs, open)?.end ?? null);
}

/** The `a:*` keys of a mark's map (copied to the rows / cells a command makes from it). */
export function attrKeys(m: Y.Map<unknown> | null): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  m?.forEach((v, k) => {
    if (k.startsWith("a:") && isWriteScalar(v)) out[k] = v;
  });
  return out;
}

/** A span key's value to write: the key removed at 1 (absent = 1). */
export const spanValue = (n: number): number | undefined => (n > 1 ? n : undefined);

/** The first paragraph of the cell covering slot (`row`, `col`) of table `tableId` in `after` (its flow `holderId`). */
export function cellParagraphAt(after: Document, holderId: BlockId, tableId: BlockId, row: number, col: number): BlockId | null {
  const form = after.flows.get(holderId)?.tables.get(tableId);
  const r = form?.rows[row];
  if (form === undefined || r === undefined) return null;
  return edgeParagraphOf(after, slotsOf(r)[col] ?? virtualCellId(nextMarkId(form, tableId, row), col), 1);
}

/**
 * The selection after a row / column insert: kept while what it names still reads; for a virtual cell (whose id names
 * a slot), or one that no longer reads, a caret in the cell now at the selected cell's slot, `dRow` / `dCol` past it.
 */
export function keptSelection(ctx: CommandContext, c: CellAt, dRow: number, dCol: number): (after: Document) => ModelSelection {
  const sel = ctx.selection;
  if (isCellSelection(sel)) return (after) => mappedSelection(ctx.version, sel, after);
  return (after) => {
    const ids = isAllSelection(sel) ? [sel.container] : isTextSelection(sel) ? [sel.anchor.blockId, sel.focus.blockId] : [];
    // A virtual cell's id names a slot (`${nextMark}/fill<col>`), which may now be another cell: always re-found.
    if (c.map !== null && ids.length > 0 && ids.every((id) => peekBlock(after, id) !== undefined)) return sel;
    const p = cellParagraphAt(after, c.fs.holderId, c.tableId, c.row + dRow, c.col + dCol);
    return p === null ? sel : caretAt(p, 0);
  };
}

/** The start (`side` 1) or the end, before its ¶ (−1), of cell `cellId`'s first / last paragraph, through nested tables. */
export function edgePoint(d: Document, cellId: BlockId, side: 1 | -1): StoragePoint | null {
  const id = edgeParagraphOf(d, cellId, side);
  const L = id === null ? null : paragraphLayout(d, id);
  return L === null ? null : side > 0 ? L.head : pointBefore(L, L.length);
}
