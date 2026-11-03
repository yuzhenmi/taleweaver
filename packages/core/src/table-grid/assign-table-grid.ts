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

/** A slot covered from above: its head and the rows its STORED rowSpan still covers, this one included (≥ 1). */
export interface CarrySlot<Id extends string = string> {
  readonly head: Id;
  readonly rowsLeft: number;
}

/**
 * A row's slots covered by the heads of earlier rows: `carry[col]`, undefined = free. No
 * trailing undefined entry, so equal coverage compares equal entry by entry.
 */
export type Carry<Id extends string = string> = readonly (CarrySlot<Id> | undefined)[];

/** The carry of a row nothing above covers (shared, so uncovered rows share one array). */
export const EMPTY_CARRY: Carry<never> = Object.freeze([]);

/** A cell placed in its row: `rowSpan` is its STORED span (clamped to ≥ 1, not to the table's end), `colSpan` clipped. */
export interface PlacedCell<Id extends string = string> {
  readonly cellId: Id;
  readonly gridCol: number;
  readonly rowSpan: number;
  readonly colSpan: number;
}

/** One row of the forming. */
export interface PlacedRow<Id extends string = string> {
  /** The row's cells that got a slot, in document order. */
  readonly placed: readonly PlacedCell<Id>[];
  /** Cells whose slot would be at or past `maxColumns` (document order). */
  readonly overflow: readonly Id[];
  /** Max over the placed cells of `gridCol + colSpan` (0 with none). */
  readonly width: number;
  /** The row's slot owners (covered from above or placed here), undefined = free; no trailing undefined. */
  readonly slots: readonly (Id | undefined)[];
  /** The carry of the next row. */
  readonly carryOut: Carry<Id>;
}

/**
 * Place one row's cells by the §17.5 forming (see {@link assignTableGrid}), given the
 * slots covered from above. The carry keeps stored row spans: clipping a span to the
 * table's end is the caller's, on output, so appending a row extends a span reaching it.
 */
export function placeRow<Id extends string>(carryIn: Carry<Id>, cells: readonly GridCell<Id>[], maxColumns = Number.POSITIVE_INFINITY): PlacedRow<Id> {
  const slots: (Id | undefined)[] = carryIn.map((c) => c?.head);
  const out: (CarrySlot<Id> | undefined)[] = carryIn.map((c) => (c !== undefined && c.rowsLeft > 1 ? { head: c.head, rowsLeft: c.rowsLeft - 1 } : undefined));
  const placed: PlacedCell<Id>[] = [];
  const overflow: Id[] = [];
  let width = 0;
  let c = 0;
  for (const cell of cells) {
    while (slots[c] !== undefined) c++;
    if (c >= maxColumns) {
      overflow.push(cell.cellId);
      continue;
    }
    let colSpan = 1;
    const wantCols = Math.min(clampSpan(cell.colSpan), maxColumns - c);
    while (colSpan < wantCols && slots[c + colSpan] === undefined) colSpan++;
    // Rows below are then free across that width: an earlier rectangle covering a slot below
    // starts at or above this row, so it would cover the slot here too.
    const rowSpan = clampSpan(cell.rowSpan);
    for (let dc = 0; dc < colSpan; dc++) {
      slots[c + dc] = cell.cellId;
      if (rowSpan > 1) out[c + dc] = { head: cell.cellId, rowsLeft: rowSpan - 1 };
    }
    placed.push({ cellId: cell.cellId, gridCol: c, rowSpan, colSpan });
    c += colSpan;
    if (c > width) width = c;
  }
  // Dense (a 1-row cell past the carry leaves a hole), then trimmed.
  const carryOut = Array.from(out);
  while (carryOut.length > 0 && carryOut[carryOut.length - 1] === undefined) carryOut.pop();
  return { placed, overflow, width, slots, carryOut: carryOut.length === 0 ? EMPTY_CARRY : carryOut };
}

/**
 * Place every cell by the §17.5 forming: rows top to bottom, cells left to right;
 * each cell takes the first free slot at or after the current column of its row
 * ({@link placeRow}).
 *
 * Its rectangle is then CLIPPED to free slots (RT2), so the grid is always well
 * formed and earlier cells win:
 *   - `colSpan` shrinks to the run of free slots starting at the placement slot;
 *   - `rowSpan` is clamped to the remaining rows (a cell never creates rows); it needs
 *     no other clip: those columns are free in every row below (an earlier rectangle
 *     covering a slot below would cover row r's slot too).
 * A clipped cell's AssignedCell carries the clipped spans.
 *
 * `maxColumns` caps the grid's width: a colSpan is clipped to it, and a cell whose slot
 * would be at or past it is not placed (`overflow`; the caller decides where its content
 * reads). The default is no cap.
 *
 * Pure: no geometry, just the integer grid.
 */
export function assignTableGrid<Id extends string>(rows: readonly (readonly GridCell<Id>[])[], maxColumns = Number.POSITIVE_INFINITY): TableGrid<Id> {
  const cells: AssignedCell<Id>[] = [];
  const overflow: Id[] = [];
  const slotRows: (readonly (Id | undefined)[])[] = [];
  let columnCount = 0;
  let carry: Carry<Id> = EMPTY_CARRY;
  rows.forEach((row, r) => {
    const pr = placeRow(carry, row, maxColumns);
    for (const p of pr.placed) cells.push({ cellId: p.cellId, gridRow: r, gridCol: p.gridCol, rowSpan: Math.min(p.rowSpan, rows.length - r), colSpan: p.colSpan });
    overflow.push(...pr.overflow);
    slotRows.push(pr.slots);
    if (pr.width > columnCount) columnCount = pr.width;
    carry = pr.carryOut;
  });
  const occupancy: (Id | null)[][] = slotRows.map((slots) => {
    const out: (Id | null)[] = [];
    for (let col = 0; col < columnCount; col++) out.push(slots[col] ?? null);
    return out;
  });
  return { cells, columnCount, occupancy, overflow };
}
