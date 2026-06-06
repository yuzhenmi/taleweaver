import type { LayoutBoxMetadata } from "../render/layout-metadata";

/** A finite integer ≥ 1, else 1 (absent / invalid spans collapse to a 1×1 cell). */
function clampSpan(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
}

/**
 * Read a table cell's `rowSpan` / `colSpan` (P8). These are STRUCTURAL grid
 * facts (the HTML rowspan/colspan model), NOT cascaded style — the `table-cell`
 * component stamps them RAW from the cell's `attrs` into `metadata`
 * (see `components/table-cell.ts`), and the Table FC + the intrinsic pass read
 * them here so the two agree on one place. Absent / invalid ⇒ 1.
 */
export function cellSpan(cell: { readonly metadata?: Readonly<LayoutBoxMetadata> }): {
  rowSpan: number;
  colSpan: number;
} {
  return {
    rowSpan: clampSpan(cell.metadata?.rowSpan),
    colSpan: clampSpan(cell.metadata?.colSpan),
  };
}
