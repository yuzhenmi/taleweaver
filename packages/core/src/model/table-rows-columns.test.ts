/** N4 table row / column commands: insertRow, insertColumn (T1), deleteRow (T2), deleteColumn (T3), `cols`. */
import { describe, expect, it } from "vitest";
import type * as Y from "yjs";
import { BLOCK_TYPES, type Block } from "./block";
import { selectAll } from "./commands/selections";
import { insertRow } from "./commands/table/insert-row";
import { type AllSelection, caretAt, isTextSelection } from "./position/model-position";
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
