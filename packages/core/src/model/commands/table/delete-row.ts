import { spanOf } from "../../derive/table/form-table";
import type { RowForm } from "../../derive/table/table-form";
import type { InsertUnit, Plan } from "../../plan";
import { caretAt } from "../../position/model-position";
import type { StoragePoint } from "../../position/paragraph-layout";
import { COL_SPAN_KEY, ROW_SPAN_KEY } from "../../storage/keys";
import { newParagraphMark } from "../../storage/new-items";
import type { Scalar } from "../../storage/scalar";
import { newCellMark } from "../../storage/table-marks";
import type { CommandContext } from "../command-context";
import { deleteBlockObject } from "../delete-block-object";
import { plan } from "../helpers/build-plan";
import { anchorUnits, copyUnits } from "../helpers/copy-units";
import { deleteBetween, insertAt, keysWrite } from "../helpers/writes";
import { selectedRect } from "./cell-rect";
import { type CellAt, attrKeys, cellParagraphAt, edgePoint, headsIn, slotsOf, spanValue } from "./table-at";
import { type TableMarks, tableMarks } from "./table-mark-walk";

/**
 * T2: delete the rows [a, b) of the selection's rectangle (a cell: the rows it spans; GDocs). A head from above crossing them shrinks by the rows it
 * covers there. A head anchored in them that reaches row b moves into row b at its slot (PM, Word): a new `⟨c⟩` with
 * its `a:*` and spans, then a copy of its content (G2), before row b's first cell right of it, or at row b's end
 * after empty cells padding a short row up to its slot. Every anchor of the range (a moved head's included) moves to
 * the deletion point, in order (GDocs): the start of row b's first real cell's first paragraph, or (b the end) the
 * end of row a − 1's last one. The caret goes
 * to the same grid column in row b, or in row a − 1. Every row → C10. A no-op outside a table cell.
 */
export function deleteRow(ctx: CommandContext): Plan | null {
  const rect = selectedRect(ctx);
  if (rect === null) return null;
  const { c, box } = rect;
  const { d, fs, form } = c;
  const R = form.rows.length;
  const a = box.r0;
  const b = box.r1 + 1;
  if (a === 0 && b >= R) return deleteBlockObject(ctx, c.tableId);
  const marks = tableMarks(c);
  const first = form.rows[a];
  const from = first === undefined ? null : (marks?.point(first.id) ?? null);
  const to = marks?.rowEnd(b - 1) ?? null;
  if (marks === null || first === undefined || from === null || to === null) return null;
  const writes = deleteBetween(fs, from, to);
  for (const { head, rowsLeft } of headsIn(first.carryIn)) {
    const m = marks.map(head);
    if (m === null) return null;
    const stored = spanOf(m.get(ROW_SPAN_KEY));
    const clipped = Math.min(stored, R - (a + rowsLeft - stored));
    writes.push(...keysWrite(m, { [ROW_SPAN_KEY]: spanValue(clipped - Math.min(rowsLeft, b - a)) }));
  }
  const next = form.rows[b];
  const heads = next === undefined ? [] : movedHeads(c, marks, a, b, next);
  if (heads === null) return null;
  // Every anchor of the range moves to the deletion point, in storage order (GDocs; pairs only shrink, as C9).
  const anchors = anchorUnits(fs, from, to);
  if (anchors.length > 0) {
    const target = next === undefined ? form.rows[a - 1]?.cells.at(-1) : next.placed[0];
    // ponytail: a row with no real cell to take them (concurrency only) keeps them at the deletion point.
    writes.push(insertAt((target === undefined ? null : edgePoint(d, target.cellId, next === undefined ? -1 : 1)) ?? from, anchors));
  }
  for (const h of heads) writes.push(insertAt(h.at, headUnits(c, h)));
  const sel = ctx.selection;
  return plan(d, writes, (after) => {
    for (let col = box.c0; col >= 0; col--) {
      const q = cellParagraphAt(after, fs.holderId, c.tableId, next === undefined ? a - 1 : a, col);
      if (q !== null) return caretAt(q, 0);
    }
    return sel;
  });
}

/** A head moved into row b. */
interface MovedHead {
  /** Where it goes. */
  readonly at: StoragePoint;
  /** Empty cells before it (a short row padded to its slot). */
  readonly pads: number;
  readonly keys: Record<string, Scalar>;
  /** Its content in storage: after its `⟨c⟩`, up to its row's next mark. */
  readonly start: StoragePoint;
  readonly stop: StoragePoint;
}

/** The heads anchored in rows [a, b) that reach row b (`next`), left to right. */
function movedHeads(c: CellAt, marks: TableMarks, a: number, b: number, next: RowForm): MovedHead[] | null {
  const R = c.form.rows.length;
  const slots = slotsOf(next);
  const placed = c.form.rows.slice(a, b).flatMap((row, k) => row.placed.map((p) => ({ row, i: a + k, p })));
  placed.sort((x, y) => x.p.gridCol - y.p.gridCol);
  const out: MovedHead[] = [];
  let padFrom = next.width;
  for (const { row, i, p } of placed) {
    const end = i + Math.min(p.rowSpan, R - i);
    if (end <= b) continue;
    const after = row.cells[row.cells.findIndex((x) => x.cellId === p.cellId) + 1];
    const mark = marks.point(p.cellId);
    const stop = after === undefined ? marks.rowEnd(i) : marks.point(after.cellId);
    const right = next.placed.find((x) => x.gridCol > p.gridCol);
    const at = right === undefined ? marks.rowEnd(b) : marks.point(right.cellId);
    if (mark === null || stop === null || at === null) return null;
    const start = { ...mark, index: mark.index + 1 };
    let pads = 0;
    if (right === undefined) {
      for (let s = padFrom; s < p.gridCol; s++) if (slots[s] === undefined) pads++;
      padFrom = p.gridCol + p.colSpan;
    }
    const keys = attrKeys(marks.map(p.cellId));
    const rs = spanValue(end - b);
    const cs = spanValue(p.colSpan);
    if (rs !== undefined) keys[ROW_SPAN_KEY] = rs;
    if (cs !== undefined) keys[COL_SPAN_KEY] = cs;
    out.push({ at, pads, keys, start, stop });
  }
  return out;
}

/** A moved head's units: its pads, its `⟨c⟩`, a copy of its content (no anchors: they go to the deletion point). */
function headUnits(c: CellAt, h: MovedHead): InsertUnit[] {
  const cell = (keys: Record<string, Scalar> = {}): InsertUnit => ({ embed: newCellMark(c.form.depth, keys), attrs: {} });
  const out: InsertUnit[] = [];
  for (let k = 0; k < h.pads; k++) out.push(cell(), { embed: newParagraphMark(), attrs: {} });
  out.push(cell(h.keys), ...copyUnits(c.fs, h.start, h.stop));
  return out;
}
