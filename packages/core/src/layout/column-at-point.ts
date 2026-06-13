import type { LayoutBox, BlockBox } from "./layout-box";

/** A column located by a positioned-tree walk, with its absolute (page-local) origin. */
export interface LocatedColumn {
  /** The owning column track (a `BlockBox` child of a `MultiColumnBox`). */
  readonly column: BlockBox;
  /** The column's absolute physical inline-axis origin (matches AbsoluteLineBox.absoluteX). */
  readonly absX: number;
  /** The column's absolute physical block-axis origin (matches AbsoluteLineBox.absoluteY). */
  readonly absY: number;
}

/**
 * Walk a positioned layout (sub)tree to find the multi-column COLUMN whose
 * PHYSICAL rect contains the point `(x, y)`, in the SAME page-local coordinate
 * space that `collectLineBoxes` produces (absolute coords accumulate by summing
 * each box's physical `x` / `y`; pages reset the origin to `(0, 0)` and gate on
 * `pageIndex`).
 *
 * This is the multi-column analogue of `locateTableCellAtPoint` (multi-column
 * slice 3a). The hit-test line PICKER is inline-axis-UNAWARE — it picks the first
 * line whose BLOCK-axis band contains the click, ignoring the inline (X) axis
 * until the in-line leaf pick. For N side-by-side columns at the same Y a click in
 * column B (right) would resolve into column A's (left) line. So hit-test FIRST
 * restricts the candidate lines to the clicked column's rect (via this lookup),
 * then runs the band+leaf pick WITHIN that column — exactly the table-cell pattern.
 *
 * Tests each column's PHYSICAL rect directly (the `MultiColumnBox` columns tile
 * the section's inline width side by side with a gap between them). Using physical
 * rects keeps this writing-mode-agnostic (the vertical-rl mirror is already baked
 * into every box's `x` by the physicalize pass), matching `locateTableCellAtPoint`.
 *
 * Returns the owning column + its absolute origin, or `null` when the point is in
 * no column — INCLUDING the common single-column page (no `MultiColumnBox` at all)
 * and a click in the inter-column gap or outside the section. A `null` return
 * leaves hit-test's candidate-line region unchanged, so single-column hit-testing
 * is completely unaffected. A `MultiColumnBox`'s columns may themselves contain
 * tables; the `MultiColumnBox` is the OUTER container here, so this returns its
 * column — the (existing) table-cell restriction then composes WITHIN that column.
 */
export function locateColumnAtPoint(
  root: LayoutBox,
  x: number,
  y: number,
  pageIndex: number = 0,
): LocatedColumn | null {
  const walk = (box: LayoutBox, parentX: number, parentY: number): LocatedColumn | null => {
    if (box.type === "page") {
      // Page-local coordinate space (matches collectLineBoxes): only the target
      // page's subtree, walked from its own (0, 0) origin. Header/footer/footnote
      // SLOTS are named PageBox fields kept OUT of `children`; walk them too (same
      // as collectLineBoxes / locateTableCellAtPoint) so a multi-column section in
      // a slot resolves in the same coordinate space its lines are collected in.
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
    if (box.type === "multicolumn") {
      // The MultiColumnBox is positioned in the PARENT frame at (absX, absY); its
      // `columns` (BlockBoxes) carry their own physical `x` / `y` RELATIVE to it,
      // mirroring how `collectLineBoxes` descends `columns` with origin (absX,
      // absY). Return the first column whose absolute physical rect contains the
      // point. Columns tile without overlap, so the first match is the owner.
      for (const col of box.columns) {
        const colAbsX = absX + col.x;
        const colAbsY = absY + col.y;
        if (
          x >= colAbsX && x < colAbsX + col.width &&
          y >= colAbsY && y < colAbsY + col.height
        ) {
          return { column: col, absX: colAbsX, absY: colAbsY };
        }
      }
      // Click in the inter-column gap or outside the section: no column owns it.
      return null;
    }
    // Leaf boxes (text-run / marker) have no children to descend into.
    if (box.type === "text-run" || box.type === "marker") return null;
    // A table's cells are not multi-column columns; descend its rows/cells via the
    // generic `children` walk below (a MultiColumnBox could be nested in a cell).
    for (const child of box.children) {
      const r = walk(child, absX, absY);
      if (r !== null) return r;
    }
    return null;
  };

  return walk(root, 0, 0);
}
