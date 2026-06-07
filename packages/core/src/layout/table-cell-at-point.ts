import type { TableBox, TableRowBox, TableCellBox } from "./layout-box";

/**
 * Reverse-lookup the table cell owning a point, given in TABLE-LOCAL LOGICAL
 * coordinates (`inline` / `block` measured from the table's inline-start /
 * block-start, 0-based). Uses the CSS Tables §17.5 occupancy grid (P8) so a
 * point in the lower region of a `rowSpan > 1` cell — or the trailing region of
 * a `colSpan > 1` cell — resolves to the SPANNING cell that owns that grid slot,
 * not the row/column that merely sits there visually.
 *
 * Returns the owning `TableCellBox`, or `null` for a genuinely empty grid slot
 * (a ragged table) or an empty table.
 *
 * Operates on a fully-materialized `TableBox` whose row children START at grid
 * row 0, so their index in `table.children` === the `occupancy` row index. Any
 * FRAGMENTED TableBox — a table split across pages, where `table.children` is a
 * rendered sub-range beginning at some `startBodyRow > 0` while `occupancy` still
 * covers the whole grid — breaks that 1:1 mapping (with OR without rowSpan); the
 * caller must only call this on a non-fragmented table. Threading a start-row
 * offset through is S5. Out-of-band points clamp to the nearest edge row/column
 * (matching the hit-test convention of snapping a stray click inward).
 */
export function resolveTableCellAtPoint(
  table: TableBox,
  inline: number,
  block: number,
): TableCellBox | null {
  const rows = table.children.filter(
    (c): c is TableRowBox => c.type === "table-row",
  );
  if (rows.length === 0 || table.columnCount === 0) return null;

  // Block axis → grid row. A point above the first row clamps to row 0 (handled
  // up-front so it's correct regardless of the first row's blockOffset); else the
  // first row whose band end exceeds `block`, defaulting to the last row when the
  // point is past the table's end.
  let gridRow: number;
  if (block < (rows[0]?.blockOffset ?? 0)) {
    gridRow = 0;
  } else {
    gridRow = rows.length - 1;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (row === undefined) continue;
      if (block < row.blockOffset + row.blockSize) {
        gridRow = r;
        break;
      }
    }
  }

  // Inline axis → grid column. A point before the inline-start clamps to column 0
  // up-front (also covers a zero-width first column, where the cumulative loop's
  // `inline < acc` never fires at c=0); else the first column whose cumulative
  // edge exceeds `inline`, defaulting to the last column past the table's end.
  let gridCol: number;
  if (inline < 0) {
    gridCol = 0;
  } else {
    gridCol = table.columnCount - 1;
    let acc = 0;
    for (let c = 0; c < table.columnCount; c++) {
      acc += table.columnPxWidths[c] ?? 0;
      if (inline < acc) {
        gridCol = c;
        break;
      }
    }
  }

  const cellId = table.occupancy[gridRow]?.[gridCol] ?? null;
  if (cellId === null) return null;
  return table.cellBoxById.get(cellId) ?? null;
}
