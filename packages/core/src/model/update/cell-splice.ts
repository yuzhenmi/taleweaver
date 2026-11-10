/**
 * Rung 1c of the structural incremental update (N4b design note, mechanism 3): a transaction's regions that insert /
 * delete WHOLE CELLS of a table's rows (a column insert / delete: one cell per row), applied as one batch per table in
 * O(rows re-placed + cells changed). No row is re-parsed; no unchanged cell is re-written.
 *
 * A region applies when its old and new spans are whole cells of one row at the table's depth dT: L is the row's
 * `⟨r⟩` or a cell's last terminator, R a `⟨c⟩` / `⟨r⟩` / `⟧` of depth dT, and the new span parses (row mode, seeded
 * inside the row) into whole cells. The consecutive such regions of one table form the batch. One forward pass over
 * its rows from the first touched one: a touched row's cells are spliced and re-placed from its stored carry in (F4);
 * an untouched row is re-placed only while its carry in changed, else the pass jumps to the next touched row.
 * Re-placed rows' records: cells no longer read go (with the footnote bodies they anchor), new cells are written, kept
 * cells re-linked (their spans re-put only when the output changed), virtual end cells follow the free slots. A changed
 * column count re-links every other row (`relink-row.ts`) and re-reads RT3. The row ids never change.
 *
 * Declines (the caller tries rung 1) for anything else: a row with content read outside its cells' marks (a lead, a
 * cell past the column cap) touched or re-placed, content joining above, a span not ending at the row's cell
 * boundaries, a new row or the table's end in it, a cell-less nested table's leads, a table left with no column.
 */
import { BLOCK_TYPES, type BlockId } from "../block";
import { deriveFootnote, parasOf, removeFlow, writeCell } from "../derive/derive-flow";
import { isBlockEntity } from "../derive/entities";
import { type ParsedCell, cellEnts, gridCellOf, spanOf, widthsOf } from "../derive/table/form-table";
import { RegionParser } from "../derive/table/parse-tables";
import { type RowForm, type TableForm, columnCountOf, headerCountOf } from "../derive/table/table-form";
import type { Working } from "../derive/working";
import type { FlowState } from "../document/types";
import { footnoteBodyId, virtualCellId } from "../ids";
import { type FootnoteRef, type Segment, type TerminatorToken, type Token, depthOf, roleOf } from "../scan/tokens";
import { TABLE_COLUMN_CAP } from "../storage/limits";
import { type GridCell, placeRow } from "../../table-grid/assign-table-grid";
import { type Anchor, type Pos, between } from "./anchors";
import type { Splice } from "./piece-splice";
import { type Region, oldPosOf } from "./regions";
import { relinkRow, writeVirtualCell } from "./relink-row";
import { sameCarry, subtree } from "./row-splice";

export interface CellSpliceInput {
  readonly w: Working;
  readonly fs: FlowState;
  readonly oldScans: readonly Segment[];
  readonly newScans: readonly Segment[];
  readonly newIdx: FlowState["segIndex"];
  /** The transaction's splices, with `n1s[i]` the new index of splice i's first segment (old ↔ new positions). */
  readonly splices: readonly Splice[];
  readonly n1s: readonly number[];
  readonly regions: readonly Region[];
  /** The region rung 0 declined: the batch's first. */
  readonly first: number;
  /** Folds the marks `inert` of segments `[p0, p1]` (deferred by the caller). */
  readonly fold: (p0: number, p1: number, inert: ReadonlySet<BlockId>) => void;
}

/** One region: in row `row`, the cells `removed` after cell `after` (null: at the row's start) became `added`. */
interface CellEdit {
  readonly tableId: BlockId;
  readonly row: number;
  readonly after: BlockId | null;
  readonly removed: readonly BlockId[];
  /** R's cell when R is a `⟨c⟩`; null when R ends the row. */
  readonly before: BlockId | null;
  readonly added: readonly ParsedCell[];
  readonly parser: RegionParser;
  readonly L: Anchor;
  readonly R: Anchor;
}

/**
 * Try rung 1c on the regions from `first`. When it applied them (the flow state is written): the R of the last one
 * (every region up to it is applied). Else null, nothing written.
 */
export function cellSplice(inp: CellSpliceInput): Pos | null {
  const edits: CellEdit[] = [];
  for (let i = inp.first; i < inp.regions.length; i++) {
    const rg = inp.regions[i];
    const e = rg === undefined ? null : cellEdit(inp, rg);
    if (e === null || (edits[0] !== undefined && e.tableId !== edits[0].tableId)) break;
    edits.push(e);
  }
  const last = edits[edits.length - 1];
  return last !== undefined && applyEdits(inp, last.tableId, edits) ? last.R : null;
}

const isMark = (t: Token): t is TerminatorToken => t.k !== "run" && t.mark !== undefined;

/** A `⟨c⟩` of depth `d`. */
const isCellMark = (t: Token, d: number): boolean => isMark(t) && depthOf(t) === d && roleOf(t) === "newCell";

/** A region as a cell edit (records and forms read, nothing written); null when it is not whole cells of one row. */
function cellEdit(inp: CellSpliceInput, { L, R }: Region): CellEdit | null {
  const { w, fs } = inp;
  const tree = fs.tree;
  if (L === null || R === null || fs.leadsAfter.has(L.tok.id)) return null;
  // L: a row's `⟨r⟩`, an empty cell's `⟨c⟩`, or a terminator (no mark) whose record is in a cell.
  const lRole = roleOf(L.tok);
  let rowId: BlockId | null;
  let after: BlockId | null = null;
  if (lRole === "newRow") rowId = L.tok.id;
  else {
    if (isMark(L.tok) && lRole !== "newCell") return null;
    after = lRole === "newCell" ? L.tok.id : (w.get(tree, L.tok.id)?.parentId ?? null);
    const cell = after === null ? undefined : w.get(tree, after);
    if (cell?.type !== BLOCK_TYPES.tableCell) return null;
    rowId = cell.parentId;
  }
  const tableId = rowId === null ? null : (w.get(tree, rowId)?.parentId ?? null);
  const form = tableId === null ? undefined : fs.tables.get(tableId);
  const row = rowId === null || form === undefined ? undefined : form.rowIndex.get(rowId);
  const rowForm = row === undefined ? undefined : form?.rows[row];
  if (tableId === null || rowId === null || form === undefined || row === undefined || rowForm === undefined) return null;
  const dT = form.depth;
  if (isMark(L.tok) && depthOf(L.tok) !== dT) return null;
  // R: a mark of depth dT ending cells of that row.
  const rRole = roleOf(R.tok);
  const endsRow = (rRole === "newRow" && form.rowIndex.get(R.tok.id) === row + 1) || (rRole === "close" && R.tok.id === form.closeId && row === form.rows.length - 1);
  if (depthOf(R.tok) !== dT || (rRole !== "newCell" && !endsRow)) return null;
  // The old span: whole cells of the row (their `⟨c⟩`s are the only marks of depth ≤ dT).
  const oldL = oldPosOf(inp.splices, inp.n1s, L);
  const oldR = oldPosOf(inp.splices, inp.n1s, R);
  if (oldL === null || oldR === null) return null;
  const removed: BlockId[] = [];
  let first = true;
  for (const t of between(inp.oldScans, oldL, oldR, false)) {
    const cellMark = isCellMark(t, dT);
    if (first && !cellMark) return null;
    first = false;
    if (cellMark && isMark(t)) removed.push(t.id);
    else if (isMark(t) && roleOf(t) !== null && (depthOf(t) ?? dT + 1) <= dT) return null;
  }
  // The new span: whole cells (its first token a `⟨c⟩` of depth dT; no new row, no table end).
  const parser = new RegionParser(fs.holderId, dT, { table: { id: tableId, map: form.map, row: { id: rowId, map: rowForm.map } }, rescanned: true });
  first = true;
  for (const t of between(inp.newScans, L, R, false)) {
    if (first && !isCellMark(t, dT)) return null;
    first = false;
    if (!parser.push(t)) return null;
  }
  const parsed = parser.endRows(R.tok.id);
  const only = parsed?.rows.length === 1 ? parsed.rows[0] : undefined;
  if (only === undefined || only.lead.length > 0 || parser.leadsAfter.size > 0) return null;
  return { tableId, row, after, removed, before: rRole === "newCell" ? R.tok.id : null, added: only.cells, parser, L, R };
}

/** A re-placed row's output cell: real (placed) or virtual (a free slot). */
interface OutCell {
  readonly id: BlockId;
  readonly col: number;
  readonly rowSpan: number;
  readonly colSpan: number;
  readonly virtual: boolean;
}

/** Row `f` (grid row `r` of `rowCount`) read over `columnCount` columns, in column order. */
function outputOf(f: RowForm, r: number, rowCount: number, columnCount: number, nextMark: BlockId): OutCell[] {
  const out: OutCell[] = [];
  const taken: boolean[] = [];
  for (const p of f.placed) {
    out.push({ id: p.cellId, col: p.gridCol, rowSpan: Math.min(p.rowSpan, rowCount - r), colSpan: p.colSpan, virtual: false });
    for (let c = p.gridCol; c < p.gridCol + p.colSpan; c++) taken[c] = true;
  }
  for (let col = 0; col < columnCount; col++) {
    if (f.carryIn[col] === undefined && taken[col] !== true) out.push({ id: virtualCellId(nextMark, col), col, rowSpan: 1, colSpan: 1, virtual: true });
  }
  return out.sort((a, b) => a.col - b.col);
}

function applyEdits(inp: CellSpliceInput, tableId: BlockId, edits: readonly CellEdit[]): boolean {
  const { w, fs } = inp;
  const tree = fs.tree;
  const form = fs.tables.get(tableId);
  if (form === undefined || form.joinsAbove > 0 || columnCountOf(form) === 0) return false;

  // 1. Each touched row's cells, spliced (the regions are in flow order: left to right within a row).
  const lists = new Map<number, GridCell[]>();
  for (const e of edits) {
    const rf = form.rows[e.row];
    if (rf === undefined || rf.outside) return false;
    let list = lists.get(e.row);
    if (list === undefined) {
      list = rf.cells.slice();
      lists.set(e.row, list);
    }
    const a = e.after === null ? 0 : list.findIndex((c) => c.cellId === e.after) + 1;
    if (e.after !== null && a === 0) return false;
    if (e.removed.some((id, k) => list[a + k]?.cellId !== id)) return false;
    const b = a + e.removed.length;
    if (e.before === null ? b !== list.length : list[b]?.cellId !== e.before) return false;
    list.splice(a, e.removed.length, ...e.added.map(gridCellOf));
  }

  // 2. The forward pass (F4): touched rows, and untouched ones while their carry in changed, are re-placed.
  const touched = [...lists.keys()].sort((x, y) => x - y);
  const R = form.rows.length;
  const placed = new Map<number, RowForm>();
  let ti = 0;
  let r = touched[0] ?? R;
  let carry = form.rows[r]?.carryIn ?? form.endCarry;
  while (r < R) {
    const old = form.rows[r];
    if (old === undefined) return false;
    const list = lists.get(r);
    if (list === undefined && sameCarry(carry, old.carryIn)) {
      while (ti < touched.length && (touched[ti] ?? R) <= r) ti++;
      const nt = touched[ti];
      const nf = nt === undefined ? undefined : form.rows[nt];
      if (nt === undefined || nf === undefined) break;
      r = nt;
      carry = nf.carryIn;
      continue;
    }
    if (old.outside) return false;
    const cells = list ?? old.cells;
    const pr = placeRow(carry, cells, TABLE_COLUMN_CAP);
    if (pr.overflow.length > 0) return false;
    placed.set(r, { ...old, carryIn: carry, cells, placed: pr.placed, width: pr.width });
    carry = pr.carryOut;
    r++;
  }
  const widthCount = form.widthCount.slice();
  const rows = form.rows.slice();
  for (const [i, f] of placed) {
    const ow = form.rows[i]?.width ?? 0;
    widthCount[ow] = (widthCount[ow] ?? 0) - 1;
    widthCount[f.width] = (widthCount[f.width] ?? 0) + 1;
    rows[i] = f;
  }
  const next: TableForm = { ...form, rows, endCarry: r >= R ? carry : form.endCarry, widthCount };
  const oldCount = columnCountOf(form);
  const count = columnCountOf(next);
  if (count === 0) return false;

  // 3. Records. Every check is done: from here on the batch applies.
  const nextMark = (i: number): BlockId => form.rows[i + 1]?.id ?? form.closeId ?? tableId;
  const added = new Map<BlockId, ParsedCell>();
  for (const e of edits) for (const c of e.added) added.set(c.id, c);
  // Each re-placed row's output before (its stored form: what its records read) and after.
  const outs = new Map<number, { readonly was: OutCell[]; readonly out: OutCell[] }>();
  const oldIds = new Set<BlockId>();
  const oldBodies = new Set<BlockId>();
  for (const [i, f] of placed) {
    const was = outputOf(form.rows[i] ?? f, i, R, oldCount, nextMark(i));
    const out = outputOf(f, i, R, count, nextMark(i));
    outs.set(i, { was, out });
    // The row's cells no longer read (removed cells, virtual cells now covered or past the width) go; so do the old
    // records of a cell re-read (its unchanged `⟨c⟩` in a region: its contents are new).
    const keep = new Set(out.map((c) => c.id));
    for (const c of was) if (!keep.has(c.id) || added.has(c.id)) subtree(w, fs, c.id, oldIds, oldBodies);
  }
  for (const id of oldIds) w.del(tree, id);
  for (const [i, f] of placed) {
    const { was, out } = outs.get(i) ?? { was: [], out: [] };
    const wasAt = new Map(was.map((c, k) => [c.id, k]));
    out.forEach((c, j) => {
      const p = added.get(c.id);
      // A kept cell whose spans and neighbours are unchanged keeps its record (not read).
      const k = wasAt.get(c.id);
      const o = k === undefined ? undefined : was[k];
      if (p === undefined && k !== undefined && o !== undefined && o.rowSpan === c.rowSpan && o.colSpan === c.colSpan && was[k - 1]?.id === out[j - 1]?.id && was[k + 1]?.id === out[j + 1]?.id) return;
      const links = { parentId: f.id, prevSiblingId: out[j - 1]?.id ?? null, nextSiblingId: out[j + 1]?.id ?? null };
      if (p !== undefined) {
        writeCell(w, tree, { id: c.id, map: p.map, rowSpan: c.rowSpan, colSpan: c.colSpan, ents: cellEnts(c.id, p.ents.filter(isBlockEntity)) }, links);
        return;
      }
      const rec = w.get(tree, c.id);
      if (rec === undefined) {
        if (!c.virtual) throw new Error(`model: placed cell ${c.id} has no record`);
        writeVirtualCell(w, tree, c.id, links);
      } else if (spanOf(rec.attrs["rowSpan"]) !== c.rowSpan || spanOf(rec.attrs["colSpan"]) !== c.colSpan) {
        const a: Record<string, unknown> = { ...rec.attrs };
        delete a["rowSpan"];
        delete a["colSpan"];
        if (c.rowSpan > 1) a["rowSpan"] = c.rowSpan;
        if (c.colSpan > 1) a["colSpan"] = c.colSpan;
        w.put(tree, Object.freeze({ ...rec, ...links, attrs: Object.freeze(a) }));
      } else w.patch(tree, c.id, links);
    });
    if (was[0]?.id !== out[0]?.id || was[was.length - 1]?.id !== out[out.length - 1]?.id) {
      w.patch(tree, f.id, { firstChildId: out[0]?.id ?? null, lastChildId: out[out.length - 1]?.id ?? null });
    }
  }
  // Every other row's virtual end cells follow a changed column count (O(R): the output changes there).
  if (count !== oldCount) {
    rows.forEach((f, i) => {
      if (!placed.has(i)) relinkRow(w, tree, f, nextMark(i), oldCount, count);
    });
  }
  // The table record: RT4 (carries may cross the header run now), RT3 over a changed column count.
  const tRec = w.get(tree, tableId);
  if (tRec !== undefined) {
    const attrs: Record<string, unknown> = { ...tRec.attrs };
    delete attrs["headerRowCount"];
    const h = headerCountOf(next);
    if (h > 0) attrs["headerRowCount"] = h;
    if (count !== oldCount) {
      delete attrs["columnWidths"];
      const ws = widthsOf(form.map, count);
      if (ws !== null) attrs["columnWidths"] = ws;
    }
    w.put(tree, Object.freeze({ ...tRec, attrs: Object.freeze(attrs) }));
  }
  // Footnote bodies: those anchored in removed cells go, those in new cells are derived.
  const newFn = new Map<BlockId, FootnoteRef>();
  for (const c of added.values()) for (const p of parasOf(c.ents)) for (const f of p.footnotes) newFn.set(footnoteBodyId(f.id), f);
  for (const body of oldBodies) if (!newFn.has(body)) removeFlow(w, body);

  // 4. The flow state: the table's form, nested tables' (removed / new), inert marks folded.
  let tables = fs.tables.set(tableId, next);
  for (const id of oldIds) if (tables.has(id)) tables = tables.delete(id);
  for (const e of edits) {
    for (const [id, f] of e.parser.tables) tables = tables.set(id, f);
    if (e.parser.inert.size > 0) inp.fold(e.L.p, e.R.p, e.parser.inert);
  }
  let leadsAfter = fs.leadsAfter;
  if ([...oldIds].some((id) => leadsAfter.has(id))) leadsAfter = new Set([...leadsAfter].filter((id) => !oldIds.has(id)));
  w.flows = w.flows.set(fs.holderId, { ...fs, segments: inp.newScans, segIndex: inp.newIdx, tables, leadsAfter });
  for (const [body, f] of newFn) if (!oldBodies.has(body)) deriveFootnote(w, f);
  return true;
}
