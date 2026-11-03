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
 */
import * as Y from "yjs";
import type { BlockId } from "../../block";
import type { TableCellInfo, TableRowInfo, TableState, TableTrack, TreeKind } from "../../document/types";
import { cellId } from "../../ids";
import { typeId } from "../../storage/item-id";
import { COLS_KEY, HEADER_KEY, ROWS_KEY, TRACK_KEY, WEIGHT_KEY } from "../../storage/keys";
import { scalarsWithPrefix } from "../../storage/map-reads";
import { cellAttrPrefix, cellFlowOf, colSpanKey, rowSpanKey } from "../../storage/table-keys";

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

/** R7: the index a span key names, when it is at or after `from`; else `from` (a span of 1). */
function spanEnd(v: unknown, index: ReadonlyMap<string, number>, from: number): number {
  const e = typeof v === "string" ? index.get(v) : undefined;
  return e !== undefined && e >= from ? e : from;
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

/** R6h. */
function headerCountOf(rows: readonly TableRowInfo[], cells: readonly TableCellInfo[]): number {
  let h = 0;
  while (h < rows.length && rows[h]?.header === true) h++;
  if (h === 0) return 0;
  const crossed = new Set<number>();
  for (const c of cells) for (let b = c.row + 1; b < c.row + c.rowSpan; b++) crossed.add(b);
  while (h > 0 && crossed.has(h)) h--;
  return h;
}

function cellAttrs(row: Y.Map<unknown>, col: string, rowSpan: number, colSpan: number): Readonly<Record<string, unknown>> {
  const a = scalarsWithPrefix(row, cellAttrPrefix(col));
  delete a["rowSpan"];
  delete a["colSpan"];
  if (rowSpan > 1) a["rowSpan"] = rowSpan;
  if (colSpan > 1) a["colSpan"] = colSpan;
  return Object.freeze(a);
}

/** Read table `id` (its map `map`, in `tree`) by R6–R8, R10 and R6h. */
export function readTable(id: BlockId, map: Y.Map<unknown>, tree: TreeKind): TableState {
  const rows: TableRowInfo[] = [];
  for (const t of tracksOf(map.get(ROWS_KEY))) {
    const rowId = typeId(t.map);
    if (rowId !== null) rows.push({ ...t, id: rowId, header: t.map.get(HEADER_KEY) === true });
  }
  const cols = tracksOf(map.get(COLS_KEY));
  const R = cols.length === 0 ? 0 : rows.length;
  const C = cols.length;
  const rowIndex = new Map(rows.map((r, i) => [r.key, i]));
  const colIndex = new Map(cols.map((c, i) => [c.key, i]));
  // Slot `r * C + c` → the index in `cells` of the cell covering it (R8: covered slots have no cell of their own).
  const slots: number[] = new Array<number>(R * C).fill(-1);
  const cells: TableCellInfo[] = [];
  // ponytail: a rejected (overlapping) rectangle is scanned until its first taken slot. Admitted
  // rectangles overlapping a later anchor must cover its row, so adversarial concurrent spans cost
  // O(R·C²) worst case (upgrade: a per-row occupancy bitmap). Commands never write overlaps.
  const free = (r0: number, c0: number, r1: number, c1: number): boolean => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (slots[r * C + c] !== -1) return false;
    return true;
  };
  for (let r = 0; r < R; r++) {
    const row = rows[r];
    if (row === undefined) continue;
    for (let c = 0; c < C; c++) {
      const col = cols[c];
      if (col === undefined || slots[r * C + c] !== -1) continue;
      let r1 = spanEnd(row.map.get(rowSpanKey(col.key)), rowIndex, r);
      let c1 = spanEnd(row.map.get(colSpanKey(col.key)), colIndex, c);
      if ((r1 > r || c1 > c) && !free(r, c, r1, c1)) {
        r1 = r;
        c1 = c;
      }
      for (let i = r; i <= r1; i++) for (let j = c; j <= c1; j++) slots[i * C + j] = cells.length;
      const rowSpan = r1 - r + 1;
      const colSpan = c1 - c + 1;
      cells.push({
        id: cellId(id, row.key, col.key),
        row: r,
        col: c,
        rowSpan,
        colSpan,
        flow: cellFlowOf(row.map, col.key),
        attrs: cellAttrs(row.map, col.key, rowSpan, colSpan),
      });
    }
  }
  return {
    id,
    map,
    tree,
    rows,
    cols,
    cells,
    headerCount: R === 0 ? 0 : headerCountOf(rows, cells),
    widths: widthsOf(cols),
  };
}
