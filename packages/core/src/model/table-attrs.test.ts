/** N5 (T4): header rows, column widths, table / row / cell attrs. */
import { describe, expect, it } from "vitest";
import { BLOCK_TYPES, type Block } from "./block";
import { setColumnWidths } from "./commands/table/set-column-widths";
import { setHeaderRows } from "./commands/table/set-header-rows";
import { caretAt } from "./position/model-position";
import * as Y from "yjs";
import { COLS_KEY, HEADER_KEY, WIDTH_KEY } from "./storage/keys";
import { mapOf } from "./storage/new-items";
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

/** A body table's `cols` array. */
function colsOf(h: Harness, t: Block): Y.Array<unknown> {
  const cols = h.version.flows.get(h.version.rootId)?.tables.get(t.id)?.map.get(COLS_KEY);
  if (!(cols instanceof Y.Array)) throw new Error("no cols");
  return cols;
}

/** A body table's stored `cols` entries: each `w`, or the entry itself when it is no map. */
const stored = (h: Harness, t: Block): unknown[] => colsOf(h, t).toArray().map((e: unknown) => (e instanceof Y.Map ? e.get(WIDTH_KEY) : e));

/** A harness over `spec` whose (first) table's `cols` holds `entries`. */
function withCols(spec: string, entries: unknown[]): Harness {
  const h = raw(spec);
  h.f.doc.transact(() => colsOf(h, tableOf(h)).insert(0, entries));
  h.history.clear();
  return h;
}

describe("setColumnWidths (T4)", () => {
  it("writes one weight per grid column (a table with no `cols` becomes fixed); unchanged is a no-op; undo restores", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟨c⟩ e¶ ⟧"); // ragged: 3 columns
    const t = tableOf(h);
    inCell(h, t, 0, 1);
    const sel = h.selection;
    expect(tableOf(h).attrs["columnWidths"]).toBeUndefined();
    expect(h.run(setColumnWidths, [1, 1, 2])).toBe(true);
    expect(tableOf(h).attrs["columnWidths"]).toEqual([0.25, 0.25, 0.5]);
    expect(stored(h, t)).toEqual([1, 1, 2]);
    expect(h.selection).toEqual(sel);
    expect(h.run(setColumnWidths, [1, 1, 2])).toBe(false);
    expect(h.run(setColumnWidths, [2, 1, 1])).toBe(true);
    expect(tableOf(h).attrs["columnWidths"]).toEqual([0.5, 0.25, 0.25]);
    expect(h.undo()).toBe(true);
    expect(stored(h, t)).toEqual([1, 1, 2]);
  });

  it("replaces an entry that is no map; appends missing ones; leaves entries past the column count", () => {
    const short = withCols("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨c⟩ c¶ ⟧", ["junk", mapOf({ [WIDTH_KEY]: 1 })]);
    inCell(short, tableOf(short), 0, 0);
    expect(short.run(setColumnWidths, [3, 1, 4])).toBe(true);
    expect(stored(short, tableOf(short))).toEqual([3, 1, 4]);
    const long = withCols("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟧", [1, 2, 9].map((w) => mapOf({ [WIDTH_KEY]: w })));
    inCell(long, tableOf(long), 0, 0);
    expect(long.run(setColumnWidths, [1, 1])).toBe(true);
    expect(stored(long, tableOf(long))).toEqual([1, 1, 9]);
    expect(tableOf(long).attrs["columnWidths"]).toEqual([0.5, 0.5]);
  });

  it("throws on a wrong count or a weight that is not finite and > 0; a no-op outside a table", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟧ q¶");
    inCell(h, tableOf(h), 0, 0);
    for (const ws of [[1], [1, 1, 1], [1, 0], [1, -2], [1, Number.NaN], [1, Number.POSITIVE_INFINITY], [1e308, 1e308]]) expect(() => h.run(setColumnWidths, ws)).toThrow();
    h.caret(h.paragraphs().length - 2, 0);
    expect(h.run(setColumnWidths, [1, 1])).toBe(false);
  });
});
