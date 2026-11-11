/** N4 table row / column commands: insertRow, insertColumn (T1), deleteRow (T2), deleteColumn (T3), `cols`. */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { BLOCK_TYPES, type Block } from "./block";
import { selectAll } from "./commands/selections";
import { deleteColumn } from "./commands/table/delete-column";
import { deleteRow } from "./commands/table/delete-row";
import { insertColumn } from "./commands/table/insert-column";
import { insertRow } from "./commands/table/insert-row";
import { markerRanges } from "./document/markers";
import { type AllSelection, caretAt, isTextSelection } from "./position/model-position";
import { mapOf, newFootnoteOf, newMarker, newParagraphMark } from "./storage/new-items";
import { childrenOf, textOf } from "./test-helpers/fixture";
import type { Harness } from "./test-helpers/harness";
import { type Unit, raw, units } from "./test-helpers/table";

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

/** `spec` (a depth-0 table) as the only content of a depth-0 table's cell: its marks at depth 1. */
const nested = (spec: string): string => `⟦ ⟨r⟩ ⟨c⟩ ${spec.replace(/(^|\s)(⟦|⟨r⟩|⟨c⟩|⟧)(\S*)/g, "$1$2$3@1")} ¶ ⟧ q¶`;

/** Runs `step`, checks undo restores everything a reader sees and redo the result. */
function undoableRead(h: Harness, step: () => void): void {
  const before = h.read();
  step();
  const after = h.read();
  expect(h.undo()).toBe(true);
  expect(h.read()).toEqual(before);
  expect(h.redo()).toBe(true);
  expect(h.read()).toEqual(after);
}

/** `spec`'s units, a word `†<id>` / `‡<id>` a comment anchor's start / end marker. */
const marked = (spec: string): Unit[] =>
  units(spec).map((u) => (typeof u === "string" && (u.startsWith("†") || u.startsWith("‡")) ? newMarker("c", u.slice(1), u.startsWith("†") ? "start" : "end") : u));

/** A cell's blocks as words: text, `†<id>` per marker, `[fn]` per footnote; a table `T`. */
const paragraphsOf = (h: Harness, c: Block): string[] =>
  childrenOf(h.version, "block", c.id).map((b) =>
    b.type === BLOCK_TYPES.table
      ? "T"
      : (b.inlineContent?.items ?? [])
          .map((i) => (i.kind === "text" ? i.text : i.kind === "embed" && i.embedType === "marker" ? `${i.properties["edge"] === "end" ? "‡" : "†"}${String(i.properties["id"])}` : i.kind === "embed" && i.embedType === "footnote-anchor" ? "[fn]" : "?"))
          .join(" "),
  );

const markerCount = (h: Harness): number => JSON.stringify(h.read()).split('"embedType":"marker"').length - 1;

describe.each(["body", "nested"] as const)("deleteRow (T2), in a %s table", (where) => {
  const make = (spec: string): Harness => raw(marked(where === "body" ? `${spec} q¶` : nested(spec)));
  /** The table under test (the inner one when nested); undefined once it is gone. */
  const target = (h: Harness): Block | undefined => (where === "body" ? tablesOf(h)[0] : tablesOf(h, cell(h, tableOf(h), 0, 0).id)[0]);
  const the = (h: Harness): Block => {
    const t = target(h);
    if (t === undefined) throw new Error("no target table");
    return t;
  };
  /** Delete the rows of cell (r, c); expects grid `g` and the caret at the start of cell `to`. */
  function del(spec: string, [r, c]: [number, number], g: string[][], to: [number, number]): Harness {
    const h = make(spec);
    inCell(h, the(h), r, c);
    undoableRead(h, () => expect(h.run(deleteRow)).toBe(true));
    const t = the(h);
    expect(grid(h, t)).toEqual(g);
    expect(focusId(h)).toBe(childrenOf(h.version, "block", cell(h, t, ...to).id)[0]?.id);
    return h;
  }

  const P3 = "⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟨r⟩ ⟨c⟩ e¶ ⟨c⟩ f¶ ⟧";
  const RS = "⟦ ⟨r⟩ ⟨c⟩r2 a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ d¶ ⟨r⟩ ⟨c⟩ e¶ ⟨c⟩ f¶ ⟧";
  const H22 = "⟦ ⟨r⟩ ⟨c⟩r2c2 a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨r⟩ ⟨c⟩ d¶ ⟨c⟩ e¶ ⟨c⟩ f¶ ⟧";

  it("a plain cell's row (middle, first, last): the caret goes to the same column below, or above for the last row", () => {
    del(P3, [1, 1], [["a", "b"], ["e", "f"]], [1, 1]);
    del(P3, [0, 0], [["c", "d"], ["e", "f"]], [0, 0]);
    del(P3, [2, 0], [["a", "b"], ["c", "d"]], [1, 0]);
  });

  it("a colSpan head's row; a row below it (the caret: the head covering the column)", () => {
    del("⟦ ⟨r⟩ ⟨c⟩c2 a¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟧", [0, 0], [["c", "d"]], [0, 0]);
    del("⟦ ⟨r⟩ ⟨c⟩c2 a¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟧", [1, 1], [["a→2"]], [0, 0]);
  });

  it("a rowSpan head: its anchor row moves it down (with its content) before the next real cell; a covered row shrinks it; the head deletes all its rows", () => {
    del(RS, [0, 1], [["a", "d"], ["e", "f"]], [0, 1]);
    del(RS, [1, 0], [["a", "b"], ["e", "f"]], [1, 1]);
    del(RS, [0, 0], [["e", "f"]], [0, 0]);
  });

  it("a head re-created at its row's end; past a ragged row's end its slot is padded with empty cells", () => {
    del("⟦ ⟨r⟩ ⟨c⟩ x¶ ⟨c⟩r3 a¶ ⟨r⟩ ⟨c⟩ d¶ ⟨r⟩ ⟨c⟩ e¶ ⟧", [0, 0], [["d", "a↓2"], ["e"]], [0, 0]);
    del("⟦ ⟨r⟩ ⟨c⟩ x¶ ⟨c⟩ y¶ ⟨c⟩r2 a¶ ⟨r⟩ ⟨c⟩ d¶ ⟧", [0, 1], [["d", "", "a"]], [0, 1]);
  });

  it("heads moved from several deleted rows land left to right", () => {
    del("⟦ ⟨r⟩ ⟨c⟩ x¶ ⟨c⟩r3 a¶ ⟨c⟩r2 s¶ ⟨r⟩ ⟨c⟩r2 y¶ ⟨r⟩ ⟨c⟩ e¶ ⟨r⟩ ⟨c⟩ f¶ ⟧", [0, 2], [["y", "a", "e"], ["f", "", ""]], [0, 2]);
  });

  it("a 2×2 head: moved down keeping its width; a covered row shrinks it", () => {
    del(H22, [0, 1], [["a→2", "c"], ["d", "e", "f"]], [0, 1]);
    del(H22, [1, 0], [["a→2", "b"], ["d", "e", "f"]], [1, 2]);
  });

  it("a virtual cell's row; a caret landing in a virtual cell; past a column the table lost, the caret takes the last one", () => {
    const V = "⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨r⟩ ⟨c⟩ e¶ ⟨c⟩ f¶ ⟧";
    del(V, [1, 1], [["a", "b"], ["e", "f"]], [1, 1]);
    del(V, [0, 1], [["c", ""], ["e", "f"]], [0, 1]);
    del("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟧", [0, 1], [["c"]], [0, 0]);
  });

  it("the deleted rows' anchors move to the start of row b's first paragraph, or (the last row) the end of row a − 1's last one", () => {
    const M = "⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ †1 c¶ ⟨c⟩ d †2 ¶ ⟨r⟩ ⟨c⟩ e¶ ⟨c⟩ f¶ ⟧";
    let h = del(M, [1, 1], [["a", "b"], ["\ufffc\ufffce", "f"]], [1, 1]);
    expect(paragraphsOf(h, cell(h, the(h), 1, 0))).toEqual(["†1 †2 e"]);
    const L = "⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ †1 c¶ ⟨c⟩ †2 d¶ ⟧";
    h = del(L, [1, 0], [["a", "b\ufffc\ufffc"]], [0, 0]);
    expect(paragraphsOf(h, cell(h, the(h), 0, 1))).toEqual(["b †1 †2"]);
    h = del(L, [0, 0], [["\ufffcc", "\ufffcd"]], [0, 0]);
    expect(paragraphsOf(h, cell(h, the(h), 0, 0))).toEqual(["†1 c"]);
  });

  it("a moved head's anchors are not copied: they go, with the range's others in storage order, to row b's first real cell", () => {
    const h = del("⟦ ⟨r⟩ ⟨c⟩r2 †1 a¶ ⟨c⟩ †2 b¶ ⟨r⟩ ⟨c⟩ d¶ ⟨r⟩ ⟨c⟩ e¶ ⟨c⟩ f¶ ⟧", [0, 1], [["a", "\ufffc\ufffcd"], ["e", "f"]], [0, 1]);
    expect(paragraphsOf(h, cell(h, the(h), 0, 0))).toEqual(["a"]);
    expect(paragraphsOf(h, cell(h, the(h), 0, 1))).toEqual(["†1 †2 d"]);
    expect(markerCount(h)).toBe(2);
  });

  it("a comment from a moved head to the row below keeps a valid range (start before end)", () => {
    const h = del("⟦ ⟨r⟩ ⟨c⟩ x¶ ⟨c⟩r2 †1 a¶ ⟨r⟩ ⟨c⟩ ‡1 d¶ ⟨r⟩ ⟨c⟩ e¶ ⟨c⟩ f¶ ⟧", [0, 0], [["\ufffc\ufffcd", "a"], ["e", "f"]], [0, 0]);
    expect(paragraphsOf(h, cell(h, the(h), 0, 0))).toEqual(["†1 ‡1 d"]);
    expect([...markerRanges(h.version).values()].map((r) => r.id)).toEqual(["1"]);
  });

  it("every row of the table (one row; a head spanning all) → C10: the table is gone, the caret where it was", () => {
    for (const spec of ["⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟧", "⟦ ⟨r⟩ ⟨c⟩r2 a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ d¶ ⟧"]) {
      const h = make(spec);
      inCell(h, the(h), 0, 0);
      undoableRead(h, () => expect(h.run(deleteRow)).toBe(true));
      expect(target(h)).toBeUndefined();
      const p = where === "body" ? h.paragraphs()[0] : childrenOf(h.version, "block", cell(h, tableOf(h), 0, 0).id)[0];
      expect(p === undefined ? "" : textOf(p)).toBe(where === "body" ? "q" : "");
      expect(focusId(h)).toBe(p?.id);
    }
  });
});

describe("deleteRow (T2)", () => {
  it("a header row: the header count drops", () => {
    const h = raw("⟦ ⟨r⟩h ⟨c⟩ a¶ ⟨r⟩h ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟧ q¶");
    inCell(h, tableOf(h), 0, 0);
    h.run(deleteRow);
    expect(tableOf(h).attrs["headerRowCount"]).toBe(1);
    expect(grid(h, tableOf(h))).toEqual([["b"], ["c"]]);
  });

  it("a re-created head keeps its a:* keys, all its content and its footnotes; every anchor of the range (its own too) goes to row b's first paragraph start", () => {
    const body = new Y.Text();
    body.insert(0, "n");
    body.insertEmbed(1, newParagraphMark());
    const us = units("⟦ ⟨r⟩ ⟨c⟩ x¶ ⟨c⟩r2 a¶ z¶ ⟨r⟩ ⟨c⟩ d¶ ⟧ q¶");
    // `a`, a footnote, then a marker, in the head's first paragraph; a marker in the deleted cell `x`.
    const at = us.indexOf("a");
    const headMark = us[at - 1];
    if (!(headMark instanceof Y.Map)) throw new Error("no head mark");
    headMark.set("a:bg", "red");
    us.splice(at + 1, 0, newFootnoteOf(body), newMarker("c", "b1", "start"));
    us.splice(us.indexOf("x") + 1, 0, newMarker("c", "b2", "start"));
    const h = raw(us);
    inCell(h, tableOf(h), 0, 0);
    undoableRead(h, () => expect(h.run(deleteRow)).toBe(true));
    const t = tableOf(h);
    expect(grid(h, t)).toEqual([["\ufffc\ufffcd", "a\ufffc|z"]]);
    expect(paragraphsOf(h, cell(h, t, 0, 0))).toEqual(["†b2 †b1 d"]);
    const head = cell(h, t, 0, 1);
    expect(head.attrs["bg"]).toBe("red");
    expect(paragraphsOf(h, head)).toEqual(["a [fn]", "z"]);
    const items = childrenOf(h.version, "block", head.id)[0]?.inlineContent?.items ?? [];
    const fn = items.find((i) => i.kind === "embed" && i.embedType === "footnote-anchor");
    const fnBody = fn?.kind === "embed" ? fn.properties["contentBlockId"] : undefined;
    expect(typeof fnBody === "string" ? childrenOf(h.version, "embedContent", fnBody).map(textOf) : null).toEqual(["n"]);
    expect(markerCount(h)).toBe(2);
  });

  it("anchors go to the deepest first paragraph when row b's first cell starts with a nested table", () => {
    const h = raw(marked("⟦ ⟨r⟩ ⟨c⟩ †1 a¶ ⟨r⟩ ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 x¶ ⟧@1 ¶ ⟧ q¶"));
    inCell(h, tableOf(h), 0, 0);
    undoableRead(h, () => expect(h.run(deleteRow)).toBe(true));
    const inner = tablesOf(h, cell(h, tableOf(h), 0, 0).id)[0];
    if (inner === undefined) throw new Error("no inner table");
    expect(paragraphsOf(h, cell(h, inner, 0, 0))).toEqual(["†1 x"]);
    expect(paragraphsOf(h, cell(h, tableOf(h), 0, 0))).toEqual(["T", ""]);
  });

  it("the last row of an unclosed table (closed by [S])", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨r⟩ ⟨c⟩ c¶ [S] q¶");
    const t = tableOf(h);
    inCell(h, t, 1, 0);
    undoableRead(h, () => expect(h.run(deleteRow)).toBe(true));
    expect(grid(h, t)).toEqual([["a"]]);
    expect(focusId(h)).toBe(childrenOf(h.version, "block", cell(h, t, 0, 0).id)[0]?.id);
  });

  it("is a no-op outside a cell and for a body select-all", () => {
    const h = raw(T22);
    h.caret(1, 0);
    expect(h.run(deleteRow)).toBe(false);
    h.selection = all(h);
    expect(h.run(deleteRow)).toBe(false);
  });
});

describe.each(["body", "nested"] as const)("deleteColumn (T3), in a %s table", (where) => {
  const make = (spec: string): Harness => raw(marked(where === "body" ? `${spec} q¶` : nested(spec)));
  const target = (h: Harness): Block | undefined => (where === "body" ? tablesOf(h)[0] : tablesOf(h, cell(h, tableOf(h), 0, 0).id)[0]);
  const the = (h: Harness): Block => {
    const t = target(h);
    if (t === undefined) throw new Error("no target table");
    return t;
  };
  /** Delete the columns of cell (r, c) (read order); expects grid `g` and the caret at the start of cell `to`. */
  function del(spec: string, [r, c]: [number, number], g: string[][], to: [number, number]): Harness {
    const h = make(spec);
    inCell(h, the(h), r, c);
    undoableRead(h, () => expect(h.run(deleteColumn)).toBe(true));
    const t = the(h);
    expect(grid(h, t)).toEqual(g);
    expect(focusId(h)).toBe(childrenOf(h.version, "block", cell(h, t, ...to).id)[0]?.id);
    return h;
  }

  const P = "⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨c⟩ c¶ ⟨r⟩ ⟨c⟩ d¶ ⟨c⟩ e¶ ⟨c⟩ f¶ ⟧";
  const H22 = "⟦ ⟨r⟩ ⟨c⟩r2c2 a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨r⟩ ⟨c⟩ d¶ ⟨c⟩ e¶ ⟨c⟩ f¶ ⟧";

  it("a plain cell's column (middle, first, last): the caret goes to the same row at column j, or j − 1 for the last", () => {
    del(P, [0, 1], [["a", "c"], ["d", "f"]], [0, 1]);
    del(P, [1, 0], [["b", "c"], ["e", "f"]], [1, 0]);
    del(P, [0, 2], [["a", "b"], ["d", "e"]], [0, 1]);
  });

  it("a colSpan head straddling the column shrinks (its key goes at 1); deleting from a colSpan head deletes all its columns", () => {
    const S = "⟦ ⟨r⟩ ⟨c⟩c2 a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ d¶ ⟨c⟩ e¶ ⟨c⟩ f¶ ⟧";
    del(S, [1, 1], [["a", "b"], ["d", "f"]], [1, 1]);
    del("⟦ ⟨r⟩ ⟨c⟩c3 a¶ ⟨r⟩ ⟨c⟩ d¶ ⟨c⟩ e¶ ⟨c⟩ f¶ ⟧", [1, 0], [["a→2"], ["e", "f"]], [1, 0]);
    del(S, [0, 0], [["b"], ["f"]], [0, 0]);
  });

  it("a rowSpan head goes once, from its anchor row; a caret past the end lands in a head from above", () => {
    const RS = "⟦ ⟨r⟩ ⟨c⟩ x¶ ⟨c⟩r2 a¶ ⟨c⟩ y¶ ⟨r⟩ ⟨c⟩ d¶ ⟨c⟩ e¶ ⟧";
    del(RS, [0, 1], [["x", "y"], ["d", "e"]], [0, 1]);
    del(RS, [1, 1], [["x", "a↓2"], ["d"]], [0, 1]);
    // A span the grid clipped (b's c3 at width 2) keeps what read: the table does not widen once `a` goes.
    del("⟦ ⟨r⟩ ⟨c⟩ x¶ ⟨c⟩r2 a¶ ⟨r⟩ ⟨c⟩c3 b¶ ⟧", [0, 1], [["x"], ["b"]], [0, 0]);
  });

  it("a 2×2 head: a column under it shrinks it; deleting from it deletes both its columns", () => {
    del(H22, [2, 1], [["a↓2", "b"], ["c"], ["d", "f"]], [2, 1]);
    del(H22, [0, 0], [["b"], ["c"], ["f"]], [0, 0]);
  });

  it("a virtual cell's column (nothing to delete in its row); a ragged row shorter than j is untouched", () => {
    del("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟧", [1, 1], [["a"], ["c"]], [1, 0]);
    del("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨c⟩ e¶ ⟨r⟩ ⟨c⟩ c¶ ⟧", [0, 2], [["a", "b"], ["c", ""]], [0, 1]);
  });

  it("a deleted cell's anchors go to the start of the next cell's first paragraph, or (the last column) the end of the previous cell's last one; a comment across rows keeps its range", () => {
    let h = del("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ †1 b¶ ⟨c⟩ c¶ w¶ ⟨r⟩ ⟨c⟩ d¶ ⟨c⟩ e ‡1 ¶ ⟨c⟩ f¶ ⟧", [0, 1], [["a", "\ufffcc|w"], ["d", "\ufffcf"]], [0, 1]);
    expect(paragraphsOf(h, cell(h, the(h), 0, 1))).toEqual(["†1 c", "w"]);
    expect(paragraphsOf(h, cell(h, the(h), 1, 1))).toEqual(["‡1 f"]);
    expect([...markerRanges(h.version).values()].map((r) => r.id)).toEqual(["1"]);
    h = del("⟦ ⟨r⟩ ⟨c⟩ z¶ a¶ ⟨c⟩ †1 b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d ‡1 ¶ ⟧", [0, 1], [["z|a\ufffc"], ["c\ufffc"]], [0, 0]);
    expect(paragraphsOf(h, cell(h, the(h), 0, 0))).toEqual(["z", "a †1"]);
    expect(paragraphsOf(h, cell(h, the(h), 1, 0))).toEqual(["c ‡1"]);
    expect([...markerRanges(h.version).values()].map((r) => r.id)).toEqual(["1"]);
  });

  it("a row left with no real cell: its anchors go to the previous surviving cell's end, or (none yet) the next one's start", () => {
    let h = del("⟦ ⟨r⟩ ⟨c⟩r2 a¶ ⟨c⟩ †1 b¶ ⟨r⟩ ⟨c⟩ ‡1 d¶ ⟧", [0, 1], [["a\ufffc\ufffc↓2"], []], [0, 0]);
    expect(paragraphsOf(h, cell(h, the(h), 0, 0))).toEqual(["a †1 ‡1"]);
    h = del("⟦ ⟨r⟩ ⟨c⟩ †1 a¶ ⟨r⟩ ⟨c⟩ ‡1 c¶ ⟨c⟩ d¶ ⟧", [0, 0], [[""], ["\ufffc\ufffcd"]], [0, 0]);
    expect(paragraphsOf(h, cell(h, the(h), 1, 0))).toEqual(["†1 ‡1 d"]);
    expect(markerCount(h)).toBe(2);
  });

  it("every column (one column; a head spanning all) → C10: the table is gone, the caret where it was", () => {
    for (const spec of ["⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨r⟩ ⟨c⟩ b¶ ⟧", "⟦ ⟨r⟩ ⟨c⟩c2 a¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟧"]) {
      const h = make(spec);
      inCell(h, the(h), 0, 0);
      undoableRead(h, () => expect(h.run(deleteColumn)).toBe(true));
      expect(target(h)).toBeUndefined();
      const p = where === "body" ? h.paragraphs()[0] : childrenOf(h.version, "block", cell(h, tableOf(h), 0, 0).id)[0];
      expect(p === undefined ? "" : textOf(p)).toBe(where === "body" ? "q" : "");
      expect(focusId(h)).toBe(p?.id);
    }
  });
});

describe("deleteColumn (T3)", () => {
  it("cols: the entries in [j, k) go; none past a short cols", () => {
    const T3 = "⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨c⟩ c¶ ⟧ q¶";
    const h = raw(T3, (m) => setCols(m[0], [3, 2, 1]));
    inCell(h, tableOf(h), 0, 0);
    h.run(deleteColumn);
    expect(widths(h)).toEqual([2 / 3, 1 / 3]);
    const s = raw(T3, (m) => setCols(m[0], [2, 1]));
    inCell(s, tableOf(s), 0, 1);
    s.run(deleteColumn);
    expect(widths(s)).toEqual([0.5, 0.5]);
    const e = raw(T3, (m) => setCols(m[0], [2, 1]));
    inCell(e, tableOf(e), 0, 2);
    e.run(deleteColumn);
    expect(widths(e)).toEqual([2 / 3, 1 / 3]);
    const w = raw("⟦ ⟨r⟩ ⟨c⟩c2 a¶ ⟨c⟩ b¶ ⟨c⟩ c¶ ⟧ q¶", (m) => setCols(m[0], [3, 2, 1, 1]));
    inCell(w, tableOf(w), 0, 0);
    w.run(deleteColumn);
    expect(widths(w)).toEqual([0.5, 0.5]);
    const n = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩c2 b¶ ⟧ q¶", (m) => setCols(m[0], [1, 2]));
    inCell(n, tableOf(n), 0, 1);
    n.run(deleteColumn);
    expect(widths(n)).toEqual([1]);
  });

  it("the header band is unchanged", () => {
    const h = raw("⟦ ⟨r⟩h ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟧ q¶");
    inCell(h, tableOf(h), 1, 0);
    h.run(deleteColumn);
    expect(tableOf(h).attrs["headerRowCount"]).toBe(1);
    expect(grid(h, tableOf(h))).toEqual([["b"], ["d"]]);
  });

  it("is a no-op outside a cell and for a body select-all", () => {
    const h = raw(T22);
    h.caret(1, 0);
    expect(h.run(deleteColumn)).toBe(false);
    h.selection = all(h);
    expect(h.run(deleteColumn)).toBe(false);
  });
});
