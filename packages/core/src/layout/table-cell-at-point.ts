import type { LayoutBox, TableBox, TableCellBox } from "./layout-box";

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
    // A MultiColumnBox is NOT a table — it is a container whose `columns`
    // (BlockBoxes) may themselves contain tables. Descend the columns so a table
    // nested inside a column still resolves; the box itself is never a table-cell.
    if (box.type === "multicolumn") {
      for (const col of box.columns) {
        const r = walk(col, absX, absY);
        if (r !== null) return r;
      }
      return null;
    }
    for (const child of box.children) {
      const r = walk(child, absX, absY);
      if (r !== null) return r;
    }
    return null;
  };

  return walk(root, 0, 0);
}
