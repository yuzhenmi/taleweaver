/**
 * Rung 1 of the structural incremental update (tables continuous-text design, N2 note):
 * when a region is not balanced in its container, re-read WHOLE ROWS of the innermost
 * table enclosing it (then the next one out): from the `⟨r⟩` of L's row (just after the
 * `⟦` for row 0, its lead included) to the table's next `⟨r⟩` / `⟧` at or after R.
 *
 * The rows are parsed seeded with the table open (`RegionParser` row mode) and formed from
 * the stored carry of their first row (F4). They replace the old rows' records; unchanged
 * records keep their identity (written equal, old ids no longer read deleted).
 *
 * Declines (the caller re-derives) when the table would change outside the range: a mark
 * popping it, its end at `[S]` / `<end>`, content joining a cell above the range, a
 * cell-less table, a lead read outside its bracket, a row joining content into an earlier
 * row. A changed column count rewrites every other row's virtual end cells (`relink-row.ts`). F4: while the range's carry out differs from
 * the next old row's stored carry, the range runs on through that row.
 */
import type { BlockId } from "../block";
import { deriveFootnote, footnoteBodiesOf, parasOf, removeFlow, writeRow } from "../derive/derive-flow";
import { type ParsedTable, formRows, formedRows, headerRun, widthsOf } from "../derive/table/form-table";
import { withInertMarks } from "../derive/table/inert-marks";
import { RegionParser } from "../derive/table/parse-tables";
import { type RowForm, type TableForm, columnCountOf, headerCountOf } from "../derive/table/table-form";
import type { Working } from "../derive/working";
import type { FlowState } from "../document/types";
import { footnoteBodyId } from "../ids";
import { isSectionBreak } from "../scan/kinds";
import { type FootnoteRef, type Segment, type TerminatorToken, type Token, depthOf, roleOf } from "../scan/tokens";
import type { Carry } from "../../table-grid/assign-table-grid";
import type { Anchor, Pos } from "./anchors";
import { relinkRow } from "./relink-row";

export interface RowSpliceInput {
  readonly w: Working;
  readonly fs: FlowState;
  /** The flow's new segments (mutated: inert marks folded) and their index. */
  readonly newScans: Segment[];
  readonly newIdx: FlowState["segIndex"];
  readonly L: Anchor | null;
  readonly R: Anchor | null;
}

const at = (scans: readonly Segment[], p: Pos): Token | undefined => scans[p.p]?.tokens[p.t];

const before = (a: Pos, b: Pos): boolean => a.p < b.p || (a.p === b.p && a.t < b.t);

function step(scans: readonly Segment[], p: Pos, dir: 1 | -1): Pos | null {
  let { p: s, t } = p;
  t += dir;
  while (s >= 0 && s < scans.length) {
    const n = scans[s]?.tokens.length ?? 0;
    if (t >= 0 && t < n) return { p: s, t };
    s += dir;
    t = dir > 0 ? 0 : (scans[s]?.tokens.length ?? 0) - 1;
  }
  return null;
}

const isMark = (t: Token | undefined): t is TerminatorToken => t !== undefined && t.k !== "run" && t.mark !== undefined;

/** Try rung 1; true when it applied the change (the flow state is written). */
export function rowSplice(inp: RowSpliceInput): boolean {
  const { fs, L } = inp;
  if (L === null || isSectionBreak(L.tok.k) || fs.leadsAfter.has(L.tok.id)) return false;
  for (const id of enclosingTables(inp, L)) {
    const form = fs.tables.get(id);
    if (form !== undefined && spliceRows(inp, id, form)) return true;
  }
  return false;
}

/** The tables enclosing the region's start (just after L), innermost first. */
function enclosingTables({ w, fs, newScans }: RowSpliceInput, L: Anchor): BlockId[] {
  const role = roleOf(L.tok);
  let inner: BlockId | null = null;
  if (role === "open") inner = L.tok.id;
  else if (role === "newRow") inner = w.get(fs.tree, L.tok.id)?.parentId ?? null;
  else if (role === "newCell") inner = w.get(fs.tree, w.get(fs.tree, L.tok.id)?.parentId ?? "")?.parentId ?? null;
  else if (role === "close") {
    // The table L closes: its `⟦` is the first `⟦` of L's depth before it (its own marks are at that depth, nested
    // ones deeper). Its container's tables enclose the region.
    const d = depthOf(L.tok);
    for (let p = step(newScans, L, -1); p !== null; p = step(newScans, p, -1)) {
      const t = at(newScans, p);
      if (isMark(t) && depthOf(t) === d && roleOf(t) === "open") {
        inner = w.get(fs.tree, t.id)?.parentId ?? null;
        break;
      }
    }
    inner = inner === null ? null : nearestTable(w, fs, inner);
  } else inner = nearestTable(w, fs, L.tok.id);
  const out: BlockId[] = [];
  for (let t = inner; t !== null; t = nearestTable(w, fs, t)) out.push(t);
  return out;
}

/** The nearest table record strictly enclosing record `id`. */
function nearestTable(w: Working, fs: FlowState, id: BlockId): BlockId | null {
  for (let p = w.get(fs.tree, id)?.parentId ?? null; p !== null; p = w.get(fs.tree, p)?.parentId ?? null) if (fs.tables.has(p)) return p;
  return null;
}

const sameCarry = (a: Carry, b: Carry): boolean =>
  a === b || (a.length === b.length && a.every((s, i) => s?.head === b[i]?.head && s?.rowsLeft === b[i]?.rowsLeft));

/** Every record id under (and including) `id`, with the footnote bodies they anchor. */
function subtree(w: Working, fs: FlowState, id: BlockId, ids: Set<BlockId>, bodies: Set<BlockId>): void {
  const b = w.get(fs.tree, id);
  if (b === undefined) return;
  ids.add(id);
  for (const body of footnoteBodiesOf(b)) bodies.add(body);
  for (let c = b.firstChildId; c !== null; c = w.get(fs.tree, c)?.nextSiblingId ?? null) subtree(w, fs, c, ids, bodies);
}

function spliceRows(inp: RowSpliceInput, tableId: BlockId, form: TableForm): boolean {
  const { w, fs, newScans, L, R } = inp;
  // A row joining content into an earlier row's head: the rows holding it are not where it is stored.
  if (L === null || R === null || columnCountOf(form) === 0 || form.joinsAbove > 0) return false;
  const dT = form.depth;
  const tree = fs.tree;
  // 1. The range start: the `⟨r⟩` of L's row in the table, or for row 0 (or its lead) just after the table's `⟦`.
  let start: Pos | null = null;
  let k = 0;
  for (let p: Pos | null = L; p !== null; p = step(newScans, p, -1)) {
    const t = at(newScans, p);
    if (!isMark(t) || depthOf(t) !== dT) continue;
    const role = roleOf(t);
    if (role === "newRow") {
      const i = form.rowIndex.get(t.id);
      if (i === undefined) return false;
      if (i === 0) continue; // row 0: from the `⟦`, with the table's lead (which joins row 0)
      start = p;
      k = i;
      break;
    }
    if (role === "open") {
      if (t.id !== tableId) return false;
      start = step(newScans, p, 1);
      k = 0;
      break;
    }
  }
  if (start === null) return false;
  // 2. Parse forward to the table's own `⟧`, or its OLD row's `⟨r⟩` past row k, at or after R (R itself included when
  // it is a mark) — so old row k (whose lead / content may have moved) is always in the range, and a new row's mark
  // never ends it. F4: the range's rows are formed from the stored carry of row k as they complete; at an old row
  // whose stored carry differs from the range's carry out, the range runs on through that row.
  const parser = new RegionParser(fs.holderId, dT, { table: { id: tableId, map: form.map }, rescanned: true });
  const carryIn = form.rows[k]?.carryIn ?? form.endCarry;
  const forms: RowForm[] = [];
  const slots: (readonly (BlockId | undefined)[])[] = [];
  let carryOut = carryIn;
  let boundary: TerminatorToken | null = null;
  let bPos: Pos | null = null;
  let parsed: ParsedTable | null = null;
  let j = form.rows.length;
  for (let p: Pos | null = start; p !== null; p = step(newScans, p, 1)) {
    const t = at(newScans, p);
    if (t === undefined) continue;
    if (!before(p, R) && t.k !== "run") {
      if (isSectionBreak(t.k)) return false;
      const d = isMark(t) ? depthOf(t) : null;
      const role = isMark(t) ? roleOf(t) : null;
      if (d !== null && d < dT && role !== null) return false; // the table ends unclosed there
      if (isMark(t) && d === dT && role !== null && role !== "newCell") {
        // Past R every mark is old: one of this depth must be the table's own `⟧` or row, else its extent changed.
        const i = role === "newRow" ? (form.rowIndex.get(t.id) ?? -1) : -1;
        if (i !== k) {
          if (!(t.id === form.closeId || i > k)) return false;
          parsed = parser.endRows(t.id);
          if (parsed === null) return false;
          const more = formRows(parsed.rows.slice(forms.length), carryOut);
          forms.push(...more.forms);
          slots.push(...more.slots);
          carryOut = more.carryOut;
          const next = i > k ? form.rows[i] : undefined;
          if (next === undefined || sameCarry(carryOut, next.carryIn)) {
            boundary = t;
            bPos = p;
            j = next === undefined ? form.rows.length : i;
            break;
          }
        }
      }
    }
    if (!parser.push(t)) return false;
  }
  if (boundary === null || bPos === null || parsed === null || parser.leadsAfter.size > 0) return false;
  const after = form.rows[j];
  const widthCount = form.widthCount.slice();
  for (let i = k; i < j; i++) {
    const wd = form.rows[i]?.width ?? 0;
    widthCount[wd] = (widthCount[wd] ?? 0) - 1;
  }
  for (const f of forms) widthCount[f.width] = (widthCount[f.width] ?? 0) + 1;
  const rows = [...form.rows.slice(0, k), ...forms, ...form.rows.slice(j)];
  const endCarry = after === undefined ? carryOut : form.endCarry;
  const next: TableForm = {
    ...form,
    rows,
    endCarry,
    widthCount,
    rowIndex: new Map(rows.map((f, i) => [f.id, i])),
    rawHeaderRun: k <= form.rawHeaderRun ? k + headerRun(rows, k) : form.rawHeaderRun,
    joinsAbove: forms.filter((f) => f.joinsAbove).length,
  };
  const columnCount = columnCountOf(next);
  if (columnCount === 0) return false; // the table becomes cell-less: its leads read after it
  const widened = columnCount !== columnCountOf(form);
  const formed = formedRows(k === 0 ? parsed.lead : [], parsed.rows, forms, slots, {
    columnCount,
    first: k,
    rowCount: rows.length,
    nextMark: (i) => parsed.rows[i + 1]?.id ?? boundary.id,
  });
  if (formed === null) return false;

  // 4. Records: the old rows' subtrees out (ids not rewritten), the new rows in, links patched.
  const oldIds = new Set<BlockId>();
  const oldBodies = new Set<BlockId>();
  for (let i = k; i < j; i++) {
    const id = form.rows[i]?.id;
    if (id !== undefined) subtree(w, fs, id, oldIds, oldBodies);
  }
  const prevRow = form.rows[k - 1]?.id ?? null;
  const nextRow = after?.id ?? null;
  formed.forEach((row, i) =>
    writeRow(w, tree, row, { parentId: tableId, prevSiblingId: formed[i - 1]?.id ?? prevRow, nextSiblingId: formed[i + 1]?.id ?? nextRow }),
  );
  const firstNew = formed[0]?.id ?? nextRow;
  const lastNew = formed[formed.length - 1]?.id ?? prevRow;
  if (prevRow !== null) w.patch(tree, prevRow, { nextSiblingId: firstNew });
  if (nextRow !== null) w.patch(tree, nextRow, { prevSiblingId: lastNew });
  const newIds = new Set<BlockId>();
  const newBodies = new Set<BlockId>();
  for (const row of formed) subtree(w, fs, row.id, newIds, newBodies);
  for (const id of oldIds) if (!newIds.has(id)) w.del(tree, id);
  // The table record: its first / last row and RT4 (RT3 is unchanged with the column count).
  const tRec = w.get(tree, tableId);
  if (tRec === undefined) return false;
  const attrs: Record<string, unknown> = { ...tRec.attrs };
  delete attrs["headerRowCount"];
  const h = headerCountOf(next);
  if (h > 0) attrs["headerRowCount"] = h;
  if (widened) {
    // RT3 over the new grid columns, and every other row's virtual end cells for the new width (O(R · columns): the
    // output changes there).
    delete attrs["columnWidths"];
    const ws = widthsOf(form.map, columnCount);
    if (ws !== null) attrs["columnWidths"] = ws;
    rows.forEach((row, r) => {
      if (r < k || r >= k + forms.length) relinkRow(w, tree, row, rows[r + 1]?.id ?? form.closeId ?? tableId, columnCountOf(form), columnCount);
    });
  }
  w.put(tree, Object.freeze({ ...tRec, attrs: Object.freeze(attrs), firstChildId: rows[0]?.id ?? null, lastChildId: rows[rows.length - 1]?.id ?? null }));
  // Heads above the range reaching the table's end: their clipped rowSpan follows the row count (old + left − left').
  const leftOf = (c: Carry): Map<BlockId, number> => {
    const m = new Map<BlockId, number>();
    for (const s of c) if (s !== undefined) m.set(s.head, s.rowsLeft);
    return m;
  };
  const oldLeft = leftOf(form.endCarry);
  const newLeft = leftOf(endCarry);
  for (const head of new Set([...oldLeft.keys(), ...newLeft.keys()])) {
    if (newIds.has(head)) continue;
    const rec = w.get(tree, head);
    if (rec === undefined) continue;
    const old = typeof rec.attrs["rowSpan"] === "number" ? rec.attrs["rowSpan"] : 1;
    const span = old + (oldLeft.get(head) ?? 0) - (newLeft.get(head) ?? 0);
    const a: Record<string, unknown> = { ...rec.attrs };
    delete a["rowSpan"];
    if (span > 1) a["rowSpan"] = span;
    w.put(tree, Object.freeze({ ...rec, attrs: Object.freeze(a) }));
  }
  // Footnote bodies anchored in the range.
  const newFn = new Map<BlockId, FootnoteRef>();
  for (const r of formed) for (const c of r.cells) for (const p of parasOf(c.ents)) for (const f of p.footnotes) newFn.set(footnoteBodyId(f.id), f);
  for (const body of oldBodies) if (!newFn.has(body)) removeFlow(w, body);

  // 5. The flow state: the forms (this table's, its nested tables'), the inert marks folded.
  let tables = fs.tables.set(tableId, next);
  for (const id of oldIds) if (tables.has(id)) tables = tables.delete(id);
  for (const [id, f] of parser.tables) tables = tables.set(id, f);
  if (parser.inert.size > 0) {
    withInertMarks(newScans.slice(start.p, bPos.p + 1), parser.inert).forEach((sg, i) => (newScans[start.p + i] = sg));
  }
  // A cell-less table's leads read in the old rows (a nested table's, in a cell) are gone with them; the new rows hold
  // none (declined above).
  let leadsAfter = fs.leadsAfter;
  if ([...oldIds].some((id) => leadsAfter.has(id))) leadsAfter = new Set([...leadsAfter].filter((id) => !oldIds.has(id)));
  w.flows = w.flows.set(fs.holderId, { ...fs, segments: newScans, segIndex: inp.newIdx, tables, leadsAfter });
  for (const [body, f] of newFn) if (!oldBodies.has(body)) deriveFootnote(w, f);
  return true;
}
