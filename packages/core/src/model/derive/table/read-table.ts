/**
 * The table read rules (r7 §4, plan P2 §2). Total: any storage reads as a rectangular
 * grid; nothing is rewritten.
 *   - R6 tracks: rows / columns are the live `Y.Map` items of `rows` / `cols` with a
 *     string `key`; a later duplicate key is ignored (X7); non-map items and keyless
 *     maps are ignored. A slot's content is `c:<col>:flow` when it is a `Y.Array`,
 *     else one empty default paragraph (X4). Cell attrs are `c:<col>:a:*`; keys of a
 *     column that does not exist are never read. A table with no row or no column
 *     has no rows / cells.
 *   - R7 spans: anchors are processed row-major, skipping covered slots. `rowSpanTo` /
 *     `colSpanTo` name the row / column the span ends at, which must be at or after
 *     the anchor; anything else spans 1. A rectangle overlapping an admitted one reads 1×1.
 *   - R8: a covered slot has no cell (no record, no flow, no attrs).
 *   - R10 widths: a weight is valid when it is a finite number > 0; a missing / invalid
 *     one is the mean of the valid ones; all are normalised to sum 1. No valid weight:
 *     no widths (auto layout).
 *   - R6h header band: the largest h ≤ the leading run of rows with `header === true`
 *     such that no admitted span crosses the boundary after row h.
 * Track keys holding `:` alias attr prefixes across columns (`c:x:a:a:k`); that read is
 * deterministic, and commands write base36 keys only.
 *
 * Span-local: with the previous state, rows not touched keep their read and cells, and
 * only a band of rows (`band.ts`) is re-admitted.
 * ponytail: O(R) pointer / integer work per structural event (the R6 re-read, the index
 * maps, the `rowCells` copy); a persistent order-statistic tree makes it O(span · log R).
 */
import * as Y from "yjs";
import type { BlockId } from "../../block";
import type { SpanRequest, TableCellInfo, TableRowInfo, TableState, TableTrack, TreeKind } from "../../document/types";
import { typeId } from "../../storage/item-id";
import { COLS_KEY, HEADER_KEY, ROWS_KEY, TRACK_KEY, WEIGHT_KEY } from "../../storage/keys";
import { scalarsWithPrefix } from "../../storage/map-reads";
import { cellAttrPrefix, colSpanKey, rowSpanKey } from "../../storage/table-keys";
import { type RowRange, admitRows, candidateRanges, closeBand } from "./band";

/** R6: the live, keyed, first-of-their-key maps of a track array. */
function tracksOf(v: unknown): TableTrack[] {
  const out: TableTrack[] = [];
  if (!(v instanceof Y.Array)) return out;
  const seen = new Set<string>();
  v.toArray().forEach((m: unknown) => {
    if (!(m instanceof Y.Map)) return;
    const key: unknown = m.get(TRACK_KEY);
    if (typeof key !== "string" || seen.has(key)) return;
    seen.add(key);
    out.push({ key, map: m });
  });
  return out;
}

const NO_SPANS: ReadonlyMap<string, SpanRequest> = new Map();

/** A RowMap's read (null: no string `key` or detached): its span keys for `cols`. */
function readRow(m: Y.Map<unknown>, cols: readonly TableTrack[]): TableRowInfo | null {
  const key: unknown = m.get(TRACK_KEY);
  const id = typeId(m);
  if (typeof key !== "string" || id === null) return null;
  let spans: Map<string, SpanRequest> | null = null;
  for (const col of cols) {
    const rowTo: unknown = m.get(rowSpanKey(col.key));
    const colTo: unknown = m.get(colSpanKey(col.key));
    if (rowTo === undefined && colTo === undefined) continue;
    spans ??= new Map();
    spans.set(col.key, { rowTo, colTo });
  }
  return { key, map: m, id, header: m.get(HEADER_KEY) === true, spans: spans ?? NO_SPANS };
}

const isWeight = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** R10. */
function widthsOf(cols: readonly TableTrack[]): readonly number[] | null {
  const ws: unknown[] = cols.map((c) => c.map.get(WEIGHT_KEY));
  const valid = ws.filter(isWeight);
  if (valid.length === 0) return null;
  const mean = valid.reduce((s, w) => s + w, 0) / valid.length;
  const filled = ws.map((w) => (isWeight(w) ? w : mean));
  const total = filled.reduce((s, w) => s + w, 0);
  return Object.freeze(filled.map((w) => w / total));
}

/** R6h: only anchors above the leading run can cross a boundary inside it. */
function headerCountOf(rows: readonly TableRowInfo[], rowCells: readonly (readonly TableCellInfo[])[]): number {
  let h = 0;
  while (h < rowCells.length && rows[h]?.header === true) h++;
  if (h === 0) return 0;
  const crossed = new Set<number>();
  for (let r = 0; r < h; r++) for (const c of rowCells[r] ?? []) for (let b = r + 1; b < r + c.rowSpan; b++) crossed.add(b);
  while (h > 0 && crossed.has(h)) h--;
  return h;
}

/** A cell record's attrs: `c:<col>:a:*`, with `rowSpan` / `colSpan` set only when > 1. */
export function cellAttrs(row: Y.Map<unknown>, col: string, rowSpan: number, colSpan: number): Readonly<Record<string, unknown>> {
  const a = scalarsWithPrefix(row, cellAttrPrefix(col));
  delete a["rowSpan"];
  delete a["colSpan"];
  if (rowSpan > 1) a["rowSpan"] = rowSpan;
  if (colSpan > 1) a["colSpan"] = colSpan;
  return Object.freeze(a);
}

/** An old cell a regrid may rewrite or remove: its RowMap and its sibling cells then. */
export interface PriorCell {
  readonly row: Y.Map<unknown>;
  readonly cell: TableCellInfo;
  readonly prev: BlockId | null;
  readonly next: BlockId | null;
}

export interface TableRead {
  readonly ts: TableState;
  /** Rows (new indices) whose cells and records are (re)written. */
  readonly band: readonly number[];
  /** The old cells of the band's rows and of rows no longer rendered. */
  readonly prior: ReadonlyMap<BlockId, PriorCell>;
  /** Old rendered rows no longer rendered. */
  readonly goneRows: readonly BlockId[];
}

/**
 * Read table `id` (its map `map`, in `tree`) by R6–R8, R10 and R6h. `old`: its previous
 * state, if any; `touched`: RowMaps whose grid keys (key, header, spans, `a:*`) changed.
 */
export function readTable(old: TableState | undefined, id: BlockId, map: Y.Map<unknown>, tree: TreeKind, touched: ReadonlySet<Y.Map<unknown>>): TableRead {
  const cols = tracksOf(map.get(COLS_KEY));
  const C = cols.length;
  const oldR = old === undefined ? 0 : old.rowCells.length;
  // Rows keep their read (span keys are read per column) only while the columns are the same.
  const sameCols = old !== undefined && old.cols.length === C && old.cols.every((c, i) => c.map === cols[i]?.map && c.key === cols[i]?.key);
  const base = sameCols && oldR > 0 ? old : undefined;
  const oldAt = new Map<Y.Map<unknown>, number>();
  base?.rows.forEach((r, j) => oldAt.set(r.map, j));

  // R6, re-read whole: a row keeps its read unless it is new to the grid or touched.
  const rows: TableRowInfo[] = [];
  const from: number[] = []; // the old index of the same RowMap, or -1
  const reread: boolean[] = [];
  const seen = new Set<string>();
  const arr: unknown = map.get(ROWS_KEY);
  for (const m of arr instanceof Y.Array ? arr.toArray() : []) {
    if (!(m instanceof Y.Map)) continue;
    const j = oldAt.get(m);
    const kept = j === undefined || touched.has(m) ? undefined : base?.rows[j];
    const info = kept ?? readRow(m, cols);
    if (info === null || seen.has(info.key)) continue;
    seen.add(info.key);
    rows.push(info);
    from.push(j ?? -1);
    reread.push(kept === undefined);
  }
  const R = C === 0 ? 0 : rows.length;
  const rowIndex = new Map(rows.map((r, i) => [r.key, i]));
  const colIndex = new Map(cols.map((c, i) => [c.key, i]));

  // The band: new / touched rows and their neighbours, the rows around a removed one; closed (band.ts).
  const inBand = new Uint8Array(R);
  const newOf = new Int32Array(oldR).fill(-1);
  if (base === undefined) inBand.fill(1);
  else {
    const mark = (r: number): void => {
      if (r >= 0 && r < R) inBand[r] = 1;
    };
    let prev = -1;
    for (let i = 0; i < R; i++) {
      const j = from[i] ?? -1;
      if (j >= 0) {
        newOf[j] = i;
        if (j !== prev + 1) {
          mark(i - 1);
          mark(i);
        }
        prev = j;
      }
      if (reread[i] === true) for (let k = i - 1; k <= i + 1; k++) mark(k);
    }
    if (prev !== oldR - 1) mark(R - 1);
    const ranges: RowRange[] = candidateRanges(rows, R, rowIndex, colIndex);
    base.rows.forEach((row, j) => {
      if (row.spans.size === 0) return;
      for (const cell of base.rowCells[j] ?? []) {
        if (cell.rowSpan < 2) continue;
        let a = j;
        let b = j + cell.rowSpan - 1;
        while (a <= b && (newOf[a] ?? -1) < 0) a++;
        while (b >= a && (newOf[b] ?? -1) < 0) b--;
        const na = newOf[a] ?? -1;
        const nb = newOf[b] ?? -1;
        if (a <= b && na >= 0 && nb >= 0) ranges.push([na, nb]);
      }
    });
    closeBand(inBand, ranges);
  }

  const rowCells: (readonly TableCellInfo[])[] = [];
  for (let lo = 0; lo < R; ) {
    if (inBand[lo] !== 1) {
      const cells = base?.rowCells[from[lo] ?? -1];
      if (cells === undefined) throw new Error(`model: table ${id} row ${lo} kept without an old read`);
      rowCells.push(cells);
      lo++;
      continue;
    }
    let hi = lo;
    while (hi + 1 < R && inBand[hi + 1] === 1) hi++;
    admitRows(id, rows, cols, rowIndex, colIndex, lo, hi, rowCells);
    lo = hi + 1;
  }

  // What the writes diff against: the old cells of band rows and of rows no longer rendered.
  const live = new Set<BlockId>();
  for (let i = 0; i < R; i++) {
    const row = rows[i];
    if (row !== undefined) live.add(row.id);
  }
  const prior = new Map<BlockId, PriorCell>();
  const goneRows: BlockId[] = [];
  for (let j = 0; j < oldR; j++) {
    const row = old?.rows[j];
    const cells = old?.rowCells[j];
    if (row === undefined || cells === undefined) continue;
    const i = base === undefined ? -1 : (newOf[j] ?? -1);
    if (i >= 0 && inBand[i] !== 1) continue;
    if (!live.has(row.id)) goneRows.push(row.id);
    cells.forEach((cell, k) => prior.set(cell.id, { row: row.map, cell, prev: cells[k - 1]?.id ?? null, next: cells[k + 1]?.id ?? null }));
  }

  const band: number[] = [];
  for (let i = 0; i < R; i++) if (inBand[i] === 1) band.push(i);
  const ts: TableState = { id, map, tree, rows, cols, rowIndex, colIndex, rowCells, headerCount: headerCountOf(rows, rowCells), widths: widthsOf(cols) };
  return { ts, band, prior, goneRows };
}
