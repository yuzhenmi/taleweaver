/**
 * Layering-neutral table occupancy-grid core (P8 §17.5 grid model, shared by
 * layout AND state).
 *
 * This is the CSS Tables 3 §17.5 cell-placement scan, extracted so STATE code
 * (P15b span-aware editing ops, which must reason in grid coordinates over a
 * `State` Block tree) can build the SAME grid layout builds — without depending
 * on `LayoutBoxMetadata`. The input is a NEUTRAL `GridCell` whose spans are
 * already resolved to integers ≥ 1 by the caller.
 *
 * CONTRACT — callers MUST pre-normalize spans the way their layer does, so the
 * grid is byte-identical across layers:
 *   - LAYOUT pre-normalizes via `cellSpan` (reads `metadata.rowSpan/colSpan`,
 *     `clampSpan` → finite int ≥ 1). See `layout/table-grid.ts`.
 *   - STATE pre-normalizes via `spanValue(attrs.rowSpan) ?? 1` (the component-
 *     side predicate that only treats integers > 1 as real spans). Using
 *     `clampSpan` on raw attrs would diverge (`clampSpan(2.9) = 2` vs layout's
 *     `1×1` for a non-stamped fractional), so state must NOT use `clampSpan`.
 * The core still defensively floors each span to ≥ 1 (matching the historical
 * layout behavior), but the cross-layer span SEMANTICS live in each caller's
 * pre-normalization, not here.
 */
import type { BlockId } from "./block-id";
import { isDevMode } from "./dev-mode";

/** A finite integer ≥ 1, else 1 (a defensive backstop; callers pre-normalize). */
function clampSpan(v: number): number {
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
}

/**
 * One table cell as the neutral grid scan sees it: its id plus its spans,
 * ALREADY resolved to integers ≥ 1 by the caller (layout via `cellSpan`, state
 * via `spanValue ?? 1`).
 */
export interface GridCell {
  readonly cellId: BlockId;
  readonly rowSpan: number;
  readonly colSpan: number;
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
export function assignTableGrid(rows: readonly (readonly GridCell[])[]): TableGrid {
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

      const colSpan = clampSpan(cell.colSpan);
      const rawRowSpan = clampSpan(cell.rowSpan);
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
                `assignTableGrid: cell "${cell.cellId}" overlaps an occupied slot at ` +
                  `(${r + dr}, ${cc}) — malformed table grid`,
              );
            }
            continue; // production: first writer wins, never overwrite
          }
          rowArr[cc] = cell.cellId;
        }
      }
      // Reserve only the columns this cell actually OWNS (wrote its top-row slot);
      // a column lost to a first-writer in a malformed overlap keeps the winner's
      // reservation, and `Math.max` never shrinks an existing longer span. (In a
      // well-formed table the cell owns every column it spans, so this reserves all.)
      for (let dc = 0; dc < colSpan; dc++) {
        const cc = c + dc;
        if (topRow !== undefined && topRow[cc] === cell.cellId) {
          freeAtRow[cc] = Math.max(freeAtRow[cc] ?? 0, r + rowSpan);
        }
      }

      cells.push({ cellId: cell.cellId, gridRow: r, gridCol: c, rowSpan, colSpan });
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
