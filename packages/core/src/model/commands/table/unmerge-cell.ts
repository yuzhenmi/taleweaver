import type { InsertUnit, Plan, Write } from "../../plan";
import { COL_SPAN_KEY, ROW_SPAN_KEY } from "../../storage/keys";
import { newParagraphMark } from "../../storage/new-items";
import type { Scalar } from "../../storage/scalar";
import { newCellMark } from "../../storage/table-marks";
import type { CommandContext } from "../command-context";
import { plan } from "../helpers/build-plan";
import { insertAt, keysWrite } from "../helpers/writes";
import { attrKeys, keptSelection, selectedCell, slotsOf } from "./table-at";
import { tableMarks } from "./table-mark-walk";

/**
 * T7: unmerge the selected cell (GDocs `unmergeTableCells`): its span keys go, and every slot it covered gets an empty
 * cell copying its `a:*` (Word / PM split), positionally: in its row right after it; in each row below before the
 * row's first own cell right of it, or at the row's end after empty cells padding a short row up to it (as deleteRow's
 * moved heads). The content stays in the head, and the selection stays. A no-op for a cell spanning one slot (clipped
 * spans), a virtual cell, or a selection outside a table cell.
 */
export function unmergeCell(ctx: CommandContext): Plan | null {
  const c = selectedCell(ctx);
  if (c === null || c.map === null || (c.rowSpan === 1 && c.colSpan === 1)) return null;
  const marks = tableMarks(c);
  if (marks === null) return null;
  const { form } = c;
  const cell = (keys: Record<string, Scalar>): InsertUnit[] => [
    { embed: newCellMark(form.depth, keys), attrs: {} },
    { embed: newParagraphMark(), attrs: {} },
  ];
  const keys = attrKeys(c.map);
  const writes: Write[] = keysWrite(c.map, { [ROW_SPAN_KEY]: undefined, [COL_SPAN_KEY]: undefined });
  for (let i = c.row; i < c.row + c.rowSpan; i++) {
    const row = form.rows[i];
    if (row === undefined) return null;
    const units: InsertUnit[] = [];
    // The head's row: right after it. A row below: before its first own cell right of it, else at its end.
    const next = i === c.row ? row.cells[row.cells.findIndex((x) => x.cellId === c.cellId) + 1] : row.placed.find((p) => p.gridCol > c.col);
    const at = next === undefined ? marks.rowEnd(i) : marks.point(next.cellId);
    if (i > c.row && next === undefined) {
      const slots = slotsOf(row);
      for (let s = 0; s < c.col; s++) if (slots[s] === undefined) units.push(...cell({}));
    }
    if (at === null) return null;
    for (let k = i === c.row ? 1 : 0; k < c.colSpan; k++) units.push(...cell(keys));
    writes.push(insertAt(at, units));
  }
  return plan(c.d, writes, keptSelection(ctx, c, 0, 0));
}
