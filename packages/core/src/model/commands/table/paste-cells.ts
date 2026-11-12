/**
 * Paste of table cells (N7 step 5; PM `insertCells`, Word "Overwrite Cells", GDocs): a table fragment overwrites the
 * selection's table from its rectangle's top-left slot, at the fragment's size (no tiling). The table grows (rows at
 * the end, columns at the right), cells crossing the pasted rectangle's edges are isolated ({@link fateOf}), and each
 * row is rewritten from its final grid ({@link rowSequence}). One plan; the pasted rectangle is selected.
 */
import * as Y from "yjs";
import type { BlockId } from "../../block";
import type { Document } from "../../document/types";
import { virtualCellId } from "../../ids";
import type { InsertUnit, Plan, Write } from "../../plan";
import type { ModelSelection } from "../../position/model-position";
import type { StoragePoint } from "../../position/paragraph-layout";
import { COLS_KEY, COL_SPAN_KEY, ROW_SPAN_KEY, WIDTH_KEY } from "../../storage/keys";
import { TABLE_COLUMN_CAP } from "../../storage/limits";
import { mapOf, newParagraphMark } from "../../storage/new-items";
import type { Scalar } from "../../storage/scalar";
import { newCellMark, newRowMark } from "../../storage/table-marks";
import type { CommandContext } from "../command-context";
import { plan } from "../helpers/build-plan";
import { type FragmentTable, cellUnits, placeable } from "../helpers/fragment";
import { placeFragment, tablesFit } from "../helpers/fragment-table";
import { deleteBetween, insertAt, keysWrite } from "../helpers/writes";
import { type Box, selectedRect } from "./cell-rect";
import { type FinalCell, type Rect, fateOf, ownersOf, rowSequence } from "./paste-grid";
import { attrKeys, nextMarkId, slotsOf, spanValue } from "./table-at";
import { tableMarks } from "./table-mark-walk";

/** A new cell's units, given its final slots. */
type Make = (x: Rect) => InsertUnit[];

const spansOf = (x: Rect): Record<string, Scalar> => ({ ...(x.rs > 1 ? { [ROW_SPAN_KEY]: x.rs } : {}), ...(x.cs > 1 ? { [COL_SPAN_KEY]: x.cs } : {}) });

/** `t` over the selection's table (a caret / range in a cell, or a cell selection); null outside a table cell, past the caps. */
export function pasteCells(ctx: CommandContext, t: FragmentTable): Plan | null {
  const rect = selectedRect(ctx);
  if (rect === null) return null;
  const { c } = rect;
  const { d, fs, form } = c;
  const g = placeFragment(t.cells);
  const R = form.rows.length;
  const C = c.columnCount;
  const b: Box = { r0: rect.box.r0, r1: rect.box.r0 + g.rows - 1, c0: rect.box.c0, c1: rect.box.c0 + g.cols - 1 };
  const R2 = Math.max(R, b.r1 + 1);
  const C2 = Math.max(C, b.c1 + 1);
  const depth = form.depth;
  // The cells' content goes into this table's cells: one level deeper than its marks.
  if (C2 > TABLE_COLUMN_CAP || !g.cells.every((p) => placeable(p.cell.items, "cell") && tablesFit(p.cell.items, depth + 1))) return null;
  const marks = tableMarks(c);
  if (marks === null) return null;
  const emptyCell =
    (keys: Record<string, Scalar>): Make =>
    (x) => [
      { embed: newCellMark(depth, { ...keys, ...spansOf(x) }), attrs: {} },
      { embed: newParagraphMark(), attrs: {} },
    ];
  const cells: FinalCell<Make>[] = [];
  const deleted = new Set<BlockId>();
  const writes: Write[] = [];
  for (let i = 0; i < R; i++) {
    const row = form.rows[i];
    if (row === undefined) return null;
    for (const p of row.placed) {
      const x: Rect = { r: i, c: p.gridCol, rs: Math.min(p.rowSpan, R - i), cs: p.colSpan };
      const m = marks.map(p.cellId);
      if (m === null) return null;
      const { fate, bands } = fateOf(x, b);
      for (const band of bands) cells.push({ rect: band, make: emptyCell(attrKeys(m)) });
      if ("deleted" in fate) {
        deleted.add(p.cellId);
        continue;
      }
      const k = fate.kept;
      cells.push({ rect: k, id: p.cellId });
      // Spans written when the cell is cut, when its stored span would read differently once slots near it change
      // (a colSpan clipped by a carry, in a row whose carries change), or when rows are appended past its stored rowSpan's clip.
      const requested = row.cells.find((x) => x.cellId === p.cellId)?.colSpan ?? 1;
      const cut = k.rs !== x.rs || k.cs !== x.cs;
      const near = i >= b.r0 && i <= b.r1 + 1 && requested !== k.cs;
      const grows = R2 > R && p.rowSpan !== k.rs;
      if (cut || near || grows) writes.push(...keysWrite(m, { [ROW_SPAN_KEY]: spanValue(k.rs), [COL_SPAN_KEY]: spanValue(k.cs) }));
    }
  }
  for (const p of g.cells) cells.push({ rect: { r: b.r0 + p.row, c: b.c0 + p.col, rs: p.rowSpan, cs: p.colSpan }, make: (x) => cellUnits(ctx, p.cell, x.rs, x.cs, depth) });
  const owner = ownersOf(cells, R2, C2);
  const pad = emptyCell({});
  const unitsOf = (fs: readonly FinalCell<Make>[]): InsertUnit[] => fs.flatMap((f) => ("make" in f ? f.make(f.rect) : []));
  for (let i = 0; i < R; i++) {
    const row = form.rows[i];
    const end = marks.rowEnd(i);
    if (row === undefined || end === null) return null;
    // A row's lead (F2, concurrency only) is slot 0's cell's content: overwritten with it.
    if (b.c0 === 0 && i >= b.r0 && i <= b.r1 && row.outside) {
      const first = row.cells[0];
      const to = first === undefined ? end : marks.point(first.cellId);
      const from = after(marks.point(row.id));
      if (to === null || from === null) return null;
      writes.push(...deleteBetween(fs, from, to));
      const open = after(marks.point(c.tableId));
      const r0 = marks.point(row.id);
      if (i === 0 && open !== null && r0 !== null) writes.push(...deleteBetween(fs, open, r0));
    }
    const seq = rowSequence(owner, cells, i, pad);
    let k = 0;
    let from: StoragePoint | null = null;
    const gap = (until: StoragePoint, news: readonly FinalCell<Make>[]): void => {
      if (from !== null) writes.push(...deleteBetween(fs, from, until));
      from = null;
      const us = unitsOf(news);
      if (us.length > 0) writes.push(insertAt(until, us));
    };
    for (const p of row.placed) {
      const at = marks.point(p.cellId);
      if (at === null) return null;
      if (deleted.has(p.cellId)) {
        from ??= at;
        continue;
      }
      const news: FinalCell<Make>[] = [];
      for (let f = seq[k]; f !== undefined && !("id" in f && f.id === p.cellId); f = seq[++k]) news.push(f);
      k++;
      gap(at, news);
    }
    gap(end, seq.slice(k));
  }
  // Appended rows: after the last row's own cells (inserts at one index go in plan order).
  const last = form.rows[R - 1];
  const tail = marks.rowEnd(R - 1);
  if (R2 > R && (last === undefined || tail === null)) return null;
  const appended: InsertUnit[] = [];
  for (let i = R; i < R2; i++) appended.push({ embed: newRowMark(depth, attrKeys(last?.map ?? null)), attrs: {} }, ...unitsOf(rowSequence(owner, cells, i, pad)));
  if (appended.length > 0 && tail !== null) writes.push(insertAt(tail, appended));
  // Columns past the right edge copy the last column's weight (insertColumn's rule).
  const cols = form.map.get(COLS_KEY);
  if (C2 > C && cols instanceof Y.Array && cols.length === C && C > 0) {
    const e: unknown = cols.get(C - 1);
    const w: unknown = e instanceof Y.Map ? e.get(WIDTH_KEY) : undefined;
    writes.push({ k: "cols", array: cols, index: C, delete: 0, insert: Array.from({ length: C2 - C }, () => mapOf(typeof w === "number" ? { [WIDTH_KEY]: w } : {})) });
  }
  const sel = ctx.selection;
  return plan(d, writes, (v) => pastedCells(v, fs.holderId, c.tableId, b) ?? sel);
}

/** The point right after a mark (null stays null). */
const after = (p: StoragePoint | null): StoragePoint | null => (p === null ? null : { ...p, index: p.index + 1 });

/** The cell selection of the pasted rectangle `b` in version `v`. */
function pastedCells(v: Document, holderId: BlockId, tableId: BlockId, b: Box): ModelSelection | null {
  const form = v.flows.get(holderId)?.tables.get(tableId);
  if (form === undefined) return null;
  const at = (r: number, col: number): BlockId | null => {
    const row = form.rows[r];
    return row === undefined ? null : (slotsOf(row)[col] ?? virtualCellId(nextMarkId(form, tableId, r), col));
  };
  const anchor = at(b.r0, b.c0);
  const head = at(b.r1, b.c1);
  return anchor === null || head === null ? null : { kind: "cells", anchor, head };
}
