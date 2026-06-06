import type { LayoutBoxMetadata } from "../render/layout-metadata";
import type { BlockId } from "../state";
import { isDevMode } from "./dev-mode";

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

/** A cell's resolved placement in the table grid (P8). */
export interface AssignedCell {
  readonly cellId: BlockId;
  readonly gridRow: number;
  readonly gridCol: number;
  readonly rowSpan: number;
  readonly colSpan: number;
}

/** The result of laying cells onto the table grid. */
export interface TableGrid {
  /** One entry per input cell, in document order, with its grid placement. */
  readonly cells: readonly AssignedCell[];
  /** Total column count = max over the grid of `(gridCol + colSpan)`. */
  readonly columnCount: number;
  /**
   * `occupancy[row][col]` = the id of the cell owning that slot, or `null` for a
   * genuinely empty slot (ragged rows). Rectangular: every row has `columnCount`
   * entries. The reverse map a point/selection uses to find the owning merged cell.
   */
  readonly occupancy: readonly (BlockId | null)[][];
}

/**
 * Assign every cell a grid origin `(gridRow, gridCol)` + span via the CSS
 * Tables 3 §17.5 grid model (P8). Scans rows top-to-bottom, cells left-to-right:
 * each cell takes the first column free at its row (skipping columns still
 * consumed by a cell spanning DOWN from an earlier row), then claims its
 * `colSpan × rowSpan` rectangle.
 *
 * - `colSpan` grows the column count (`max(gridCol + colSpan)`); `rowSpan` is
 *   CLAMPED to the remaining rows (`min(rowSpan, rowCount − gridRow)`) — a cell
 *   never creates rows (HTML semantics).
 * - A malformed overlap (a cell's rectangle hitting a slot already owned by a
 *   cell spanning from above) dev-asserts; in production the first writer wins
 *   (the slot is never overwritten) and assignment continues.
 *
 * Pure: no geometry, no px — just the integer grid both geometry passes consume.
 */
export function assignTableGrid(rows: readonly (readonly GridCellInput[])[]): TableGrid {
  const rowCount = rows.length;
  const cells: AssignedCell[] = [];
  // occ[r][c] = owning cell id while building (undefined = unfilled). Materialized
  // to a rectangular null-filled grid at the end (once columnCount is known).
  const occ: (BlockId | undefined)[][] = rows.map(() => []);
  // Per column: the row index at which the column becomes free again (= a
  // spanning cell's gridRow + rowSpan). Absent ⇒ 0 (free from the top).
  const freeAtRow: number[] = [];
  let columnCount = 0;

  for (let r = 0; r < rowCount; r++) {
    let c = 0;
    for (const cell of rows[r] ?? []) {
      // Skip columns still consumed by a cell spanning down from a previous row.
      while ((freeAtRow[c] ?? 0) > r) c++;

      const { rowSpan: rawRowSpan, colSpan } = cellSpan(cell);
      const rowSpan = Math.min(rawRowSpan, rowCount - r); // clamp overlong (never adds rows)

      const topRow = occ[r];
      for (let dr = 0; dr < rowSpan; dr++) {
        const rowArr = occ[r + dr];
        if (rowArr === undefined) continue; // unreachable by invariant (clamp keeps r+dr < rowCount)
        for (let dc = 0; dc < colSpan; dc++) {
          const cc = c + dc;
          if (rowArr[cc] !== undefined) {
            if (isDevMode()) {
              throw new Error(
                `assignTableGrid: cell "${cell.key}" overlaps an occupied slot at ` +
                  `(${r + dr}, ${cc}) — malformed table grid`,
              );
            }
            continue; // production: first writer wins, never overwrite
          }
          rowArr[cc] = cell.key;
        }
      }
      // Reserve only the columns this cell actually OWNS (wrote its top-row slot);
      // a column lost to a first-writer in a malformed overlap keeps the winner's
      // reservation, and `Math.max` never shrinks an existing longer span. (In a
      // well-formed table the cell owns every column it spans, so this reserves all.)
      for (let dc = 0; dc < colSpan; dc++) {
        const cc = c + dc;
        if (topRow !== undefined && topRow[cc] === cell.key) {
          freeAtRow[cc] = Math.max(freeAtRow[cc] ?? 0, r + rowSpan);
        }
      }

      cells.push({ cellId: cell.key, gridRow: r, gridCol: c, rowSpan, colSpan });
      c += colSpan;
      if (c > columnCount) columnCount = c;
    }
  }

  const occupancy: (BlockId | null)[][] = occ.map((rowArr) => {
    const out: (BlockId | null)[] = [];
    for (let col = 0; col < columnCount; col++) out.push(rowArr[col] ?? null);
    return out;
  });

  return { cells, columnCount, occupancy };
}
