/**
 * Layering-neutral table grid forming (CSS Tables 3 §17.5), shared by the schema-4
 * model (RT2), schema-3 `state/` and print's layout. It imports nothing, so every
 * layer may use it.
 *
 * The input is a neutral `GridCell` whose spans the caller has already read as
 * integers ≥ 1 (its own read rule); the core floors / clamps them defensively.
 *
 * Generic over the id type: `state/` and print pass the branded `BlockId`, the model
 * plain strings.
 */

/** A finite integer ≥ 1, else 1 (a defensive backstop; callers pre-normalize). */
function clampSpan(v: number): number {
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
}

/** One table cell as the grid forming sees it: its id and its spans (integers ≥ 1). */
export interface GridCell<Id extends string = string> {
  readonly cellId: Id;
  readonly rowSpan: number;
  readonly colSpan: number;
}

/** A cell's placement in the grid, with its spans after clipping. */
export interface AssignedCell<Id extends string = string> {
  readonly cellId: Id;
  readonly gridRow: number;
  readonly gridCol: number;
  readonly rowSpan: number;
  readonly colSpan: number;
}

/** The result of laying cells onto the table grid. */
export interface TableGrid<Id extends string = string> {
  /** One entry per input cell, in document order, with its grid placement. */
  readonly cells: readonly AssignedCell<Id>[];
  /** Total column count = max over the cells of `(gridCol + colSpan)`. */
  readonly columnCount: number;
  /**
   * `occupancy[row][col]` = the id of the cell owning that slot, or `null` for an
   * empty slot (ragged rows). Rectangular: every row has `columnCount` entries.
   */
  readonly occupancy: readonly (Id | null)[][];
  /** Cells left unplaced because their slot would be at or past `maxColumns` (document order). */
  readonly overflow: readonly Id[];
}

/**
 * Place every cell by the §17.5 forming: rows top to bottom, cells left to right;
 * each cell takes the first free slot at or after the current column of its row.
 *
 * Its rectangle is then CLIPPED to free slots (RT2), so the grid is always well
 * formed and earlier cells win:
 *   - `rowSpan` is first clamped to the remaining rows (a cell never creates rows);
 *   - `colSpan` shrinks to the run of free slots starting at the placement slot;
 *   - `rowSpan` then needs no clip: those columns are free in every row below (an
 *     earlier rectangle covering a slot below would cover row r's slot too).
 * A clipped cell's AssignedCell carries the clipped spans.
 *
 * `maxColumns` caps the grid's width: a colSpan is clipped to it, and a cell whose slot
 * would be at or past it is not placed (`overflow`; the caller decides where its content
 * reads). The default is no cap.
 *
 * Pure: no geometry, just the integer grid.
 */
export function assignTableGrid<Id extends string>(rows: readonly (readonly GridCell<Id>[])[], maxColumns = Number.POSITIVE_INFINITY): TableGrid<Id> {
  const rowCount = rows.length;
  const cells: AssignedCell<Id>[] = [];
  const overflow: Id[] = [];
  // occ[r][c] = owning cell id (undefined = free). Made rectangular at the end.
  const occ: (Id | undefined)[][] = rows.map(() => []);
  const free = (r: number, c: number): boolean => occ[r]?.[c] === undefined;
  let columnCount = 0;

  for (let r = 0; r < rowCount; r++) {
    let c = 0;
    for (const cell of rows[r] ?? []) {
      while (!free(r, c)) c++;
      if (c >= maxColumns) {
        overflow.push(cell.cellId);
        continue;
      }
      let colSpan = 1;
      const wantCols = Math.min(clampSpan(cell.colSpan), maxColumns - c);
      while (colSpan < wantCols && free(r, c + colSpan)) colSpan++;
      // Rows below are then free across that width: an earlier rectangle covering a slot below
      // starts at or above row r, so it would cover the slot in row r too.
      const rowSpan = Math.min(clampSpan(cell.rowSpan), rowCount - r);
      for (let dr = 0; dr < rowSpan; dr++) {
        const rowArr = occ[r + dr];
        if (rowArr !== undefined) for (let dc = 0; dc < colSpan; dc++) rowArr[c + dc] = cell.cellId;
      }
      cells.push({ cellId: cell.cellId, gridRow: r, gridCol: c, rowSpan, colSpan });
      c += colSpan;
      if (c > columnCount) columnCount = c;
    }
  }

  const occupancy: (Id | null)[][] = occ.map((rowArr) => {
    const out: (Id | null)[] = [];
    for (let col = 0; col < columnCount; col++) out.push(rowArr[col] ?? null);
    return out;
  });

  return { cells, columnCount, occupancy, overflow };
}
