import * as Y from "yjs";
import type { InsertUnit, Plan, Write } from "../../plan";
import { COLS_KEY, COL_SPAN_KEY, WIDTH_KEY } from "../../storage/keys";
import { TABLE_COLUMN_CAP } from "../../storage/limits";
import { mapOf, newParagraphMark } from "../../storage/new-items";
import { newCellMark } from "../../storage/table-marks";
import type { CommandContext } from "../command-context";
import { plan } from "../helpers/build-plan";
import { insertAt, keysWrite } from "../helpers/writes";
import { selectedRect } from "./cell-rect";
import { attrKeys, keptSelection, slotsOf } from "./table-at";
import { tableMarks } from "./table-mark-walk";

/**
 * T1: insert as many columns as the selection's rectangle has (one cell, merged or not: one; GDocs / Word "insert N columns")
 * left / right of it, at grid column j. A head straddling j grows by them (once, in its own row). Every other row
 * reaching j gets empty cells before its first cell at or right of j; a row ending before j pads virtually (no write).
 * New cells copy the `a:*` of their row's reference cell (the one at j for "left", left of j for "right"; Word); `cols`
 * gets copies of the reference column's weight at j (Word). The selection stays. A no-op outside a table cell and past
 * the column cap.
 */
export function insertColumn(ctx: CommandContext, side: "left" | "right"): Plan | null {
  const rect = selectedRect(ctx);
  if (rect === null) return null;
  const { c, box } = rect;
  const n = rect.one ? 1 : box.c1 - box.c0 + 1;
  if (c.columnCount + n > TABLE_COLUMN_CAP) return null;
  const marks = tableMarks(c);
  if (marks === null) return null;
  const { d, form } = c;
  const j = side === "left" ? box.c0 : box.c1 + 1;
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
      const m = p === undefined ? null : marks.map(left);
      if (p !== undefined && m !== null) writes.push(...keysWrite(m, { [COL_SPAN_KEY]: p.colSpan + n }));
      continue;
    }
    if (slots.length < j) continue; // ends before j: pads virtually
    const before = row.placed.find((x) => x.gridCol >= j);
    const at = before === undefined ? marks.rowEnd(i) : marks.point(before.cellId);
    if (at === null) return null;
    const ref = slots[refCol];
    const units: InsertUnit[] = [];
    for (let k = 0; k < n; k++) units.push({ embed: newCellMark(form.depth, attrKeys(ref === undefined ? null : marks.map(ref))), attrs: {} }, { embed: newParagraphMark(), attrs: {} });
    writes.push(insertAt(at, units));
  }
  const cols = form.map.get(COLS_KEY);
  if (cols instanceof Y.Array && cols.length > 0 && j <= cols.length) {
    const e: unknown = cols.get(refCol);
    const w: unknown = e instanceof Y.Map ? e.get(WIDTH_KEY) : undefined;
    writes.push({ k: "cols", array: cols, index: j, delete: 0, insert: Array.from({ length: n }, () => mapOf(typeof w === "number" ? { [WIDTH_KEY]: w } : {})) });
  }
  return plan(d, writes, keptSelection(ctx, c, 0, side === "left" ? n : 0));
}
