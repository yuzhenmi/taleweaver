/** N4 table row / column commands: insertRow, insertColumn (T1), deleteRow (T2), deleteColumn (T3), `cols`. */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { BLOCK_TYPES, type Block } from "./block";
import { selectAll } from "./commands/selections";
import { insertColumn } from "./commands/table/insert-column";
import { insertRow } from "./commands/table/insert-row";
import { type AllSelection, caretAt, isTextSelection } from "./position/model-position";
import { mapOf } from "./storage/new-items";
import { childrenOf, textOf } from "./test-helpers/fixture";
import { Harness } from "./test-helpers/harness";
import { insertUnits, mapsOf, units } from "./test-helpers/table";

/** A harness whose body holds `spec` before its final ¶; `edit` may set keys on the spec's maps first. */
function raw(spec: string, edit?: (maps: Y.Map<unknown>[]) => void): Harness {
  const h = new Harness();
  const us = units(spec);
  edit?.(mapsOf(us));
  h.f.doc.transact(() => insertUnits(h.f.piece, 0, us));
  h.history.clear();
  return h;
}

const tablesOf = (h: Harness, parent?: string): Block[] =>
  (parent === undefined ? h.paragraphs() : childrenOf(h.version, "block", parent)).filter((b) => b.type === BLOCK_TYPES.table);

const tableOf = (h: Harness): Block => {
  const t = tablesOf(h)[0];
  if (t === undefined) throw new Error("no table");
  return t;
};

/** A cell as text: its blocks joined by `|` (a table `T`), then `↓n` / `→n` for spans > 1. */
function cellText(h: Harness, c: Block): string {
  const t = childrenOf(h.version, "block", c.id)
    .map((b) => (b.type === BLOCK_TYPES.table ? "T" : textOf(b)))
    .join("|");
  const rs = c.attrs["rowSpan"];
  const cs = c.attrs["colSpan"];
  return `${t}${typeof rs === "number" ? `↓${rs}` : ""}${typeof cs === "number" ? `→${cs}` : ""}`;
}

/** A table's rows of cell texts. */
const grid = (h: Harness, t: Block): string[][] =>
  childrenOf(h.version, "block", t.id).map((r) => childrenOf(h.version, "block", r.id).map((c) => cellText(h, c)));

/** The cell record (r, c) of table `t` (read order of the row's cells). */
function cell(h: Harness, t: Block, r: number, c: number): Block {
  const row = childrenOf(h.version, "block", t.id)[r];
  const b = row === undefined ? undefined : childrenOf(h.version, "block", row.id)[c];
  if (b === undefined) throw new Error(`no cell ${r},${c}`);
  return b;
}

/** A caret at the start of cell (r, c)'s first paragraph. */
function inCell(h: Harness, t: Block, r: number, c: number): string {
  const p = childrenOf(h.version, "block", cell(h, t, r, c).id)[0];
  if (p === undefined) throw new Error("empty cell");
  h.selection = caretAt(p.id, 0);
  return p.id;
}

function all(h: Harness, id?: string): AllSelection {
  const s = selectAll(h.version, id);
  if (s === null) throw new Error("no select-all");
  return s;
}

const focusId = (h: Harness): string => (isTextSelection(h.selection) ? h.selection.focus.blockId : "");

/** Runs `step`, checks undo restores `before` and redo the result. */
function undoable(h: Harness, step: () => void): void {
  const t = tableOf(h);
  const before = grid(h, t);
  step();
  const after = grid(h, tableOf(h));
  expect(h.undo()).toBe(true);
  expect(grid(h, tableOf(h))).toEqual(before);
  expect(h.redo()).toBe(true);
  expect(grid(h, tableOf(h))).toEqual(after);
}

const T22 = "⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟧ q¶";

describe("insertRow (T1)", () => {
  it("above / below a plain cell: a row of empty cells; the caret stays; undo / redo", () => {
    const h = raw(T22);
    const t = tableOf(h);
    const b = inCell(h, t, 0, 1);
    undoable(h, () => expect(h.run(insertRow, "below")).toBe(true));
    expect(grid(h, t)).toEqual([["a", "b"], ["", ""], ["c", "d"]]);
    expect(focusId(h)).toBe(b);
    expect(h.run(insertRow, "above")).toBe(true);
    expect(grid(h, t)).toEqual([["", ""], ["a", "b"], ["", ""], ["c", "d"]]);
    expect(focusId(h)).toBe(b);
    inCell(h, t, 3, 0);
    expect(h.run(insertRow, "below")).toBe(true);
    expect(grid(h, t)).toEqual([["", ""], ["a", "b"], ["", ""], ["c", "d"], ["", ""]]);
  });

  it("a head crossing the new line grows by one row and covers its slot; a merged reference cell inserts past all its rows", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩r2 a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ d¶ ⟧ q¶");
    const t = tableOf(h);
    inCell(h, t, 0, 1);
    undoable(h, () => h.run(insertRow, "below"));
    expect(grid(h, t)).toEqual([["a↓3", "b"], [""], ["d"]]);
    inCell(h, t, 0, 0);
    expect(h.run(insertRow, "below")).toBe(true);
    expect(grid(h, t)).toEqual([["a↓3", "b"], [""], ["d"], ["", ""]]);
    inCell(h, t, 0, 0);
    expect(h.run(insertRow, "above")).toBe(true);
    expect(grid(h, t)).toEqual([["", ""], ["a↓3", "b"], [""], ["d"], ["", ""]]);
  });

  it("at the table's end, a stored span reaching past it is clipped first, so the new row is not covered", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩r3 a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ d¶ ⟧ q¶");
    const t = tableOf(h);
    inCell(h, t, 1, 0);
    undoable(h, () => h.run(insertRow, "below"));
    expect(grid(h, t)).toEqual([["a↓2", "b"], ["d"], ["", ""]]);
  });

  it("a row inserted inside the header band is a header row; one below it is not", () => {
    const h = raw("⟦ ⟨r⟩h ⟨c⟩ a¶ ⟨r⟩h ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟧ q¶");
    const t = tableOf(h);
    inCell(h, t, 0, 0);
    h.run(insertRow, "below");
    expect(tableOf(h).attrs["headerRowCount"]).toBe(3);
    inCell(h, t, 2, 0);
    h.run(insertRow, "below");
    expect(tableOf(h).attrs["headerRowCount"]).toBe(3);
    inCell(h, t, 0, 0);
    h.run(insertRow, "above");
    expect(tableOf(h).attrs["headerRowCount"]).toBe(4);
  });

  it("copies the reference row's and cells' a:* (not their spans)", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩c2 a¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟧ q¶", (m) => {
      m[1]?.set("a:height", 20);
      m[2]?.set("a:bg", "red");
    });
    const t = tableOf(h);
    inCell(h, t, 0, 0);
    h.run(insertRow, "below");
    expect(grid(h, t)).toEqual([["a→2"], ["", ""], ["c", "d"]]);
    const row = childrenOf(h.version, "block", t.id)[1];
    expect(row?.attrs["height"]).toBe(20);
    expect(cell(h, t, 1, 0).attrs["bg"]).toBe("red");
    expect(cell(h, t, 1, 1).attrs["bg"]).toBe("red");
  });

  it("a caret in a virtual end cell follows it (its id names the next mark)", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟧ q¶");
    const t = tableOf(h);
    inCell(h, t, 1, 1);
    h.run(insertRow, "below");
    expect(grid(h, t)).toEqual([["a", "b"], ["c", ""], ["", ""]]);
    expect(focusId(h)).toBe(childrenOf(h.version, "block", cell(h, t, 1, 1).id)[0]?.id);
    h.run(insertRow, "above");
    expect(grid(h, t)).toEqual([["a", "b"], ["", ""], ["c", ""], ["", ""]]);
    expect(focusId(h)).toBe(childrenOf(h.version, "block", cell(h, t, 2, 1).id)[0]?.id);
  });

  it("an unclosed table (closed by [S]) gets its last row before the [S]", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ [S] q¶");
    const t = tableOf(h);
    const c = inCell(h, t, 1, 0);
    undoable(h, () => expect(h.run(insertRow, "below")).toBe(true));
    expect(grid(h, t)).toEqual([["a", "b"], ["c", ""], ["", ""]]);
    expect(focusId(h)).toBe(c);
    expect(h.dump().slice(-3)).toEqual(["|", "paragraph:q", "paragraph:"]);
  });

  it("in a nested table the inner table gets the row; a cell select-all acts on its cell", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 x¶ ⟧@1 ¶ ⟧ q¶");
    const outer = tableOf(h);
    const inner = tablesOf(h, cell(h, outer, 0, 0).id)[0];
    if (inner === undefined) throw new Error("no inner table");
    inCell(h, inner, 0, 0);
    h.run(insertRow, "below");
    expect(grid(h, inner)).toEqual([["x"], [""]]);
    expect(grid(h, outer)).toEqual([["T|"]]);
    h.selection = all(h, cell(h, inner, 1, 0).id);
    expect(h.run(insertRow, "above")).toBe(true);
    expect(grid(h, inner)).toEqual([["x"], [""], [""]]);
  });

  it("is a no-op outside a cell and for a body select-all", () => {
    const h = raw(T22);
    h.caret(1, 0);
    expect(h.run(insertRow, "below")).toBe(false);
    h.selection = all(h);
    expect(h.run(insertRow, "below")).toBe(false);
  });
});

/** Sets `cols` of a detached `⟦` to entries `ws` (a number: `{w}`; null: `{}`). */
function setCols(open: Y.Map<unknown> | undefined, ws: readonly (number | null)[]): void {
  const a = new Y.Array<Y.Map<unknown>>();
  a.insert(0, ws.map((w) => mapOf(w === null ? {} : { w })));
  open?.set("cols", a);
}

const widths = (h: Harness): unknown => tableOf(h).attrs["columnWidths"];

describe("insertColumn (T1)", () => {
  it("left / right of a plain cell: a column of empty cells; the caret stays; undo / redo", () => {
    const h = raw(T22);
    const t = tableOf(h);
    const b = inCell(h, t, 0, 1);
    undoable(h, () => expect(h.run(insertColumn, "right")).toBe(true));
    expect(grid(h, t)).toEqual([["a", "b", ""], ["c", "d", ""]]);
    expect(focusId(h)).toBe(b);
    const a = inCell(h, t, 0, 0);
    expect(h.run(insertColumn, "left")).toBe(true);
    expect(grid(h, t)).toEqual([["", "a", "b", ""], ["", "c", "d", ""]]);
    expect(focusId(h)).toBe(a);
  });

  it("a head straddling the new column grows (once, also when it spans rows); a merged reference cell inserts past all its columns", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩c2 a¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟧ q¶");
    const t = tableOf(h);
    inCell(h, t, 1, 0);
    undoable(h, () => h.run(insertColumn, "right"));
    expect(grid(h, t)).toEqual([["a→3"], ["c", "", "d"]]);
    inCell(h, t, 0, 0);
    h.run(insertColumn, "right");
    expect(grid(h, t)).toEqual([["a→3", ""], ["c", "", "d", ""]]);
    const g = raw("⟦ ⟨r⟩ ⟨c⟩ x¶ ⟨c⟩ y¶ ⟨r⟩ ⟨c⟩r2c2 a¶ ⟨r⟩ ⟧ q¶");
    const u = tableOf(g);
    inCell(g, u, 0, 0);
    undoable(g, () => g.run(insertColumn, "right"));
    expect(grid(g, u)).toEqual([["x", "", "y"], ["a↓2→3"], []]);
  });

  it("a row covered at j by a head from above starting at j gets its cell at j", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩r2 b¶ ⟨r⟩ ⟨c⟩ c¶ ⟧ q¶");
    const t = tableOf(h);
    inCell(h, t, 0, 0);
    undoable(h, () => h.run(insertColumn, "right"));
    expect(grid(h, t)).toEqual([["a", "", "b↓2"], ["c", ""]]);
  });

  it("a short row ending before the column pads virtually; one reaching it gets a real cell; a virtual cell's caret follows it", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨c⟩ e¶ ⟨r⟩ ⟨c⟩ c¶ ⟧ q¶");
    const t = tableOf(h);
    inCell(h, t, 0, 1);
    h.run(insertColumn, "right");
    expect(grid(h, t)).toEqual([["a", "b", "", "e"], ["c", "", "", ""]]);
    inCell(h, t, 0, 0);
    h.run(insertColumn, "right");
    expect(grid(h, t)).toEqual([["a", "", "b", "", "e"], ["c", "", "", "", ""]]);
    const g = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟧ q¶");
    const u = tableOf(g);
    inCell(g, u, 1, 1);
    g.run(insertColumn, "left");
    expect(grid(g, u)).toEqual([["a", "", "b"], ["c", "", ""]]);
    expect(focusId(g)).toBe(childrenOf(g.version, "block", cell(g, u, 1, 2).id)[0]?.id);
    // A short row with no write: its virtual cell ids keep their columns, so the caret's id now names the new column.
    const k = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨c⟩ e¶ ⟨r⟩ ⟨c⟩ c¶ ⟧ q¶");
    const v = tableOf(k);
    inCell(k, v, 1, 2);
    k.run(insertColumn, "left");
    expect(grid(k, v)).toEqual([["a", "b", "", "e"], ["c", "", "", ""]]);
    expect(focusId(k)).toBe(childrenOf(k.version, "block", cell(k, v, 1, 3).id)[0]?.id);
  });

  it("cols: the reference column's weight is copied (an entry without one: {}); none past a short cols, nothing for an empty one", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟧ q¶", (m) => setCols(m[0], [2, 1]));
    const t = tableOf(h);
    inCell(h, t, 0, 0);
    h.run(insertColumn, "right");
    expect(widths(h)).toEqual([0.4, 0.4, 0.2]);
    inCell(h, t, 0, 2);
    h.run(insertColumn, "left");
    expect(widths(h)).toEqual([2 / 6, 2 / 6, 1 / 6, 1 / 6]);
    const g = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟧ q¶", (m) => setCols(m[0], [null, 1]));
    inCell(g, tableOf(g), 0, 0);
    g.run(insertColumn, "left");
    expect(widths(g)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    const s = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟧ q¶", (m) => setCols(m[0], [3]));
    inCell(s, tableOf(s), 0, 1);
    s.run(insertColumn, "right");
    expect(widths(s)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    const e = raw(T22);
    inCell(e, tableOf(e), 0, 0);
    e.run(insertColumn, "right");
    expect(widths(e)).toBeUndefined();
  });

  it("copies the a:* of each row's reference cell", () => {
    const h = raw(T22, (m) => {
      m[2]?.set("a:bg", "red");
      m[7]?.set("a:bg", "blue");
    });
    const t = tableOf(h);
    inCell(h, t, 0, 0);
    h.run(insertColumn, "right");
    expect(cell(h, t, 0, 1).attrs["bg"]).toBe("red");
    expect(cell(h, t, 1, 1).attrs["bg"]).toBe("blue");
    inCell(h, t, 0, 2);
    h.run(insertColumn, "left");
    expect(cell(h, t, 0, 2).attrs["bg"]).toBeUndefined();
    expect(cell(h, t, 1, 2).attrs["bg"]).toBeUndefined();
  });

  it("is a no-op at the 63-column cap; in a nested table the inner table gets the column", () => {
    const h = raw(`⟦ ⟨r⟩ ${"⟨c⟩ ¶ ".repeat(62)} ⟧ q¶`);
    const t = tableOf(h);
    inCell(h, t, 0, 0);
    expect(h.run(insertColumn, "right")).toBe(true);
    expect(h.run(insertColumn, "right")).toBe(false);
    const g = raw("⟦ ⟨r⟩ ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 x¶ ⟧@1 ¶ ⟧ q¶");
    const outer = tableOf(g);
    const inner = tablesOf(g, cell(g, outer, 0, 0).id)[0];
    if (inner === undefined) throw new Error("no inner table");
    inCell(g, inner, 0, 0);
    g.run(insertColumn, "right");
    expect(grid(g, inner)).toEqual([["x", ""]]);
    expect(grid(g, outer)).toEqual([["T|"]]);
  });
});
