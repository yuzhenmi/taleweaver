// ---------------------------------------------------------------------------
// CSS Tables 3 §17.4 — span-aware auto-layout column min/max content widths
// ---------------------------------------------------------------------------
//
// Both intrinsic walks (the Table FC's `collectIntrinsicSizes` and the
// intrinsic-sizes pass's `computeTableIntrinsicSizes`) feed per-cell intrinsic
// sizes — keyed by the cell's grid placement (from `assignTableGrid`) — into
// this one distributor so they agree on how a colSpan>1 cell contributes to the
// columns it spans. Pure: integers/floats in, arrays out; no geometry, no px.

/** One cell's intrinsic contribution, keyed by its resolved grid placement. */
export interface SpannedCellIntrinsic {
  readonly gridCol: number;
  readonly colSpan: number;
  /** min-content width of the cell's contents. */
  readonly min: number;
  /** max-content width of the cell's contents. */
  readonly max: number;
}

export interface ColumnIntrinsics {
  /** Per-column min-content width; length === columnCount. */
  readonly colMins: number[];
  /** Per-column max-content width; length === columnCount. */
  readonly colMaxes: number[];
}

/**
 * Grow `target[from..to)` so its sum reaches `required`, distributing any
 * shortfall proportionally to `weights[from..to)` (even split when every weight
 * in the span is zero). No-op when the slice already sums to ≥ required.
 *
 * `weights` may alias `target` (the max-distribution case): the per-column share
 * is computed from `weightSum` snapshotted before any write, and each
 * `weights[c]` is read once in the same iteration that writes `target[c]`, so
 * the aliasing is safe.
 */
function distributeShortfall(
  target: number[],
  weights: readonly number[],
  from: number,
  to: number,
  required: number,
): void {
  let current = 0;
  for (let c = from; c < to; c++) current += target[c] ?? 0;
  const shortfall = required - current;
  if (shortfall <= 0) return;

  let weightSum = 0;
  for (let c = from; c < to; c++) weightSum += weights[c] ?? 0;
  const span = to - from;

  for (let c = from; c < to; c++) {
    const share =
      weightSum > 0 ? shortfall * ((weights[c] ?? 0) / weightSum) : shortfall / span;
    target[c] = (target[c] ?? 0) + share;
  }
}

/**
 * CSS Tables §17.4 auto-layout per-column min/max from per-cell intrinsic sizes.
 *
 * 1. Non-spanning (colSpan===1) cells set each column's base = max over its
 *    cells, exactly as the legacy sequential walk did for span-1 tables.
 * 2. Spanning (colSpan>1) cells, processed narrowest-span-first, ensure the sum
 *    of the columns they span is at least the cell's min/max; any shortfall is
 *    distributed across the spanned columns (proportional to current max-width,
 *    even split when all are zero). Narrowest-first so tighter constraints bound
 *    the columns before wider spans distribute over them.
 * 3. Each column's max is floored to its min (a column is never narrower at
 *    max-content than at min-content).
 */
export function distributeColumnIntrinsics(
  cells: readonly SpannedCellIntrinsic[],
  columnCount: number,
): ColumnIntrinsics {
  const colMins = new Array<number>(Math.max(columnCount, 0)).fill(0);
  const colMaxes = new Array<number>(Math.max(columnCount, 0)).fill(0);

  // Pass 1 — non-spanning cells set the per-column base.
  for (const cell of cells) {
    if (cell.colSpan !== 1) continue;
    const c = cell.gridCol;
    if (c < 0 || c >= columnCount) continue;
    colMins[c] = Math.max(colMins[c] ?? 0, cell.min);
    colMaxes[c] = Math.max(colMaxes[c] ?? 0, cell.max);
  }

  // Pass 2 — spanning cells, narrowest span first.
  const spanning = cells
    .filter((c) => c.colSpan > 1)
    .slice()
    .sort((a, b) => a.colSpan - b.colSpan);

  for (const cell of spanning) {
    const from = cell.gridCol;
    const to = Math.min(cell.gridCol + cell.colSpan, columnCount);
    if (to <= from) continue;
    distributeShortfall(colMins, colMaxes, from, to, cell.min);
    distributeShortfall(colMaxes, colMaxes, from, to, cell.max);
    for (let c = from; c < to; c++) {
      if ((colMaxes[c] ?? 0) < (colMins[c] ?? 0)) colMaxes[c] = colMins[c] ?? 0;
    }
  }

  return { colMins, colMaxes };
}
