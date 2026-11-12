/** A pasted table's cells placed into grid slots (N7 step 5), as a table form places them. */
import type { FragmentCell, FragmentItem } from "./fragment";
import { TABLE_COLUMN_CAP, TABLE_DEPTH_CAP } from "../../storage/limits";
import { type Carry, EMPTY_CARRY, placeRow } from "../../../table-grid/assign-table-grid";

/** A fragment cell at its slot, its spans clipped to the fragment's rows. */
export interface PlacedCell {
  readonly cell: FragmentCell;
  readonly row: number;
  readonly col: number;
  readonly rowSpan: number;
  readonly colSpan: number;
}

/** A fragment table's grid: its rows (`R'`), its widest row's extent (`C'`), its cells row-major, its clean header count. */
export interface FragmentGrid {
  readonly rows: number;
  readonly cols: number;
  readonly cells: readonly PlacedCell[];
  /** The largest header count ≤ `n` whose lower boundary no span crosses (as `cleanHeaderCount`). */
  readonly header: (n: number) => number;
}

const span = (n: number | undefined): number => {
  const v = n ?? 1;
  if (!Number.isInteger(v) || v < 1) throw new Error("model: a pasted cell's span must be an integer ≥ 1");
  return v;
};

/**
 * Place `rows` of own cells as a table form does ({@link placeRow}: free slots left to right, a colSpan clipped at a
 * slot covered from above), rowSpans clipped to the fragment's rows. Throws on bad spans, no rows, or no cell.
 */
export function placeFragment(rows: readonly (readonly FragmentCell[])[]): FragmentGrid {
  const R = rows.length;
  if (R === 0) throw new Error("model: a pasted table needs a row");
  const cells: PlacedCell[] = [];
  const crossed: boolean[] = [];
  let carry: Carry = EMPTY_CARRY;
  let cols = 0;
  rows.forEach((row, i) => {
    crossed.push(carry.length > 0);
    const placed = placeRow(carry, row.map((cell, k) => ({ cellId: String(k), rowSpan: span(cell.rowSpan), colSpan: span(cell.colSpan) })));
    for (const p of placed.placed) {
      const cell = row[Number(p.cellId)];
      if (cell !== undefined) cells.push({ cell, row: i, col: p.gridCol, rowSpan: Math.min(p.rowSpan, R - i), colSpan: p.colSpan });
    }
    cols = Math.max(cols, placed.slots.length);
    carry = placed.carryOut;
  });
  if (cells.length === 0) throw new Error("model: a pasted table needs a cell");
  const header = (n: number): number => {
    let h = Math.max(0, Math.min(n, R));
    while (h > 0 && crossed[h] === true) h--;
    return h;
  };
  return { rows: R, cols, cells, header };
}

/** Every table in `items` (cells' content included) fits at `depth`: under the nesting cap, within the column cap. */
export function tablesFit(items: readonly FragmentItem[], depth: number): boolean {
  return items.every((i) => {
    if (i.k !== "table") return true;
    if (depth >= TABLE_DEPTH_CAP) return false;
    if (!("cells" in i)) return i.cols <= TABLE_COLUMN_CAP;
    return placeFragment(i.cells).cols <= TABLE_COLUMN_CAP && i.cells.every((r) => r.every((c) => tablesFit(c.items, depth + 1)));
  });
}
