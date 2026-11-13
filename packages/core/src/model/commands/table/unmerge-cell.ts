import type { InsertUnit, Plan, Write } from "../../plan";
import { COL_SPAN_KEY, ROW_SPAN_KEY } from "../../storage/keys";
import { newParagraphMark } from "../../storage/new-items";
import type { Scalar } from "../../storage/scalar";
import { newCellMark } from "../../storage/table-marks";
import type { CommandContext } from "../command-context";
import { plan } from "../helpers/build-plan";
import { insertAt, keysWrite } from "../helpers/writes";
import { selectedRect } from "./cell-rect";
import { attrKeys, keptSelection, slotsOf } from "./table-at";
import { tableMarks } from "./table-mark-walk";

/** A head to unmerge: its slot, its clipped spans, its `a:*`. */
interface Head {
  readonly id: string;
  readonly row: number;
  readonly col: number;
  readonly rowSpan: number;
  readonly colSpan: number;
  readonly keys: Record<string, Scalar>;
}

/**
 * T7: unmerge every cell of the selection's rectangle (GDocs `unmergeTableCells`): each one's span keys go, and every
 * slot it covered gets an empty cell copying its `a:*` (Word / PM split), positionally: in its row right after it; in
 * each row below before the row's first own cell right of it, or at the row's end after empty cells padding a short
 * row up to it (as deleteRow's moved heads). The content stays in the heads, and the selection stays. A no-op when no
 * cell there spans more than one slot (clipped spans), or for a selection outside a table cell.
 */
export function unmergeCell(ctx: CommandContext): Plan | null {
  const rect = selectedRect(ctx);
  if (rect === null) return null;
  const { c, box } = rect;
  const { form } = c;
  const R = form.rows.length;
  const marks = tableMarks(c);
  if (marks === null) return null;
  const writes: Write[] = [];
  const heads: Head[] = [];
  for (let i = box.r0; i <= box.r1; i++) {
    for (const p of form.rows[i]?.placed ?? []) {
      const rowSpan = Math.min(p.rowSpan, R - i);
      if (p.gridCol < box.c0 || p.gridCol > box.c1 || rowSpan * p.colSpan === 1) continue;
      const m = marks.map(p.cellId);
      if (m === null) return null;
      writes.push(...keysWrite(m, { [ROW_SPAN_KEY]: undefined, [COL_SPAN_KEY]: undefined }));
      heads.push({ id: p.cellId, row: i, col: p.gridCol, rowSpan, colSpan: p.colSpan, keys: attrKeys(m) });
    }
  }
  if (heads.length === 0) return null;
  const cell = (keys: Record<string, Scalar>): InsertUnit[] => [
    { embed: newCellMark(form.depth, keys), attrs: {} },
    { embed: newParagraphMark(), attrs: {} },
  ];
  heads.sort((a, b) => a.col - b.col);
  const last = Math.max(...heads.map((h) => h.row + h.rowSpan - 1));
  for (let i = box.r0; i <= last; i++) {
    const row = form.rows[i];
    if (row === undefined) return null;
    const slots = slotsOf(row);
    /** Free slots left of here are padded already (heads go left to right). */
    let padFrom = 0;
    for (const h of heads) {
      if (i < h.row || i >= h.row + h.rowSpan) continue;
      // Its row: right after it. A row below: before the row's first own cell right of it, else at its end.
      const next = i === h.row ? row.cells[row.cells.findIndex((x) => x.cellId === h.id) + 1] : row.placed.find((p) => p.gridCol > h.col);
      const at = next === undefined ? marks.rowEnd(i) : marks.point(next.cellId);
      if (at === null) return null;
      const units: InsertUnit[] = [];
      if (i > h.row && next === undefined) for (let s = padFrom; s < h.col; s++) if (slots[s] === undefined) units.push(...cell({}));
      padFrom = h.col + h.colSpan;
      for (let k = i === h.row ? 1 : 0; k < h.colSpan; k++) units.push(...cell(h.keys));
      writes.push(insertAt(at, units));
    }
  }
  return plan(c.d, writes, keptSelection(ctx, c, 0, 0));
}
