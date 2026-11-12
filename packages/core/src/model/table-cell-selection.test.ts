/** N7 step 1: the CellSelection kind: its rectangle (cross-cell text ranges, nested lifting, the grow), history, mapping. */
import { describe, expect, it } from "vitest";
import { BLOCK_TYPES, type Block } from "./block";
import { selectedRect } from "./commands/table/cell-rect";
import { insertText } from "./commands/insert-text";
import { setMarks } from "./commands/set-marks";
import { setParagraphAttrs } from "./commands/set-paragraph-attrs";
import { setTableAttrs } from "./commands/table/set-table-attrs";
import { deleteRow } from "./commands/table/delete-row";
import { insertRow } from "./commands/table/insert-row";
import { mergeCells } from "./commands/table/merge-cells";
import { mapSelection } from "./mapping/map-position";
import { type CellSelection, type ModelSelection, caretAt, isCellSelection } from "./position/model-position";
import { childrenOf } from "./test-helpers/fixture";
import type { Harness } from "./test-helpers/harness";
import { raw, selectCells } from "./test-helpers/table";

const tableIn = (h: Harness, parent?: string): Block => {
  const t = (parent === undefined ? h.paragraphs() : childrenOf(h.version, "block", parent)).find((b) => b.type === BLOCK_TYPES.table);
  if (t === undefined) throw new Error("no table");
  return t;
};

/** Cell (r, i) of table `t`: the i-th cell record of row r. */
function cell(h: Harness, t: Block, r: number, i: number): string {
  const row = childrenOf(h.version, "block", t.id)[r];
  const c = row === undefined ? undefined : childrenOf(h.version, "block", row.id)[i];
  if (c === undefined) throw new Error(`no cell ${r},${i}`);
  return c.id;
}

const firstParagraph = (h: Harness, cellId: string): string => {
  const p = childrenOf(h.version, "block", cellId).find((b) => b.type !== BLOCK_TYPES.table);
  if (p === undefined) throw new Error("no paragraph");
  return p.id;
};

/** The table's cells (row-major): text, `↓n` for a rowSpan. */
const cellsOf = (h: Harness): string[] => {
  const t = tableIn(h);
  return childrenOf(h.version, "block", t.id).flatMap((r) =>
    childrenOf(h.version, "block", r.id).map((c) => {
      const p = childrenOf(h.version, "block", c.id)[0];
      const text = (p?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "")).join("");
      return typeof c.attrs["rowSpan"] === "number" ? `${text}↓${c.attrs["rowSpan"]}` : text;
    }),
  );
};

const cells = (anchor: string, head: string): CellSelection => ({ kind: "cells", anchor, head });

/** The rectangle the harness's selection reads as. */
const rectOf = (h: Harness, selection: ModelSelection = h.selection): string | null => {
  const r = selectedRect({ version: h.version, selection });
  return r === null ? null : `${r.box.r0},${r.box.c0}-${r.box.r1},${r.box.c1}`;
};

describe("CellSelection (N7 step 1)", () => {
  it("its rectangle: the two cells' bounding box, grown over merged cells; a text range across cells reads the same; one cell's own", () => {
    // a a b / c d e
    const h = raw("⟦ ⟨r⟩ ⟨c⟩c2 a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟨c⟩ e¶ ⟧ q¶");
    const t = tableIn(h);
    expect(rectOf(h, cells(cell(h, t, 1, 1), cell(h, t, 0, 1)))).toBe("0,0-1,2");
    expect(rectOf(h, cells(cell(h, t, 1, 2), cell(h, t, 1, 1)))).toBe("1,1-1,2");
    expect(rectOf(h, { anchor: { blockId: firstParagraph(h, cell(h, t, 1, 0)), offset: 1 }, focus: { blockId: firstParagraph(h, cell(h, t, 1, 2)), offset: 0 } })).toBe("1,0-1,2");
    expect(rectOf(h, caretAt(firstParagraph(h, cell(h, t, 0, 0)), 0))).toBe("0,0-0,1");
    // A range from the body into a cell is no rectangle.
    expect(rectOf(h, { anchor: { blockId: h.paragraphs()[1]?.id ?? "", offset: 0 }, focus: { blockId: firstParagraph(h, cell(h, t, 1, 0)), offset: 0 } })).toBe(null);
  });

  it("a text range from a nested table's cell to an outer cell lifts to the outer cell", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 x¶ ⟨c⟩@1 y¶ ⟧@1 ¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟧ q¶");
    const t = tableIn(h);
    const inner = tableIn(h, cell(h, t, 0, 0));
    const x = firstParagraph(h, cell(h, inner, 0, 0));
    expect(rectOf(h, { anchor: { blockId: x, offset: 0 }, focus: { blockId: firstParagraph(h, cell(h, t, 1, 1)), offset: 0 } })).toBe("0,0-1,1");
    // Both ends in the nested table: its own rectangle.
    expect(rectOf(h, { anchor: { blockId: x, offset: 0 }, focus: { blockId: firstParagraph(h, cell(h, inner, 0, 1)), offset: 0 } })).toBe("0,0-0,1");
  });

  it("undo restores a cell selection over cells the command deleted (their re-created ⟨c⟩), and over a virtual cell", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟧ q¶");
    const t = tableIn(h);
    // (1, 1) is a virtual end cell.
    h.selection = cells(cell(h, t, 0, 1), cell(h, t, 1, 1));
    expect(rectOf(h)).toBe("0,1-1,1");
    expect(h.run(mergeCells)).toBe(true);
    expect(cellsOf(h)).toEqual(["a", "b↓2", "c"]);
    expect(h.undo()).toBe(true);
    expect(isCellSelection(h.selection)).toBe(true);
    expect(rectOf(h)).toBe("0,1-1,1");
  });

  it("maps through an edit: the same cells after a row insert; a deleted row's cell falls back to the cell now at its point", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟧ q¶");
    const t = tableIn(h);
    const sel = cells(cell(h, t, 0, 0), cell(h, t, 1, 1));
    h.selection = caretAt(firstParagraph(h, cell(h, t, 0, 0)), 0);
    let v0 = h.version;
    expect(h.run(insertRow, "above")).toBe(true);
    expect(mapSelection(v0, h.version, sel)).toEqual(sel);
    v0 = h.version;
    const s1 = cells(cell(h, t, 1, 0), cell(h, t, 2, 1));
    h.selection = caretAt(firstParagraph(h, cell(h, t, 1, 0)), 0);
    expect(h.run(deleteRow)).toBe(true);
    const m = mapSelection(v0, h.version, s1);
    expect(m).toEqual(cells(cell(h, t, 1, 0), cell(h, t, 1, 1)));
  });

  it("a virtual cell maps to its own column (a row's virtual cells share one point)", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨c⟩ c¶ ⟨r⟩ ⟨c⟩ d¶ ⟧ q¶");
    const t = tableIn(h);
    // (1, 1) and (1, 2) are virtual: the row's records 1 and 2.
    const sel = cells(cell(h, t, 0, 0), cell(h, t, 1, 2));
    expect(rectOf(h, sel)).toBe("0,0-1,2");
    h.selection = caretAt(h.paragraphs()[1]?.id ?? "", 0);
    const v0 = h.version;
    expect(h.run(insertText, "z")).toBe(true);
    const m = mapSelection(v0, h.version, sel);
    expect(m).toEqual(sel);
    expect(m === null ? null : rectOf(h, m)).toBe("0,0-1,2");
  });
});

describe("formatting across cells (N7 step 3)", () => {
  /** Per cell (row-major): its paragraphs as `text:type`, `*` marking bold text. */
  const formatted = (h: Harness): string[][] => {
    const d = h.version;
    const t = tableIn(h);
    return childrenOf(d, "block", t.id).flatMap((r) =>
      childrenOf(d, "block", r.id).map((c) =>
        childrenOf(d, "block", c.id).map((p) => {
          const text = (p.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? (i.attrs?.["bold"] === true ? `*${i.text}*` : i.text) : "")).join("");
          return `${text}:${p.type}`;
        }),
      ),
    );
  };

  it("setMarks: every cell of the rectangle, whole; a text range across cells reads the same; the selection stays; undo restores", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨c⟩ c¶ ⟨r⟩ ⟨c⟩ d¶ ⟨c⟩ e x¶ ⟨c⟩ f¶ ⟧ q¶");
    const before = h.read();
    selectCells(h, [0, 1], [1, 2]);
    const sel = h.selection;
    expect(h.run(setMarks, { bold: true })).toBe(true);
    expect(formatted(h)).toEqual([["a:paragraph"], ["*b*:paragraph"], ["*c*:paragraph"], ["d:paragraph"], ["*ex*:paragraph"], ["*f*:paragraph"]]);
    expect(h.selection).toEqual(sel);
    expect(h.undo()).toBe(true);
    expect(h.read()).toEqual(before);
    const t = tableIn(h);
    h.selection = { anchor: { blockId: firstParagraph(h, cell(h, t, 1, 0)), offset: 1 }, focus: { blockId: firstParagraph(h, cell(h, t, 0, 0)), offset: 0 } };
    expect(h.run(setMarks, { bold: true })).toBe(true);
    expect(formatted(h).map((c) => c[0])).toEqual(["*a*:paragraph", "b:paragraph", "c:paragraph", "*d*:paragraph", "ex:paragraph", "f:paragraph"]);
  });

  it("setParagraphAttrs: every paragraph of the rectangle's cells; its virtual cells made real with the keys, once each", () => {
    // Row 1: d, then virtual cells at columns 1 and 2.
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ b2¶ ⟨c⟩ c¶ ⟨r⟩ ⟨c⟩ d¶ ⟧ q¶");
    selectCells(h, [0, 1], [1, 2]);
    expect(h.run(setParagraphAttrs, { type: "heading" })).toBe(true);
    expect(formatted(h)).toEqual([["a:paragraph"], ["b:heading", "b2:heading"], ["c:heading"], ["d:paragraph"], [":heading"], [":heading"]]);
    // Made real: the row now holds three real cells (no duplicated lead cell).
    const t = tableIn(h);
    const row = childrenOf(h.version, "block", t.id)[1];
    expect(childrenOf(h.version, "block", row?.id ?? "").map((c) => c.id.includes("/fill"))).toEqual([false, false, false]);
    expect(h.undo()).toBe(true);
    expect(formatted(h)).toEqual([["a:paragraph"], ["b:paragraph", "b2:paragraph"], ["c:paragraph"], ["d:paragraph"], [":paragraph"], [":paragraph"]]);
  });

  it("a text range from a cell's text into a table nested in it is no cell selection: not the whole cell", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ xy¶ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 z¶ ⟧@1 w¶ ⟧ q¶");
    const outer = cell(h, tableIn(h), 0, 0);
    const z = firstParagraph(h, cell(h, tableIn(h, outer), 0, 0));
    h.selection = { anchor: { blockId: firstParagraph(h, outer), offset: 1 }, focus: { blockId: z, offset: 1 } };
    expect(rectOf(h)).toBe(null);
    // Ends in different containers: refused as before (C9 container-scoped ranges), never the whole outer cell.
    expect(h.run(setMarks, { bold: true })).toBe(false);
    expect(h.run(setParagraphAttrs, { type: "heading" })).toBe(false);
  });

  it("a virtual cell holding a row's lead (concurrency only) is formatted like a real one", () => {
    // Row 1 has no cell: its content `t` reads in the virtual cell at slot 0.
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ t¶ ⟧ q¶");
    selectCells(h, [0, 0], [1, 1]);
    expect(h.run(setMarks, { bold: true })).toBe(true);
    expect(formatted(h).map((c) => c[0])).toEqual(["*a*:paragraph", "*b*:paragraph", "*t*:paragraph", ":paragraph"]);
    selectCells(h, [0, 0], [1, 1]);
    expect(h.run(setParagraphAttrs, { type: "heading" })).toBe(true);
    expect(formatted(h).map((c) => c[0])).toEqual(["*a*:heading", "*b*:heading", "*t*:heading", ":heading"]);
  });

  it("setTableAttrs on a virtual cell holding a row's lead (concurrency only) makes it real with the attrs, its content kept", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ t¶ ⟧ q¶");
    selectCells(h, [0, 0], [1, 0]);
    expect(h.run(setTableAttrs, "cell", { background: "red" })).toBe(true);
    const d = h.version;
    const rows = childrenOf(d, "block", tableIn(h).id).map((r) => childrenOf(d, "block", r.id).map((c) => [c.attrs["background"] ?? null, c.id.includes("/fill")]));
    expect(rows).toEqual([[["red", false], [null, false]], [["red", false], [null, true]]]);
    expect(formatted(h).map((c) => c[0])).toEqual(["a:paragraph", "b:paragraph", "t:paragraph", ":paragraph"]);
  });
});
