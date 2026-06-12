import type { State } from "../state";
import { getBlock } from "../state";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import type { TableGrid } from "../table-grid-core";

/**
 * Pure validators for the `headerRowCount` table attr (repeating-header rows,
 * #487). Kept separate from the `setTableHeaderRows` op so they are unit-testable
 * in isolation against synthetic grids.
 *
 * The `headerRowCount` attr names the first `N` contiguous rows as repeating
 * header rows; the engine repeats them at the top of every page/column fragment
 * the table spans. Two invariants live here:
 *   - the CLEAN-CUT invariant (`largestCleanHeaderCount`): no merged cell may
 *     originate in a header row and span past the header boundary into a body
 *     row, so the repeated header is a self-contained sub-grid (spec §3);
 *   - the row-edit ADJUSTMENT (`adjustHeaderRowCount`): an insert/delete row keeps
 *     `headerRowCount` naming the leading contiguous block (spec §7.1).
 */

/**
 * The largest header-row count `≤ min(requested, rowCount)` such that NO cell
 * originating in a header row spans past the header boundary (the §3 clean-cut
 * invariant). A cell with grid-origin row `gridRow` and `rowSpan` STRADDLES a
 * boundary at `count` when `gridRow < count && gridRow + rowSpan > count` — it
 * starts inside the header band `[0, count)` but reaches into a body row `≥ count`.
 *
 * Walks candidate counts downward from `min(requested, rowCount)`; the first
 * candidate with no straddling cell wins. `0` is always clean (an empty header
 * band straddles nothing), so the walk always terminates with a valid result.
 *
 * `requested` is clamped to `[0, rowCount]` first (a request above the row count
 * means "pin every row"; a negative request means "no header").
 */
export function largestCleanHeaderCount(grid: TableGrid, requested: number): number {
  const rowCount = grid.occupancy.length;
  const clamped = Math.max(0, Math.min(requested, rowCount));
  for (let count = clamped; count > 0; count--) {
    const straddles = grid.cells.some(
      (cell) => cell.gridRow < count && cell.gridRow + cell.rowSpan > count,
    );
    if (!straddles) return count;
  }
  return 0;
}

/** A structural row edit that shifts the header boundary. */
export type RowEditOp = "insert" | "delete";

/**
 * Re-derive `headerRowCount` after a row insert/delete so it keeps naming the
 * leading contiguous block (spec §7.1). `rowIndex` is the grid row the edit
 * targets (the inserted row's destination index, or the deleted row's index).
 *
 *   - DELETE at `r < count`  → `count − 1` (a header row was removed; deleting the
 *     last header row of a `count === 1` table yields `0` — the header turns OFF,
 *     no body row is promoted).
 *   - DELETE at `r ≥ count`  → `count` (a body row went; header unchanged).
 *   - INSERT at `r < count`  → `count + 1` (the new row lands strictly inside the
 *     header band, extending it).
 *   - INSERT at `r === count` → `count` (AT the boundary = a body row; Google-Docs
 *     semantics — a row inserted below the last pinned row is not itself pinned).
 *   - INSERT at `r > count`  → `count` (a body row; header unchanged).
 *
 * The §7.1 by-construction proof shows these rules map a clean state to a clean
 * state, so no `largestCleanHeaderCount` re-validation is needed after a row edit.
 * The invariant `0 ≤ result ≤ newRowCount` holds by construction.
 */
export function adjustHeaderRowCount(count: number, op: RowEditOp, rowIndex: number): number {
  if (op === "delete") {
    return rowIndex < count ? count - 1 : count;
  }
  return rowIndex < count ? count + 1 : count;
}

/**
 * Compute the table's new attrs bag after a row insert/delete at grid row
 * `rowIndex` keeps `headerRowCount` naming the leading contiguous block, or `null`
 * when the count is unchanged (so the caller writes nothing). Reads the table's
 * current `headerRowCount` from the PRE-mutation `state` (absent ⇒ 0); the
 * §7.1 by-construction proof means no clean-cut re-validation is needed.
 *
 * Returns the FULL replace-bag (`headerRowCount` spliced in, or the key dropped
 * when the adjusted count is 0) so the caller can `setBlockAttrsInTx`. The other
 * table ops compute their `columnWidths` attr the same plan-time way.
 */
export function headerRowAttrsAfterRowEdit(
  state: State,
  tableId: BlockId,
  op: RowEditOp,
  rowIndex: number,
): ReadonlyAttrs | null {
  const table = getBlock(state, tableId);
  if (table === null) return null;
  const current = readHeaderRowCount(table.attrs);
  const next = adjustHeaderRowCount(current, op, rowIndex);
  if (next === current) return null;
  return withHeaderRowCount(table.attrs, next);
}

/** A table's current `headerRowCount` (a positive integer; absent/invalid ⇒ 0). */
export function readHeaderRowCount(attrs: ReadonlyAttrs): number {
  const v = attrs.headerRowCount;
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 0;
}

/** A copy of `attrs` with `headerRowCount` set to `count` (key dropped when 0). */
export function withHeaderRowCount(attrs: ReadonlyAttrs, count: number): ReadonlyAttrs {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "headerRowCount") continue;
    next[k] = v;
  }
  if (count > 0) next.headerRowCount = count;
  return next;
}
