import type { LayoutBoxMetadata } from "@taleweaver/core";
import type { BlockId } from "@taleweaver/core";
import {
  assignTableGrid as assignTableGridCore,
  type GridCell,
  type TableGrid,
} from "@taleweaver/core";

// The grid TYPES are owned by the layering-neutral core; re-export them so
// existing P8 layout imports (`from "./table-grid"`) keep resolving.
export type { TableGrid, AssignedCell } from "@taleweaver/core";

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

/** One table cell as the grid assignment sees it: its id + the metadata `cellSpan` reads. */
export interface GridCellInput {
  readonly key: BlockId;
  readonly metadata?: Readonly<LayoutBoxMetadata>;
}

/**
 * Assign every cell a grid origin `(gridRow, gridCol)` + span via the CSS
 * Tables 3 §17.5 grid model (P8) — the LAYOUT entry point. This is a thin
 * adapter over the layering-neutral `assignTableGrid` core
 * (`state/table-grid-core.ts`): it resolves each cell's spans the LAYOUT way
 * (via `cellSpan`, reading `metadata`) into the neutral `GridCell` input, then
 * runs the shared scan. The span resolution here is the SAME path layout always
 * used, so the produced grid is byte-identical to the pre-extraction behavior.
 *
 * See the core's docstring for the cross-layer pre-normalization contract (state
 * resolves spans via `spanValue ?? 1`, NOT `cellSpan`/`clampSpan`).
 */
export function assignTableGrid(rows: readonly (readonly GridCellInput[])[]): TableGrid {
  const neutralRows: GridCell[][] = rows.map((row) =>
    row.map((input): GridCell => {
      const { rowSpan, colSpan } = cellSpan(input);
      return { cellId: input.key, rowSpan, colSpan };
    }),
  );
  return assignTableGridCore(neutralRows);
}
