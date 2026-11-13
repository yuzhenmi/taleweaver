/** N3 table commands: insertTable, E2, C5 / C8 next to tables, cell edges, container-scoped ranges, cell select-all, C10. */
import { describe, expect, it } from "vitest";
import { wellFormed } from "./oracle/document-probes";
import { firingsOf } from "./oracle/firings";
import { BLOCK_TYPES, type Block } from "./block";
import { insertTable } from "./commands/insert-table";
import { deleteBackward } from "./commands/delete-backward";
import { deleteBlockObject } from "./commands/delete-block-object";
import { deleteSelection } from "./commands/delete-selection";
import { selectAll } from "./commands/selections";
import { deleteForward } from "./commands/delete-forward";
import { insertText } from "./commands/insert-text";
import { splitParagraph } from "./commands/split-paragraph";
import { type ModelPosition, caretAt, isTextSelection } from "./position/model-position";
import { TABLE_DEPTH_CAP } from "./storage/limits";
import { childrenOf, textOf } from "./test-helpers/fixture";
import { Harness, typeLines } from "./test-helpers/harness";
import { afterObjectId } from "./ids";
import { insertUnits, shape, units } from "./test-helpers/table";

/** A harness whose body holds `spec` (test-helpers/table `units`), before the body's final ¶. */
function raw(spec: string): Harness {
  const h = new Harness();
  h.f.doc.transact(() => insertUnits(h.f.piece, 0, units(spec)));
  h.history.clear();
  return h;
}

function doc(text: string): Harness {
  const h = new Harness();
  typeLines(h, text, insertText, splitParagraph);
  return h;
}

/** The `i`-th table among the body's blocks. */
const tableOf = (h: Harness, i = 0): Block => {
  const t = h.paragraphs().filter((b) => b.type === BLOCK_TYPES.table)[i];
  if (t === undefined) throw new Error(`no table ${i}`);
  return t;
};
/** Paragraph `k` of cell (r, c) of `table`. */
const cellPara = (h: Harness, table: Block, r: number, c: number, k = 0): Block => {
  const d = h.version;
  const row = childrenOf(d, "block", table.id)[r];
  const cell = row === undefined ? undefined : childrenOf(d, "block", row.id)[c];
  const p = cell === undefined ? undefined : childrenOf(d, "block", cell.id)[k];
  if (p === undefined) throw new Error(`no paragraph ${r},${c},${k}`);
  return p;
};
const fail = (): never => {
  throw new Error("no flow");
};
const focusId = (h: Harness): string => (isTextSelection(h.selection) ? h.selection.focus.blockId : "");

describe("insertTable (C14)", () => {
  it("k > 0 splits and puts the table before the tail; k = 0 before the paragraph; the caret in the first cell", () => {
    const h = doc("abcd");
    h.caret(0, 2);
    expect(h.run(insertTable, 2, 3)).toBe(true);
    expect(h.dump()).toEqual(["paragraph:ab", "table", "paragraph:cd"]);
    const t = tableOf(h);
    expect(shape(h.version, t.id)).toEqual([["", "", ""], ["", "", ""]]);
    expect(t.attrs["columnWidths"]).toBeDefined();
    expect(focusId(h)).toBe(cellPara(h, t, 0, 0).id);
    h.run(insertText, "x");
    expect(shape(h.version, t.id)[0]).toEqual(["x", "", ""]);
    expect(h.undo() && h.undo()).toBe(true);
    expect(h.dump()).toEqual(["paragraph:abcd"]);
    expect(h.sel()).toBe("0:2");
    expect(h.redo()).toBe(true);
    expect(h.dump()).toEqual(["paragraph:ab", "table", "paragraph:cd"]);
  });

  it("k = 0 after a table puts ¶M first (W2); over a range the range goes first", () => {
    const h = doc("ab");
    h.caret(0, 0);
    h.run(insertTable, 1, 1);
    expect(h.dump()).toEqual(["table", "paragraph:ab"]);
    h.caret(1, 0);
    h.run(insertTable, 1, 2);
    expect(h.dump()).toEqual(["table", "paragraph:", "table", "paragraph:ab"]);
    const g = doc("abc\ndef");
    g.select([0, 1], [1, 2]);
    g.run(insertTable, 1, 1);
    expect(g.dump()).toEqual(["paragraph:a", "table", "paragraph:f"]);
  });

  it("at a cell's start no ¶ goes first (a cell start is no block object)", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟧ q¶");
    const t = tableOf(h);
    h.selection = caretAt(cellPara(h, t, 0, 0).id, 0);
    h.run(insertTable, 1, 1);
    expect(shape(h.version, t.id)).toEqual([["T|a"]]);
  });

  it("nests in a cell at depth + 1, and is a no-op at the depth cap; bad counts throw", () => {
    const h = doc("ab");
    h.caret(0, 1);
    h.run(insertTable, 1, 1);
    for (let n = 1; n < TABLE_DEPTH_CAP; n++) expect(h.run(insertTable, 1, 2)).toBe(true);
    expect(h.run(insertTable, 1, 1)).toBe(false);
    // Every level read as a table: no mark went inert.
    let t: Block | undefined = tableOf(h);
    let levels = 0;
    while (t !== undefined) {
      levels++;
      const cell: Block | undefined = childrenOf(h.version, "block", childrenOf(h.version, "block", t.id)[0]?.id ?? "")[0];
      t = childrenOf(h.version, "block", cell?.id ?? "").find((b) => b.type === BLOCK_TYPES.table);
    }
    expect(levels).toBe(TABLE_DEPTH_CAP);
    expect(() => insertTable(h.ctx(), 0, 1)).toThrow();
    expect(() => insertTable(h.ctx(), 1, 1.5)).toThrow();
  });
});

describe("E2", () => {
  it("Enter at the start of a leading table's first cell puts a ¶ above the table; the caret stays", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟧");
    const t = tableOf(h);
    const a = cellPara(h, t, 0, 0);
    h.selection = caretAt(a.id, 0);
    expect(h.run(splitParagraph)).toBe(true);
    expect(h.dump()).toEqual(["paragraph:", "table", "paragraph:"]);
    expect(h.selection).toEqual(caretAt(a.id, 0));
    // Now a ¶ precedes the table: an ordinary split.
    h.run(splitParagraph);
    expect(shape(h.version, t.id)).toEqual([["|a", "b"]]);
    expect(h.undo() && h.undo()).toBe(true);
    expect(h.dump()).toEqual(["table", "paragraph:"]);
  });

  it("after [S], after a block object (another table) and at a nested table's cell start; not after a ¶, nor in a second cell", () => {
    const s = raw("x¶ [S] ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟧");
    s.selection = caretAt(cellPara(s, tableOf(s), 0, 0).id, 0);
    s.run(splitParagraph);
    expect(s.dump()).toEqual(["paragraph:x", "|", "paragraph:", "table", "paragraph:"]);
    // Two abutting tables (a concurrent W2 break): the ¶ goes between them.
    const w = raw("⟦ ⟨r⟩ ⟨c⟩ q¶ ⟧ ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟧");
    w.selection = caretAt(cellPara(w, tableOf(w, 1), 0, 0).id, 0);
    w.run(splitParagraph);
    expect(w.dump()).toEqual(["table", "paragraph:", "table", "paragraph:"]);
    // A nested table at its cell's start: the ¶ goes before it, in the outer cell.
    const n = raw("⟦ ⟨r⟩ ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 a¶ ⟧@1 ¶ ⟨c⟩ b¶ ⟧ z¶");
    const outer = tableOf(n);
    const inner = childrenOf(n.version, "block", childrenOf(n.version, "block", childrenOf(n.version, "block", outer.id)[0]?.id ?? "")[0]?.id ?? "")[0];
    expect(inner?.type).toBe(BLOCK_TYPES.table);
    if (inner === undefined) return;
    n.selection = caretAt(cellPara(n, inner, 0, 0).id, 0);
    n.run(splitParagraph);
    expect(shape(n.version, outer.id)).toEqual([["|T|", "b"]]);
    n.selection = caretAt(cellPara(n, inner, 0, 0).id, 0);
    n.run(splitParagraph); // a ¶ now precedes the nested table: an ordinary split
    expect(shape(n.version, inner.id)).toEqual([["|a"]]);
    n.selection = caretAt(cellPara(n, outer, 0, 1).id, 0);
    n.run(splitParagraph);
    expect(shape(n.version, outer.id)).toEqual([["|T|", "|b"]]);
  });
});

describe("C5 / C8 next to a table", () => {
  it("Backspace in an empty paragraph after a table deletes it, the caret to the end of the last cell; not when W2 needs it or it holds text", () => {
    const h = raw("p¶ ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ bc¶ ⟧ ¶ q¶");
    const t = tableOf(h);
    expect(h.dump()).toEqual(["paragraph:p", "table", "paragraph:", "paragraph:q", "paragraph:"]);
    h.caret(2, 0);
    expect(h.run(deleteBackward)).toBe(true);
    expect(h.dump()).toEqual(["paragraph:p", "table", "paragraph:q", "paragraph:"]);
    expect(h.selection).toEqual(caretAt(cellPara(h, t, 0, 1).id, 2));
    h.caret(2, 0); // "q": not empty
    expect(h.run(deleteBackward)).toBe(false);
    expect(h.undo()).toBe(true);
    expect(h.dump()).toEqual(["paragraph:p", "table", "paragraph:", "paragraph:q", "paragraph:"]);
    // W2 needs the paragraph: the table's last line in the flow, or a block object after it.
    for (const spec of ["⟦ ⟨r⟩ ⟨c⟩ a¶ ⟧", "⟦ ⟨r⟩ ⟨c⟩ a¶ ⟧ ¶ ⟦ ⟨r⟩ ⟨c⟩ b¶ ⟧ z¶"]) {
      const g = raw(spec);
      g.caret(1, 0);
      expect(g.run(deleteBackward)).toBe(false);
    }
  });

  it("the caret goes to the end of a nested table's /after paragraph, the last paragraph of the last cell", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 a¶ ⟧@1 ⟧ ¶ q¶");
    const t = tableOf(h);
    h.caret(1, 0);
    h.run(deleteBackward);
    expect(h.selection).toEqual(caretAt(cellPara(h, t, 0, 0, 1).id, 0));
  });

  it("Delete in an empty paragraph before a table deletes it, the caret to the first cell; not after a block object, nor with text", () => {
    const h = raw("p¶ ¶ ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟧ q¶");
    const t = tableOf(h);
    h.caret(1, 0);
    expect(h.run(deleteForward)).toBe(true);
    expect(h.dump()).toEqual(["paragraph:p", "table", "paragraph:q", "paragraph:"]);
    expect(h.selection).toEqual(caretAt(cellPara(h, t, 0, 0).id, 0));
    h.caret(0, 1);
    expect(h.run(deleteForward)).toBe(false); // "p": not empty
    expect(h.undo()).toBe(true);
    expect(h.dump()).toEqual(["paragraph:p", "paragraph:", "table", "paragraph:q", "paragraph:"]);
    // The flow's first paragraph may go: the table then starts the flow (as C14 at k = 0 does).
    const f = raw("¶ ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟧ q¶");
    f.caret(0, 0);
    expect(f.run(deleteForward)).toBe(true);
    expect(f.dump()).toEqual(["table", "paragraph:q", "paragraph:"]);
    // Between two tables the paragraph is W2's.
    const w = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟧ ¶ ⟦ ⟨r⟩ ⟨c⟩ b¶ ⟧ z¶");
    w.caret(1, 0);
    expect(w.run(deleteForward)).toBe(false);
  });

  it("in a cell: an empty first paragraph before a nested table goes (a cell start is no object)", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ ¶ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 a¶ ⟧@1 b¶ ⟧ z¶");
    const t = tableOf(h);
    h.selection = caretAt(cellPara(h, t, 0, 0).id, 0);
    expect(h.run(deleteForward)).toBe(true);
    expect(shape(h.version, t.id)).toEqual([["T|b"]]);
  });
});

describe("cell edges", () => {
  it("Backspace at a cell's start and Delete at a cell's end do nothing, for empty, text, first and last cells", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ ¶ ⟨r⟩ ⟨c⟩ b¶ ⟨c⟩ c¶ ⟧ z¶");
    const t = tableOf(h);
    const before = h.read();
    for (const [r, c] of [[0, 0], [0, 1], [1, 0], [1, 1]] as const) {
      const p = cellPara(h, t, r, c);
      h.selection = caretAt(p.id, 0);
      expect(h.run(deleteBackward)).toBe(false);
      h.selection = caretAt(p.id, p.inlineContent?.items.reduce((n, i) => n + ("text" in i ? i.text.length : 1), 0) ?? 0);
      expect(h.run(deleteForward)).toBe(false);
    }
    expect(h.read()).toEqual(before);
  });
});

describe("an unclosed table (concurrency only)", () => {
  it("the first write in its implicit paragraph writes the missing ⟧, so the text reads after the table", () => {
    const h = raw("p¶ ⟦ ⟨r⟩ ⟨c⟩ a¶");
    // The body's final ¶ is inside the unclosed table; the implicit paragraph after it reads last.
    const n = h.paragraphs().length;
    expect(h.dump()[n - 1]).toBe("paragraph:");
    h.caret(n - 1, 0);
    h.run(insertText, "x");
    expect(h.dump()).toEqual(["paragraph:p", "table", "paragraph:x"]);
    expect(shape(h.version, tableOf(h).id)).toEqual([["a|"]]);
    expect(h.undo()).toBe(true);
  });

  it("typing in its last row's virtual end cell makes that cell real inside the table, before the [S]", () => {
    const h = raw("p¶ ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨c⟩ c¶ ⟨r⟩ ⟨c⟩ d¶ [S] q¶");
    const before = h.read();
    const dump = h.dump();
    const v = cellPara(h, tableOf(h), 1, 2).id;
    h.selection = caretAt(v, 0);
    expect(h.run(deleteForward)).toBe(false); // a cell's end: the [S] after the table stays
    expect(h.run(insertText, "x")).toBe(true);
    expect(shape(h.version, tableOf(h).id)).toEqual([["a", "b", "c"], ["d", "", "x"]]);
    expect(h.dump()).toEqual(dump);
    expect(h.undo()).toBe(true);
    expect(h.read()).toEqual(before);
    expect(h.selection).toEqual(caretAt(v, 0)); // restored into that virtual cell, not past the [S]

    // A nested table left unclosed by the outer cell's next ⟨c⟩: the same, inside the outer cell.
    const n = raw("⟦ ⟨r⟩ ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 x¶ ⟨c⟩@1 y¶ ⟨r⟩@1 ⟨c⟩@1 z¶ ⟨c⟩ b¶ ⟧ q¶");
    const inner = childrenOf(n.version, "block", cellPara(n, tableOf(n), 0, 0).parentId ?? "").filter((b) => b.type === BLOCK_TYPES.table)[0] ?? fail();
    const w = cellPara(n, inner, 1, 1).id;
    n.selection = caretAt(w, 0);
    expect(n.run(deleteForward)).toBe(false);
    expect(n.run(insertText, "w")).toBe(true);
    expect(shape(n.version, inner.id)).toEqual([["x", "y"], ["z", "w"]]);
    expect(n.undo()).toBe(true);
    expect(n.selection).toEqual(caretAt(w, 0));
  });

  it("undo restores a caret in an implicit paragraph at its table's end: a virtual cell or the table's /after", () => {
    // Each: a spec, then the caret's paragraph in the version (they share one storage point: the table's extent end).
    const outer = (h: Harness): Block => tableOf(h);
    const cases: [string, (h: Harness) => string][] = [
      ["p¶ ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ d¶ [S] q¶", (h) => afterObjectId(outer(h).id)],
      ["p¶ ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ d¶ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 z¶ ⟧@1 [S] q¶", (h) => cellPara(h, outer(h), 1, 1).id],
      ["p¶ ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ d¶ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 z¶ ⟨c⟩@1 y¶ ⟨r⟩@1 ⟨c⟩@1 w¶ [S] q¶", (h) => cellPara(h, outer(h), 1, 1).id],
    ];
    for (const [spec, pick] of cases) {
      const h = raw(spec);
      const id = pick(h);
      h.selection = caretAt(id, 0);
      expect(h.run(insertText, "x")).toBe(true);
      expect(h.undo()).toBe(true);
      expect(h.selection, spec).toEqual(caretAt(id, 0));
    }
  });

  it("Delete at its last cell's end and Backspace after the [S] closing it do not join across that [S]", () => {
    for (const spec of ["p¶ ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ d¶ ⟨c⟩ e¶ [S] q¶", "p¶ ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ d¶ ⟨c⟩ e [S] q¶", "p¶ ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ e¶ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 z¶ ⟧@1 [S] q¶"]) {
      const h = raw(spec);
      const dump = h.dump();
      const t = tableOf(h);
      h.selection = caretAt(cellPara(h, t, childrenOf(h.version, "block", t.id).length - 1, 1).id, 1); // after "e"
      expect(h.run(deleteForward), spec).toBe(false);
      h.caret(h.paragraphs().findIndex((b) => textOf(b) === "q"), 0);
      expect(h.run(deleteBackward), spec).toBe(false);
      h.selection = caretAt(afterObjectId(t.id), 0); // the table's implicit paragraph-after, at the same [S]
      expect(h.run(deleteForward), spec).toBe(false);
      expect(h.dump()).toEqual(dump);
    }
  });

  it("a range that deletes it writes no ⟧ for it", () => {
    const h = raw("p¶ ⟦ ⟨r⟩ ⟨c⟩ a¶");
    const n = h.paragraphs().length;
    h.select([0, 0], [n - 1, 0]);
    h.run(insertText, "x");
    expect(h.dump()).toEqual(["paragraph:x"]);
    // A stray `⟧` would read as inert (invisible to the read): the storage walk sees it.
    expect(firingsOf(h.version.flows.get(h.version.rootId) ?? fail())).toEqual([]);
  });
});

describe("container-scoped ranges and select-all", () => {
  it("a range from the body into a cell is refused (across two cells: a cell selection, N7); one across a whole table deletes it (C9)", () => {
    const h = raw("p¶ ⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟧ q¶");
    const t = tableOf(h);
    const before = h.read();
    const a = cellPara(h, t, 0, 0);
    const b = cellPara(h, t, 0, 1);
    const ranges: [ModelPosition, ModelPosition][] = [
      [h.at(0, 1), { blockId: a.id, offset: 1 }],
      [{ blockId: b.id, offset: 1 }, h.at(2, 0)],
    ];
    for (const [x, y] of ranges) {
      h.selection = { anchor: x, focus: y };
      expect(h.run(deleteSelection)).toBe(false);
      expect(h.run(insertText, "z")).toBe(false);
    }
    expect(h.read()).toEqual(before);
    h.select([0, 1], [2, 0]);
    expect(h.run(deleteSelection)).toBe(true);
    expect(h.dump()).toEqual(["paragraph:pq", "paragraph:"]);
    // Within one cell, an ordinary range.
    const g = raw("⟦ ⟨r⟩ ⟨c⟩ ab¶ cd¶ ⟧ q¶");
    const gt = tableOf(g);
    g.selection = { anchor: { blockId: cellPara(g, gt, 0, 0).id, offset: 1 }, focus: { blockId: cellPara(g, gt, 0, 0, 1).id, offset: 1 } };
    expect(g.run(deleteSelection)).toBe(true);
    expect(shape(g.version, gt.id)).toEqual([["ad"]]);
  });

  it("select-all in a cell takes the cell's content (a nested table at its start too); typing replaces it; undo restores", () => {
    const h = raw("p¶ ⟦ ⟨r⟩ ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 n¶ ⟧@1 a¶ b¶ ⟨c⟩ c¶ ⟧ q¶");
    const t = tableOf(h);
    const cell = childrenOf(h.version, "block", childrenOf(h.version, "block", t.id)[0]?.id ?? "")[0];
    const all = cell === undefined ? null : selectAll(h.version, cell.id);
    expect(all).not.toBeNull();
    if (all === null) return;
    h.selection = all;
    const before = h.read();
    expect(h.run(insertText, "z")).toBe(true);
    expect(shape(h.version, t.id)).toEqual([["z", "c"]]);
    expect(h.dump()).toEqual(["paragraph:p", "table", "paragraph:q", "paragraph:"]);
    expect(h.undo()).toBe(true);
    expect(h.read()).toEqual(before);
    expect(h.selection).toEqual(all);
    // Not a container: a row, a paragraph.
    expect(selectAll(h.version, childrenOf(h.version, "block", t.id)[0]?.id ?? "")).toBeNull();
    expect(selectAll(h.version, h.blockId(0))).toBeNull();
  });

  it("select-all in an empty and a virtual cell", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ ⟧ q¶"); // row 2: an /empty cell, then a virtual one
    const t = tableOf(h);
    const row = childrenOf(h.version, "block", t.id)[1];
    const cells = childrenOf(h.version, "block", row?.id ?? "");
    expect(cells.length).toBe(2);
    for (const c of cells) {
      const all = selectAll(h.version, c.id);
      expect(all).not.toBeNull();
      if (all === null) return;
      h.selection = all;
      expect(h.run(insertText, "z")).toBe(true);
      expect(h.run(insertText, "y")).toBe(true); // the caret resolves
    }
    expect(shape(h.version, t.id)).toEqual([["a", "b"], ["zy", "zy"]]);
    expect(wellFormed(h.version.flows.get(h.version.rootId) ?? fail())).toBe(true);
    // A cell holding only a nested table (and its implicit paragraph): select-all and type leaves no debris.
    const g = raw("⟦ ⟨r⟩ ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 n¶ ⟧@1 ⟧ q¶");
    const gc = childrenOf(g.version, "block", childrenOf(g.version, "block", tableOf(g).id)[0]?.id ?? "")[0];
    const ga = gc === undefined ? null : selectAll(g.version, gc.id);
    if (ga === null) throw new Error("no select-all");
    g.selection = ga;
    expect(g.run(insertText, "z") && g.run(insertText, "y")).toBe(true);
    expect(shape(g.version, tableOf(g).id)).toEqual([["zy"]]);
    expect(wellFormed(g.version.flows.get(g.version.rootId) ?? fail())).toBe(true);
  });
});

describe("C10 of a table", () => {
  it("deletes the whole bracket (nested too); the caret where it was; undo restores", () => {
    const h = raw("p¶ ⟦ ⟨r⟩ ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 n¶ ⟧@1 a¶ ⟧ q¶");
    const t = tableOf(h);
    const before = h.read();
    const inner = childrenOf(h.version, "block", childrenOf(h.version, "block", childrenOf(h.version, "block", t.id)[0]?.id ?? "")[0]?.id ?? "")[0];
    expect(h.run(deleteBlockObject, inner?.id ?? "")).toBe(true);
    expect(shape(h.version, t.id)).toEqual([["a"]]);
    expect(h.selection).toEqual(caretAt(cellPara(h, t, 0, 0).id, 0));
    h.run(deleteBlockObject, t.id);
    expect(h.dump()).toEqual(["paragraph:p", "paragraph:q", "paragraph:"]);
    expect(h.sel()).toBe("1:0");
    expect(h.undo() && h.undo()).toBe(true);
    expect(h.read()).toEqual(before);
  });
});
