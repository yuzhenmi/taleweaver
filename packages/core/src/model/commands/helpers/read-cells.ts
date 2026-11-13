import type { CellRect } from "../table/cell-rect";
import type { FlatKeys } from "../../storage/scalar";
import type { FragmentCell, FragmentTable } from "./fragment";
import { placeFragment } from "./fragment-table";
import { cellOf, keysFrom } from "./read-slice";

const TABLE_ATTRS: ReadonlySet<string> = new Set(["columnWidths", "headerRowCount"]);

/**
 * A cell rectangle as one table item (the inverse of `pasteCells`): per row of the box (grown: nothing crosses it), the
 * own cells starting in it with their clipped spans, read as C2 reads a cell; free slots stay virtual (short rows).
 * `widths` are the box's columns' (up to its last placed one), `header` the header rows inside a box starting at row 0, `keys` / `rowKeys` the
 * table's and the box rows' `a:*`. Null when the box holds no own cell (only virtual slots: nothing but empty cells).
 */
export function readCells(rect: CellRect): FragmentTable | null {
  const { d, form, tableId } = rect.c;
  const { r0, r1, c0, c1 } = rect.box;
  const R = form.rows.length;
  const tree = d.trees.block;
  const cells: FragmentCell[][] = [];
  const rowKeys: FlatKeys[] = [];
  for (let i = r0; i <= r1; i++) {
    const row = form.rows[i];
    if (row === undefined) return null;
    const own: FragmentCell[] = [];
    for (const p of row.placed) {
      if (p.gridCol < c0 || p.gridCol > c1) continue;
      const b = tree.get(p.cellId);
      const c = b === undefined ? null : cellOf(d, b);
      if (c === null) return null;
      // The grid's clipped spans (a cell's record holds them too; read here from the same placement).
      const rowSpan = Math.min(p.rowSpan, R - i);
      own.push({ items: c.items, ...(c.keys === undefined ? {} : { keys: c.keys }), ...(rowSpan > 1 ? { rowSpan } : {}), ...(p.colSpan > 1 ? { colSpan: p.colSpan } : {}) });
    }
    cells.push(own);
    rowKeys.push(keysFrom(tree.get(row.id)?.attrs ?? {}, "a:") ?? {});
  }
  if (cells.every((r) => r.length === 0)) return null;
  const attrs = tree.get(tableId)?.attrs ?? {};
  const [widths, header, keys] = [attrs["columnWidths"], attrs["headerRowCount"], keysFrom(attrs, "a:", TABLE_ATTRS)];
  // The placed grid's columns: free slots at the box's right edge are no column of the item.
  const n = placeFragment(cells).cols;
  const box = Array.isArray(widths) ? widths.slice(c0, c0 + n).filter((w): w is number => typeof w === "number") : [];
  const rows = r1 - r0 + 1;
  return {
    k: "table",
    cells,
    ...(box.length === n ? { widths: box } : {}),
    ...(r0 === 0 && typeof header === "number" && header > 0 ? { header: Math.min(header, rows) } : {}),
    ...(keys === undefined ? {} : { keys }),
    ...(rowKeys.some((k) => Object.keys(k).length > 0) ? { rowKeys } : {}),
  };
}
