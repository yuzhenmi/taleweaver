import type { State } from "./state";
import type { Selection } from "./block-position";
import type { BlockId } from "./block-id";
import { resolveTableContext, buildTableGrid } from "./table-context";
import type { AssignedCell } from "./table-grid-core";

/**
 * A rectangular cell range in GRID coordinates within one table — the input to
 * the P15b merge-cells command (and the basis for any future cell-rectangle
 * selection). Inclusive bounds: the range covers grid rows `minRow..maxRow` and
 * columns `minCol..maxCol`. A single-cell range has `minRow === maxRow &&
 * minCol === maxCol`.
 */
export interface CellRange {
  readonly tableId: BlockId;
  readonly minRow: number;
  readonly minCol: number;
  readonly maxRow: number;
  readonly maxCol: number;
}

/**
 * Resolve the rectangular cell range spanned by a linear `selection` whose anchor
 * and focus sit in (possibly different) cells of the SAME main-tree table, or
 * `null` when the endpoints aren't both in one table (D1). The editor `Selection`
 * stays linear; this is the pure resolver that turns a cross-cell selection into
 * a grid rectangle (mirroring how P15a added `resolveTableContext` rather than
 * extending `Selection`).
 *
 * Algorithm (D1 + design-review F3): bounding-box the anchor and focus cells'
 * grid RECTANGLES (a merged endpoint contributes its whole `rowSpan×colSpan`
 * rectangle), then expand to whole span-rectangles to a fixpoint — for every slot
 * `(r,c)` in the current box, look up `occupancy[r][c]`, find that cell's
 * `AssignedCell`, and union its rectangle into the box; repeat until a full pass
 * adds nothing. This guarantees a clean rectangle of WHOLE cells (Google Docs /
 * Word: a merge region never bisects a merged cell). Convergence: each step
 * strictly grows the box, bounded by `rowCount × columnCount`.
 */
export function resolveCellRange(state: State, selection: Selection): CellRange | null {
  const anchorCtx = resolveTableContext(state, selection.anchor.blockId);
  const focusCtx = resolveTableContext(state, selection.focus.blockId);
  if (anchorCtx === null || focusCtx === null) return null;
  if (anchorCtx.tableId !== focusCtx.tableId) return null;

  const grid = buildTableGrid(state, anchorCtx.tableId);
  if (grid === null) return null;
  const cellById = new Map<BlockId, AssignedCell>(
    grid.cells.map((c): [BlockId, AssignedCell] => [c.cellId, c]),
  );
  const anchorCell = cellById.get(anchorCtx.cellId);
  const focusCell = cellById.get(focusCtx.cellId);
  if (anchorCell === undefined || focusCell === undefined) return null;

  // Initial bounding box over the two endpoint cells' full grid rectangles.
  let minRow = Math.min(anchorCell.gridRow, focusCell.gridRow);
  let minCol = Math.min(anchorCell.gridCol, focusCell.gridCol);
  let maxRow = Math.max(
    anchorCell.gridRow + anchorCell.rowSpan - 1,
    focusCell.gridRow + focusCell.rowSpan - 1,
  );
  let maxCol = Math.max(
    anchorCell.gridCol + anchorCell.colSpan - 1,
    focusCell.gridCol + focusCell.colSpan - 1,
  );

  // Expand to whole span-rectangles to a fixpoint (bounded by the grid area).
  const maxIters = grid.occupancy.length * grid.columnCount + 1;
  for (let iter = 0; iter < maxIters; iter++) {
    let changed = false;
    for (let r = minRow; r <= maxRow; r++) {
      const row = grid.occupancy[r];
      if (row === undefined) continue;
      for (let c = minCol; c <= maxCol; c++) {
        const owner = row[c] ?? null;
        if (owner === null) continue;
        const cell = cellById.get(owner);
        if (cell === undefined) continue;
        if (cell.gridRow < minRow) { minRow = cell.gridRow; changed = true; }
        if (cell.gridCol < minCol) { minCol = cell.gridCol; changed = true; }
        if (cell.gridRow + cell.rowSpan - 1 > maxRow) { maxRow = cell.gridRow + cell.rowSpan - 1; changed = true; }
        if (cell.gridCol + cell.colSpan - 1 > maxCol) { maxCol = cell.gridCol + cell.colSpan - 1; changed = true; }
      }
    }
    if (!changed) break;
  }

  return { tableId: anchorCtx.tableId, minRow, minCol, maxRow, maxCol };
}
