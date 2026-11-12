/**
 * The table-ops harness (N4 step 5): every cell (virtual ones included) of every shape × the six row / column command
 * forms, run through the real model and judged against the pure slot-matrix model of T1–T3 (`test-helpers/grid-model`)
 * on content and spans per slot and the header count, and on the generic invariants: `wellFormed`, no firings,
 * validity, incremental = from scratch (the harness's `run` / `undo` / `redo`), undo / redo restoring the exact read,
 * and the caret a valid stop in the cell the model puts it in. A case id names shape × where × cell × op.
 */
import { describe, expect, it } from "vitest";
import { BLOCK_TYPES, type Block } from "../block";
import type { CommandContext } from "../commands/command-context";
import { deleteColumn } from "../commands/table/delete-column";
import { deleteRow } from "../commands/table/delete-row";
import { insertColumn } from "../commands/table/insert-column";
import { insertRow } from "../commands/table/insert-row";
import { mergeCells } from "../commands/table/merge-cells";
import { unmergeCell } from "../commands/table/unmerge-cell";
import { nextMarkId, slotsOf as formSlotsOf } from "../commands/table/table-at";
import { columnCountOf } from "../derive/table/table-form";
import type { Document } from "../document/types";
import { sectionIdOf, virtualCellId } from "../ids";
import { wellFormed } from "../oracle/document-probes";
import { validityErrors } from "../oracle/expect-valid";
import { describeFiring, firingsOf, idKey } from "../oracle/firings";
import type { Plan } from "../plan";
import { caretAt, isTextSelection } from "../position/model-position";
import { childrenOf, textOf } from "../test-helpers/fixture";
import * as M from "../test-helpers/grid-model";
import { type Harness, caretErrors } from "../test-helpers/harness";
import { raw } from "../test-helpers/table";

/** A shape: its picture (`grid-model`'s `gridOf`; the tag `N` a cell holding a nested table), header rows, flags. */
interface Shape {
  readonly name: string;
  readonly rows: readonly string[];
  readonly header?: number;
  /** Closed by `[S]` instead of `⟧`. */
  readonly unclosed?: boolean;
  /** Also run inside a cell of an outer table (depth 1). */
  readonly nested: boolean;
}

const CAP_ROW = Array.from({ length: M.COLUMN_CAP }, (_, i) => `x${i}`).join(" ");

const SHAPES: readonly Shape[] = [
  { name: "1×1", rows: ["a"], nested: true },
  { name: "2×3", rows: ["a b c", "d e f"], nested: true },
  { name: "3×3 colSpan", rows: ["a a b", "c d e", "f g h"], nested: true },
  { name: "3×3 rowSpan", rows: ["a b c", "a d e", "f g h"], nested: true },
  { name: "3×3 2×2 head", rows: ["a a b", "a a c", "d e f"], nested: true },
  { name: "3×3 header 1", rows: ["a b c", "d e f", "g h i"], header: 1, nested: true },
  { name: "3×3 header 2", rows: ["a b c", "d e f", "g h i"], header: 2, nested: true },
  { name: "3×3 header 2, a span crossing it", rows: ["a b c", "d e f", "g e h"], header: 2, nested: false },
  { name: "nested table in a cell", rows: ["N a", "b c"], nested: false },
  { name: "ragged", rows: ["a b c", "a d .", "e . ."], nested: true },
  { name: "short first row", rows: ["a b .", "c d e"], nested: true },
  { name: "unclosed", rows: ["a b", "c d"], unclosed: true, nested: false },
  { name: "63 columns (the cap)", rows: [CAP_ROW], nested: false },
];

/** The content a cell tag stands for: `N` a nested table then the ¶ after it (read `T|`), else the tag as text. */
const contentOf = (tag: string): string => (tag === "N" ? "T|" : tag);

/** The shape's model grid, tags as the content a cell reads. */
const modelOf = (s: Shape): M.Grid => {
  const g = M.gridOf(s.rows, s.header);
  return { ...g, cells: g.cells.map((c) => ({ ...c, tag: contentOf(c.tag) })) };
};

/** The storage spec of grid `g` with its marks at depth `d` (no trailing content). */
function specOf(g: M.Grid, d: number, unclosed = false): string {
  const out: string[] = [`⟦@${d}`];
  g.header.forEach((h, r) => {
    out.push(`⟨r⟩${h ? "h" : ""}@${d}`);
    for (const c of [...g.cells].filter((x) => x.row === r).sort((x, y) => x.col - y.col)) {
      out.push(`⟨c⟩${c.rowSpan > 1 ? `r${c.rowSpan}` : ""}${c.colSpan > 1 ? `c${c.colSpan}` : ""}@${d}`);
      out.push(c.tag === "T|" ? `⟦@${d + 1} ⟨r⟩@${d + 1} ⟨c⟩@${d + 1} x¶ ⟧@${d + 1} ¶` : `${c.tag}¶`);
    }
  });
  out.push(unclosed ? "[S]" : `⟧@${d}`);
  return out.join(" ");
}

type Where = "body" | "nested";

const build = (s: Shape, where: Where): Harness =>
  raw(where === "body" ? `${specOf(modelOf(s), 0, s.unclosed)} q¶` : `⟦ ⟨r⟩ ⟨c⟩ ${specOf(modelOf(s), 1)} ¶ ⟧ q¶`);

const tables = (d: Document, parent: string): Block[] => childrenOf(d, "block", parent).filter((b) => b.type === BLOCK_TYPES.table);

/** The table under test: the body's first table, or (nested) the one in the outer table's first cell. */
function targetOf(h: Harness, w: Where): Block | undefined {
  const d = h.version;
  const first = h.paragraphs().find((b) => b.type === BLOCK_TYPES.table);
  if (w === "body" || first === undefined) return first;
  const row = childrenOf(d, "block", first.id)[0];
  const cell = row === undefined ? undefined : childrenOf(d, "block", row.id)[0];
  return cell === undefined ? undefined : tables(d, cell.id)[0];
}

/** The derived table as the model reads: per slot its cell's label (or `.` for a virtual cell), the cell ids, the header count. */
function readTable(h: Harness, t: Block): { slots: string[][]; ids: string[][]; header: number } {
  const d = h.version;
  const form = d.flows.get(d.rootId)?.tables.get(t.id);
  if (form === undefined) throw new Error("no table form");
  const C = columnCountOf(form);
  const origin = new Map<string, M.Slot>();
  form.rows.forEach((r, i) => r.placed.forEach((p) => origin.set(p.cellId, [i, p.gridCol])));
  const ids = form.rows.map((r, i) => {
    const s = formSlotsOf(r);
    return Array.from({ length: C }, (_, col) => s[col] ?? virtualCellId(nextMarkId(form, t.id, i), col));
  });
  const slots = ids.map((row) =>
    row.map((id) => {
      const o = origin.get(id);
      const b = d.trees.block.get(id);
      if (o === undefined) return b === undefined ? `missing ${id}` : ".";
      if (b === undefined) return `missing ${id}`;
      const span = (k: string): number => (typeof b.attrs[k] === "number" ? Number(b.attrs[k]) : 1);
      const content = childrenOf(d, "block", id)
        .map((x) => (x.type === BLOCK_TYPES.table ? "T" : textOf(x)))
        .join("|");
      return M.slotLabel(content, o[0], o[1], span("rowSpan"), span("colSpan"));
    }),
  );
  const hc = t.attrs["headerRowCount"];
  return { slots, ids, header: typeof hc === "number" ? hc : 0 };
}

/**
 * The generic invariants of the current version (each failure a message). An unclosed table (concurrency only) is
 * not well formed by its faces: with `unclosed`, the body flow skips `wellFormed`, and exactly one firing is
 * tolerated there, the `empty` one at the `[S]` that closes the table (RT1).
 */
function invariants(h: Harness, unclosed = false): string[] {
  const d = h.version;
  const out = [...validityErrors(d), ...caretErrors(d, h.selection)];
  const sections = new Set(childrenOf(d, "block", d.rootId).map((b) => b.id));
  let tolerated = 0;
  for (const [, fs] of d.flows.entries()) {
    const body = unclosed && fs.holderId === d.rootId;
    if (!body && !wellFormed(fs)) out.push(`${fs.holderId} not well formed`);
    for (const f of firingsOf(fs)) {
      if (body && tolerated === 0 && f.type === "empty" && f.right !== null && sections.has(sectionIdOf(idKey(f.right)))) tolerated++;
      else out.push(`firing: ${describeFiring(f)}`);
    }
  }
  if (unclosed && tolerated !== 1) out.push("no firing at the unclosed table's [S]");
  return out;
}

/** Ancestors of block `id` (itself included). */
function ancestors(d: Document, id: string): string[] {
  const out: string[] = [];
  for (let x: string | null = id; x !== null; x = d.trees.block.get(x)?.parentId ?? null) out.push(x);
  return out;
}

interface Op {
  readonly name: string;
  readonly run: (ctx: CommandContext) => Plan | null;
  readonly model: (g: M.Grid, at: M.Slot) => M.Outcome;
}

const OPS: readonly Op[] = [
  { name: "insertRow above", run: (c) => insertRow(c, "above"), model: (g, at) => M.insertRow(g, at, "above") },
  { name: "insertRow below", run: (c) => insertRow(c, "below"), model: (g, at) => M.insertRow(g, at, "below") },
  { name: "insertColumn left", run: (c) => insertColumn(c, "left"), model: (g, at) => M.insertColumn(g, at, "left") },
  { name: "insertColumn right", run: (c) => insertColumn(c, "right"), model: (g, at) => M.insertColumn(g, at, "right") },
  { name: "deleteRow", run: deleteRow, model: M.deleteRow },
  { name: "deleteColumn", run: deleteColumn, model: M.deleteColumn },
  { name: "unmergeCell", run: unmergeCell, model: M.unmerge },
];

/** The model's cells to act from, by head slot: every real cell and every free slot (a virtual cell). */
function cellsOf(g: M.Grid): { label: string; at: M.Slot }[] {
  const out: { label: string; at: M.Slot }[] = [];
  for (let r = 0; r < M.rowCount(g); r++) {
    for (let col = 0; col < M.columnCount(g); col++) {
      const c = M.cellAt(g, r, col);
      if (c === null) out.push({ label: `virtual (${r},${col})`, at: [r, col] });
      else if (c.row === r && c.col === col) out.push({ label: `${JSON.stringify(c.tag)} (${r},${col})`, at: [r, col] });
    }
  }
  return out;
}

/** Put the caret at the start of the last paragraph directly in the cell at `at` (after a nested table, its ¶). */
function caretIn(h: Harness, t: Block, at: M.Slot): void {
  const id = readTable(h, t).ids[at[0]]?.[at[1]];
  const p = id === undefined ? undefined : childrenOf(h.version, "block", id).filter((b) => b.type !== BLOCK_TYPES.table).at(-1);
  if (p === undefined) throw new Error(`no paragraph in the cell at ${at.join(",")}`);
  h.selection = caretAt(p.id, 0);
}

function runCase(s: Shape, w: Where, at: M.Slot, op: Op): void {
  runOp(build(s, w), s, w, at, op);
}

/** Op `op` from the cell at `at` of the harness's table (built from `s`); the model's outcome, or null for a no-op. */
function runOp(h: Harness, s: Shape, w: Where, at: M.Slot, op: Op, g0: M.Grid = modelOf(s)): M.Outcome | null {
  const t0 = targetOf(h, w);
  if (t0 === undefined) throw new Error("no table");
  // The fixture reads as the model.
  expect(readTable(h, t0).slots).toEqual(M.slotsOf(g0));
  expect(invariants(h, s.unclosed)).toEqual([]);
  caretIn(h, t0, at);
  const x = op.model(g0, at);
  if (x.grid === g0) {
    // A no-op (the column cap).
    expect(h.run(op.run)).toBe(false);
    return null;
  }
  const before = { read: h.read(), sel: h.readSelection() };
  expect(h.run(op.run)).toBe(true);
  judge(h, w, s, t0, x);
  const after = { read: h.read(), sel: h.readSelection() };
  // Undo / redo restore the exact read and the selection (the category harness's checks).
  expect(h.undo()).toBe(true);
  expect({ read: h.read(), sel: h.readSelection() }).toEqual(before);
  expect(h.redo()).toBe(true);
  expect({ read: h.read(), sel: h.readSelection() }).toEqual(after);
  return x;
}

/** The version after a command against the model's outcome `x`. */
function judge(h: Harness, w: Where, s: Shape, t0: Block, x: M.Outcome): void {
  expect(invariants(h, s.unclosed)).toEqual([]);
  const t1 = targetOf(h, w);
  if (x.grid === null || x.caret === null) {
    expect(t1 === undefined || t1.id !== t0.id).toBe(true);
    return;
  }
  if (t1 === undefined) throw new Error("the table is gone; the model keeps it");
  const got = readTable(h, t1);
  expect(got.slots).toEqual(M.slotsOf(x.grid));
  expect(got.header).toBe(M.headerCount(x.grid));
  const sel = h.selection;
  if (!isTextSelection(sel)) throw new Error("no text selection after the command");
  const owner = got.ids[x.caret[0]]?.[x.caret[1]];
  expect({ caretIn: ancestors(h.version, sel.focus.blockId).includes(owner ?? "?") ? x.caret : sel.focus.blockId }).toEqual({ caretIn: x.caret });
}

for (const s of SHAPES) {
  for (const w of s.nested ? (["body", "nested"] as const) : (["body"] as const)) {
    describe(`${s.name} (${w})`, () => {
      for (const { label, at } of cellsOf(modelOf(s))) {
        for (const op of OPS) it(`${s.name} (${w}) × ${label} × ${op.name}`, () => runCase(s, w, at, op));
      }
    });
  }
}

/** The rectangles to merge: every one of the shape's grid (the cap shape: two of its single row). */
function rectanglesOf(g: M.Grid): [M.Slot, M.Slot][] {
  if (M.columnCount(g) >= M.COLUMN_CAP) return [[[0, 0], [0, M.COLUMN_CAP - 1]], [[0, 12], [0, 10]]];
  const out: [M.Slot, M.Slot][] = [];
  const R = M.rowCount(g);
  const C = M.columnCount(g);
  for (let r0 = 0; r0 < R; r0++) for (let c0 = 0; c0 < C; c0++) for (let r1 = r0; r1 < R; r1++) for (let c1 = c0; c1 < C; c1++) out.push([[r0, c0], [r1, c1]]);
  return out;
}

const unmergeOp: Op = { name: "unmergeCell", run: unmergeCell, model: M.unmerge };

const mergeOp = (from: M.Slot, to: M.Slot): Op => ({ name: "mergeCells", run: (c) => mergeCells(c, from, to), model: (g) => M.merge(g, from, to) });

for (const s of SHAPES) {
  for (const w of s.nested ? (["body", "nested"] as const) : (["body"] as const)) {
    describe(`${s.name} (${w}) merge`, () => {
      for (const [from, to] of rectanglesOf(modelOf(s))) {
        it(`${s.name} (${w}) × merge (${from.join(",")})–(${to.join(",")})`, () => {
          const h = build(s, w);
          const x = runOp(h, s, w, from, mergeOp(from, to));
          // Then unmerge the merged cell, from the merged grid.
          if (x !== null && x.grid !== null && x.caret !== null) runOp(h, s, w, x.caret, unmergeOp, x.grid);
        });
      }
    });
  }
}
