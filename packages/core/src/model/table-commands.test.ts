/** N3 table commands: insertTable, E2, C5 / C8 next to tables, cell edges, container-scoped ranges, cell select-all, C10. */
import { describe, expect, it } from "vitest";
import { BLOCK_TYPES, type Block } from "./block";
import { insertTable } from "./commands/insert-table";
import { insertText } from "./commands/insert-text";
import { splitParagraph } from "./commands/split-paragraph";
import { caretAt, isTextSelection } from "./position/model-position";
import { TABLE_DEPTH_CAP } from "./storage/limits";
import { childrenOf } from "./test-helpers/fixture";
import { Harness, typeLines } from "./test-helpers/harness";
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
