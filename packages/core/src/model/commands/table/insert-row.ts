import { spanOf } from "../../derive/table/form-table";
import { headerCountOf } from "../../derive/table/table-form";
import type { InsertUnit, Plan, Write } from "../../plan";
import { HEADER_KEY, ROW_SPAN_KEY } from "../../storage/keys";
import { newParagraphMark } from "../../storage/new-items";
import { newCellMark, newRowMark } from "../../storage/table-marks";
import type { CommandContext } from "../command-context";
import { plan } from "../helpers/build-plan";
import { insertAt, keysWrite } from "../helpers/writes";
import { selectedRect } from "./cell-rect";
import { attrKeys, headsIn, keptSelection, markOf, markPoint, rowEndPoint, slotsOf, spanValue } from "./table-at";

/**
 * T1: insert as many rows as the selection's rectangle has (one cell, merged or not: one; GDocs / Word "insert N rows") above /
 * below it. Each new row holds one empty cell per grid column no head crossing its line covers; each crossing head
 * grows by them. Its cells copy the `a:*` of the reference row's cell at their slot and its `⟨r⟩` the reference row's
 * (Word); they are header rows inside the header band. The selection stays. A no-op outside a table cell.
 */
export function insertRow(ctx: CommandContext, side: "above" | "below"): Plan | null {
  const rect = selectedRect(ctx);
  if (rect === null) return null;
  const { c, box } = rect;
  const { d, fs, form } = c;
  const R = form.rows.length;
  const n = rect.one ? 1 : box.r1 - box.r0 + 1;
  const p = side === "above" ? box.r0 : box.r1 + 1;
  const ref = form.rows[side === "above" ? p : p - 1];
  const next = form.rows[p];
  const at = next === undefined ? rowEndPoint(c, R - 1) : markPoint(d, fs, next.id);
  if (ref === undefined || at === null) return null;
  const writes: Write[] = [];
  // Heads covering line p from above: inside the table they cross it (+1 row); at its end their stored span reaches
  // past it, and gets its clipped value written, so the new row is not covered.
  const carry = next === undefined ? form.endCarry : next.carryIn;
  const covered = next === undefined ? new Set<number>() : new Set(carry.flatMap((s, col) => (s === undefined ? [] : [col])));
  for (const { head, rowsLeft } of headsIn(carry)) {
    const m = markOf(d, fs, head);
    if (m === null) return null;
    const stored = spanOf(m.get(ROW_SPAN_KEY));
    const clipped = Math.min(stored, R - (p + rowsLeft - stored));
    writes.push(...keysWrite(m, { [ROW_SPAN_KEY]: spanValue(next === undefined ? clipped : clipped + n) }));
  }
  const refRow = markOf(d, fs, ref.id);
  const refSlots = slotsOf(ref);
  const units: InsertUnit[] = [];
  for (let k = 0; k < n; k++) {
    units.push({ embed: newRowMark(form.depth, { ...attrKeys(refRow), ...(p < headerCountOf(form) ? { [HEADER_KEY]: true } : {}) }), attrs: {} });
    for (let col = 0; col < c.columnCount; col++) {
      if (covered.has(col)) continue;
      const owner = refSlots[col];
      units.push({ embed: newCellMark(form.depth, attrKeys(owner === undefined ? null : markOf(d, fs, owner))), attrs: {} }, { embed: newParagraphMark(), attrs: {} });
    }
  }
  writes.push(insertAt(at, units));
  return plan(d, writes, keptSelection(ctx, c, side === "above" ? n : 0, 0));
}
