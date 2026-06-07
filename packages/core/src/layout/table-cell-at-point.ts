import type { LayoutBox, TableBox, TableRowBox, TableCellBox } from "./layout-box";

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

/** A cell located by a positioned-tree walk, with its absolute (page-local) origin. */
export interface LocatedTableCell {
  readonly cell: TableCellBox;
  /** The cell's absolute physical inline-axis origin (matches AbsoluteLineBox.absoluteX). */
  readonly absX: number;
  /** The cell's absolute physical block-axis origin (matches AbsoluteLineBox.absoluteY). */
  readonly absY: number;
}

/**
 * Walk a positioned layout (sub)tree to find the table cell whose PHYSICAL rect
 * contains the point `(x, y)`, in the SAME page-local coordinate space that
 * `collectLineBoxes` produces (absolute coords accumulate by summing each box's
 * physical `x` / `y`; pages reset the origin to `(0, 0)` and gate on `pageIndex`).
 *
 * Tests each positioned cell's physical rect directly rather than the §17.5
 * occupancy grid: a spanning cell's box already covers its full merged region
 * (rowSpan height / colSpan width from S2/S3) and cell rects tile the table
 * without overlap, so the first cell whose rect contains the point is the owner —
 * including a point in a rowSpan cell's lower region or a colSpan cell's trailing
 * region. Using physical rects keeps this writing-mode-agnostic (the vertical-rl
 * mirror is already baked into every box's `x` by the physicalize pass), with no
 * physical→logical conversion. Nested tables resolve to the innermost cell.
 *
 * Returns the owning cell + its absolute origin (so a consumer can restrict
 * candidate lines to the merged-cell rect), or `null` when the point is in no
 * table cell (outside any table, or a ragged empty grid slot).
 */
export function locateTableCellAtPoint(
  root: LayoutBox,
  x: number,
  y: number,
  pageIndex: number = 0,
): LocatedTableCell | null {
  const findCellInTable = (
    table: TableBox,
    tableAbsX: number,
    tableAbsY: number,
  ): LocatedTableCell | null => {
    for (const row of table.children) {
      if (row.type !== "table-row") continue;
      const rowAbsX = tableAbsX + row.x;
      const rowAbsY = tableAbsY + row.y;
      for (const cell of row.children) {
        if (cell.type !== "table-cell") continue;
        const cellAbsX = rowAbsX + cell.x;
        const cellAbsY = rowAbsY + cell.y;
        if (
          x >= cellAbsX && x < cellAbsX + cell.width &&
          y >= cellAbsY && y < cellAbsY + cell.height
        ) {
          // Innermost wins: a nested table inside this cell takes precedence.
          for (const inner of cell.children) {
            const deeper = walk(inner, cellAbsX, cellAbsY);
            if (deeper !== null) return deeper;
          }
          return { cell, absX: cellAbsX, absY: cellAbsY };
        }
      }
    }
    return null;
  };

  const walk = (box: LayoutBox, parentX: number, parentY: number): LocatedTableCell | null => {
    if (box.type === "page") {
      // Page-local coordinate space (matches collectLineBoxes): only the target
      // page's subtree, walked from its own (0, 0) origin. Header/footer/footnote
      // SLOTS are named PageBox fields kept OUT of `children`; walk them too (same
      // as collectLineBoxes) so a table in a slot resolves in the same coordinate
      // space its lines are collected in.
      if (box.pageIndex !== pageIndex) return null;
      if (box.headerSlot) {
        const r = walk(box.headerSlot, 0, 0);
        if (r !== null) return r;
      }
      for (const child of box.children) {
        const r = walk(child, 0, 0);
        if (r !== null) return r;
      }
      if (box.footerSlot) {
        const r = walk(box.footerSlot, 0, 0);
        if (r !== null) return r;
      }
      if (box.footnoteSlot) {
        const r = walk(box.footnoteSlot, 0, 0);
        if (r !== null) return r;
      }
      return null;
    }
    const absX = parentX + box.x;
    const absY = parentY + box.y;
    if (box.type === "table") {
      if (x < absX || x >= absX + box.width || y < absY || y >= absY + box.height) {
        return null;
      }
      return findCellInTable(box, absX, absY);
    }
    // Leaf boxes (text-run / marker) have no children to descend into.
    if (box.type === "text-run" || box.type === "marker") return null;
    for (const child of box.children) {
      const r = walk(child, absX, absY);
      if (r !== null) return r;
    }
    return null;
  };

  return walk(root, 0, 0);
}
