/** N7 step 1: the CellSelection kind: its rectangle (cross-cell text ranges, nested lifting, the grow), history, mapping. */
import { describe, expect, it } from "vitest";
import { BLOCK_TYPES, type Block } from "./block";
import type { CommandContext } from "./commands/command-context";
import { selectedRect } from "./commands/table/cell-rect";
import { insertText } from "./commands/insert-text";
import { deleteRow } from "./commands/table/delete-row";
import { insertRow } from "./commands/table/insert-row";
import { mergeCells } from "./commands/table/merge-cells";
import { mapSelection } from "./mapping/map-position";
import { type CellSelection, type ModelSelection, caretAt, isCellSelection } from "./position/model-position";
import { childrenOf } from "./test-helpers/fixture";
import type { Harness } from "./test-helpers/harness";
import { raw } from "./test-helpers/table";

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
    const caret = caretAt(firstParagraph(h, cell(h, t, 0, 0)), 0);
    // (1, 1) is a virtual end cell.
    h.selection = cells(cell(h, t, 0, 1), cell(h, t, 1, 1));
    expect(rectOf(h)).toBe("0,1-1,1");
    const merge = (ctx: CommandContext) => mergeCells({ ...ctx, selection: caret }, [0, 0], [1, 1]);
    expect(h.run(merge)).toBe(true);
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
