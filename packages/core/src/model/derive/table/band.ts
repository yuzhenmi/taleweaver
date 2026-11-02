/**
 * R7 / R8 over a BAND of rows (span-local regrid). The band is closed under every
 * rectangle that intersects it: the new candidates (each anchor's span keys, resolved
 * against the new track indices) and the previously admitted rectangles. No candidate
 * then crosses the band's boundary, and admission is row-major with each anchor
 * depending only on earlier admitted rectangles intersecting it, so admitting the band
 * alone reads exactly as admitting the whole table (from scratch: the band is every row).
 */
import type { BlockId } from "../../block";
import type { TableCellInfo, TableRowInfo, TableTrack } from "../../document/types";
import { cellId } from "../../ids";

/** R7: the index a span key names, when it is at or after `from`; else `from` (a span of 1). */
export function spanEnd(v: unknown, index: ReadonlyMap<string, number>, from: number): number {
  const e = typeof v === "string" ? index.get(v) : undefined;
  return e !== undefined && e >= from ? e : from;
}

/** Row ranges `[a, b]` (inclusive) of rectangles spanning more than one row. */
export type RowRange = readonly [number, number];

/** The rows of every new candidate rectangle spanning more than one row. */
export function candidateRanges(rows: readonly TableRowInfo[], R: number, rowIndex: ReadonlyMap<string, number>, colIndex: ReadonlyMap<string, number>): RowRange[] {
  const out: RowRange[] = [];
  for (let r = 0; r < R; r++) {
    const row = rows[r];
    if (row === undefined) continue;
    for (const [col, req] of row.spans) {
      if (!colIndex.has(col)) continue;
      const r1 = spanEnd(req.rowTo, rowIndex, r);
      if (r1 > r) out.push([r, r1]);
    }
  }
  return out;
}

/**
 * Close `inBand` under `ranges`: a range with a row in the band joins it whole. Ranges
 * sharing a row chain into one component whose union is its hull, and hulls of distinct
 * components are disjoint, so one sweep fills each hull meeting the band: O(n log n + R).
 * ponytail: spans chaining through every row make the band the whole table (O(R·C) admission);
 * upgrade: re-admit from the seed in row order and stop once a row's admission matches the old
 * one with no rectangle carrying into the next row.
 */
export function closeBand(inBand: Uint8Array, ranges: readonly RowRange[]): void {
  const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
  const fill = (a: number, b: number): void => {
    if (inBand.subarray(a, b + 1).includes(1)) inBand.fill(1, a, b + 1);
  };
  let a = -1;
  let b = -1;
  for (const [x, y] of sorted) {
    if (x <= b) {
      b = Math.max(b, y);
      continue;
    }
    if (a >= 0) fill(a, b);
    a = x;
    b = y;
  }
  if (a >= 0) fill(a, b);
}

/** R7 / R8: the cells of rows `lo..hi` (a maximal band interval), into `out[r]`. */
export function admitRows(
  tableId: BlockId,
  rows: readonly TableRowInfo[],
  cols: readonly TableTrack[],
  rowIndex: ReadonlyMap<string, number>,
  colIndex: ReadonlyMap<string, number>,
  lo: number,
  hi: number,
  out: (readonly TableCellInfo[])[],
): void {
  const C = cols.length;
  // Slot `(r - lo) * C + c` is taken (R8: covered slots have no cell of their own).
  const taken = new Uint8Array((hi - lo + 1) * C);
  // ponytail: a rejected (overlapping) rectangle is scanned until its first taken slot. Admitted
  // rectangles overlapping a later anchor must cover its row, so adversarial concurrent spans cost
  // O(R·C²) worst case (upgrade: a per-row occupancy bitmap). Commands never write overlaps.
  const free = (r0: number, c0: number, r1: number, c1: number): boolean => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (taken[(r - lo) * C + c] === 1) return false;
    return true;
  };
  for (let r = lo; r <= hi; r++) {
    const row = rows[r];
    if (row === undefined) continue;
    const cells: TableCellInfo[] = [];
    for (let c = 0; c < C; c++) {
      const col = cols[c];
      if (col === undefined || taken[(r - lo) * C + c] === 1) continue;
      const req = row.spans.get(col.key);
      let r1 = req === undefined ? r : spanEnd(req.rowTo, rowIndex, r);
      let c1 = req === undefined ? c : spanEnd(req.colTo, colIndex, c);
      if (r1 > hi) throw new Error(`model: table ${tableId} span leaves its regrid band`);
      if ((r1 > r || c1 > c) && !free(r, c, r1, c1)) {
        r1 = r;
        c1 = c;
      }
      for (let i = r; i <= r1; i++) taken.fill(1, (i - lo) * C + c, (i - lo) * C + c1 + 1);
      cells.push({ id: cellId(tableId, row.key, col.key), colKey: col.key, rowSpan: r1 - r + 1, colSpan: c1 - c + 1 });
    }
    out[r] = cells;
  }
}
