/** N5 (T4): header rows, column widths, table / row / cell attrs. */
import { describe, expect, it } from "vitest";
import { BLOCK_TYPES, type Block } from "./block";
import { setHeaderRows } from "./commands/table/set-header-rows";
import { caretAt } from "./position/model-position";
import { HEADER_KEY } from "./storage/keys";
import { childrenOf } from "./test-helpers/fixture";
import type { Harness } from "./test-helpers/harness";
import { raw } from "./test-helpers/table";

/** The `i`-th table of `parent`'s children (the body by default). */
function tableOf(h: Harness, parent?: string, i = 0): Block {
  const t = (parent === undefined ? h.paragraphs() : childrenOf(h.version, "block", parent)).filter((b) => b.type === BLOCK_TYPES.table)[i];
  if (t === undefined) throw new Error("no table");
  return t;
}

/** Cell (r, c) of table `t`. */
function cell(h: Harness, t: Block, r: number, c: number): Block {
  const row = childrenOf(h.version, "block", t.id)[r];
  const b = row === undefined ? undefined : childrenOf(h.version, "block", row.id)[c];
  if (b === undefined) throw new Error(`no cell ${r},${c}`);
  return b;
}

/** A caret at the start of cell (r, c)'s first paragraph. */
function inCell(h: Harness, t: Block, r: number, c: number): void {
  const p = childrenOf(h.version, "block", cell(h, t, r, c).id)[0];
  if (p === undefined) throw new Error("empty cell");
  h.selection = caretAt(p.id, 0);
}

/** The stored `header` flags of a body table's rows. */
const flags = (h: Harness, t: Block): unknown[] => h.version.flows.get(h.version.rootId)?.tables.get(t.id)?.rows.map((r) => r.map.get(HEADER_KEY) ?? null) ?? [];

describe("setHeaderRows (T4)", () => {
  it("pins the first n rows, unpins, clamps to the rows; unchanged is a no-op; undo restores", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨r⟩ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟧");
    const t = tableOf(h);
    inCell(h, t, 1, 0);
    const sel = h.selection;
    expect(h.run(setHeaderRows, 2)).toBe(true);
    expect(tableOf(h).attrs["headerRowCount"]).toBe(2);
    expect(flags(h, t)).toEqual([true, true, null]);
    expect(h.selection).toEqual(sel);
    expect(h.run(setHeaderRows, 2)).toBe(false);
    expect(h.run(setHeaderRows, 9)).toBe(true);
    expect(tableOf(h).attrs["headerRowCount"]).toBe(3);
    expect(h.run(setHeaderRows, 0)).toBe(true);
    expect(tableOf(h).attrs["headerRowCount"]).toBeUndefined();
    expect(flags(h, t)).toEqual([null, null, null]);
    expect(h.undo()).toBe(true);
    expect(tableOf(h).attrs["headerRowCount"]).toBe(3);
  });

  it("clamps down to a boundary no merged cell crosses; flags past it go", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩r2 a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨r⟩h ⟨c⟩ d¶ ⟨c⟩ e¶ ⟧");
    const t = tableOf(h);
    inCell(h, t, 0, 1);
    expect(h.run(setHeaderRows, 1)).toBe(true); // clamps to 0: the stray flag on row 2 goes
    expect(flags(h, t)).toEqual([null, null, null]);
    expect(h.run(setHeaderRows, 1)).toBe(false);
    expect(h.run(setHeaderRows, 2)).toBe(true);
    expect(tableOf(h).attrs["headerRowCount"]).toBe(2);
  });

  it("acts on the innermost table; a no-op outside a table", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ ⟦@1 ⟨r⟩@1 ⟨c⟩@1 x¶ ⟨r⟩@1 ⟨c⟩@1 y¶ ⟧@1 ¶ ⟨r⟩ ⟨c⟩ b¶ ⟧ q¶");
    const outer = tableOf(h);
    const inner = tableOf(h, cell(h, outer, 0, 0).id);
    inCell(h, inner, 1, 0);
    expect(h.run(setHeaderRows, 1)).toBe(true);
    expect(tableOf(h, cell(h, outer, 0, 0).id).attrs["headerRowCount"]).toBe(1);
    expect(tableOf(h).attrs["headerRowCount"]).toBeUndefined();
    h.caret(h.paragraphs().length - 2, 0);
    expect(h.run(setHeaderRows, 1)).toBe(false);
  });
});
