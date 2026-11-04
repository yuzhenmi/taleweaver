import * as Y from "yjs";
import type { InsertUnit, Plan, Write } from "../../plan";
import { COLS_KEY, COL_SPAN_KEY, WIDTH_KEY } from "../../storage/keys";
import { TABLE_COLUMN_CAP } from "../../storage/limits";
import { mapOf, newParagraphMark } from "../../storage/new-items";
import { newCellMark } from "../../storage/table-marks";
import type { CommandContext } from "../command-context";
import { plan } from "../helpers/build-plan";
import { insertAt, keysWrite } from "../helpers/writes";
import { attrKeys, keptSelection, markOf, markPoint, rowEndPoint, selectedCell, slotsOf } from "./table-at";

/**
 * T1: insert a column left / right of the selected cell (a merged cell: left / right of all its columns; GDocs), at
 * grid column j. A head straddling j grows by one column (once, in its own row). Every other row reaching j gets an
 * empty cell before its first cell at or right of j; a row ending before j pads virtually (no write). New cells copy
 * the `a:*` of their row's reference cell (the one at j for "left", left of j for "right"; Word); `cols` gets a copy
 * of the reference column's weight at j (Word). The caret stays. A no-op outside a table cell and at the column cap.
 */
export function insertColumn(ctx: CommandContext, side: "left" | "right"): Plan | null {
  const c = selectedCell(ctx);
  if (c === null || c.columnCount >= TABLE_COLUMN_CAP) return null;
  const { d, fs, form } = c;
  const j = side === "left" ? c.col : c.col + c.colSpan;
  const refCol = side === "left" ? j : j - 1;
  const writes: Write[] = [];
  for (let i = 0; i < form.rows.length; i++) {
    const row = form.rows[i];
    if (row === undefined) return null;
    const slots = slotsOf(row);
    const left = j > 0 ? slots[j - 1] : undefined;
    if (left !== undefined && left === slots[j]) {
      // Straddled: its head grows, in the head's own row (rows below are covered by it).
      const p = row.placed.find((x) => x.cellId === left);
      const m = p === undefined ? null : markOf(d, fs, left);
      if (p !== undefined && m !== null) writes.push(...keysWrite(m, { [COL_SPAN_KEY]: p.colSpan + 1 }));
      continue;
    }
    if (slots.length < j) continue; // ends before j: pads virtually
    const before = row.placed.find((x) => x.gridCol >= j);
    const at = before === undefined ? rowEndPoint(c, i) : markPoint(d, fs, before.cellId);
    if (at === null) return null;
    const ref = slots[refCol];
    const units: InsertUnit[] = [
      { embed: newCellMark(form.depth, attrKeys(ref === undefined ? null : markOf(d, fs, ref))), attrs: {} },
      { embed: newParagraphMark(), attrs: {} },
    ];
    writes.push(insertAt(at, units));
  }
  const cols = form.map.get(COLS_KEY);
  if (cols instanceof Y.Array && cols.length > 0 && j <= cols.length) {
    const e: unknown = cols.get(refCol);
    const w: unknown = e instanceof Y.Map ? e.get(WIDTH_KEY) : undefined;
    writes.push({ k: "cols", array: cols, index: j, delete: 0, insert: [mapOf(typeof w === "number" ? { [WIDTH_KEY]: w } : {})] });
  }
  return plan(d, writes, keptSelection(ctx, c, 0, side === "left" ? 1 : 0));
}
