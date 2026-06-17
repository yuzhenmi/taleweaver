import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { layoutTable } from "./table-fc";
import { makeRootContext } from "./layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";

const shaper = createMockShaper(8, 16);

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

function tableOf(rows: Array<Array<ReturnType<typeof createTextBox>[]>>, columnWidths: number[]) {
  return cascadePass(createElementBox(
    "t",
    { display: "table" },
    rows.map((cells, ri) =>
      createElementBox(`r${ri}`, { display: "table-row" }, cells.map((cellChildren, ci) =>
        createElementBox(`c${ri}-${ci}`, { display: "table-cell" }, cellChildren)
      ))
    ),
    { columnWidths },
  ));
}

describe("layoutTable", () => {
  it("distributes column widths by fractions", () => {
    const tree = tableOf(
      [[[createTextBox("a", {}, "x")], [createTextBox("b", {}, "y")]]],
      [0.5, 0.5],
    );
    if (tree.type !== "element") throw new Error("?");
    const result = layoutTable(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 600), shaper, undefined);
    if (result.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = result.box;
    expect(out.type).toBe("table");
    expect(out.columnPxWidths).toEqual([300, 300]);
  });

  it("row height = max cell height", () => {
    const tree = tableOf(
      [[[createTextBox("a", {}, "short")], [createTextBox("b", {}, "longer text that wraps")]]],
      [0.5, 0.5],
    );
    if (tree.type !== "element") throw new Error("?");
    const result = layoutTable(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper, undefined);
    if (result.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = result.box;
    const row = nth(out.children, 0, "table-row");
    if (row.type !== "table-row") throw new Error("?");
    // Each cell is 100px wide; longer text wraps to 2+ lines
    expect(row.height).toBeGreaterThanOrEqual(32);
  });

  it("stretches cells to row height", () => {
    const tree = tableOf(
      [[[createTextBox("a", {}, "x")], [createTextBox("b", {}, "longer text that wraps in this cell")]]],
      [0.5, 0.5],
    );
    if (tree.type !== "element") throw new Error("?");
    const result = layoutTable(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper, undefined);
    if (result.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = result.box;
    const row = nth(out.children, 0, "table-row");
    if (row.type !== "table-row") throw new Error("?");
    // Both cells should have row.height
    for (const cell of row.children) {
      expect(cell.height).toBe(row.height);
    }
  });

  it("table with no explicit column widths uses auto-layout from per-cell intrinsic sizes", () => {
    // shaper has charWidth=8: "abc" → minContent=8, maxContent=24
    //                         "abcde" → minContent=8, maxContent=40
    // sumMax = 24 + 40 = 64 <= available(200), so each column = colMax.
    const cell1a = createElementBox("c1a", { display: "table-cell" }, [
      createTextBox("t1", {}, "abc"),
    ]);
    const cell1b = createElementBox("c1b", { display: "table-cell" }, [
      createTextBox("t2", {}, "abcde"),
    ]);
    const row = createElementBox("r", { display: "table-row" }, [cell1a, cell1b]);
    const table = createElementBox("t", { display: "table" }, [row]);
    const cascaded = cascadePass(table);
    if (cascaded.type !== "element") throw new Error("?");
    const result = layoutTable(cascaded, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper, undefined);
    if (result.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = result.box;
    expect(out.type).toBe("table");
    expect(out.columnPxWidths).toEqual([24, 40]);
  });

  it("auto-layout uses colMin widths when table overflows", () => {
    // shaper charWidth=8. Each cell holds ONE unbreakable word (no internal break
    // opportunity), so its minContent equals its maxContent (the whole word):
    // "abc" → min=max=24; "abcde" → min=max=40. sumMin=24+40=64.
    // available=30 < sumMin=64, so the table OVERFLOWS: each column floors at its
    // colMin (no slack to distribute). columns = colMins = [24, 40].
    const cell1a = createElementBox("c2a", { display: "table-cell" }, [
      createTextBox("t3", {}, "abc"),
    ]);
    const cell1b = createElementBox("c2b", { display: "table-cell" }, [
      createTextBox("t4", {}, "abcde"),
    ]);
    const row = createElementBox("r2", { display: "table-row" }, [cell1a, cell1b]);
    const table = createElementBox("t2", { display: "table" }, [row]);
    const cascaded = cascadePass(table);
    if (cascaded.type !== "element") throw new Error("?");
    const result = layoutTable(cascaded, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 30), shaper, undefined);
    if (result.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = result.box;
    expect(out.type).toBe("table");
    // Overflow: each column floors at its colMin (the whole unbreakable word).
    const [w0, w1] = out.columnPxWidths;
    expect(w0).toBeCloseTo(24); // "abc" colMin
    expect(w1).toBeCloseTo(40); // "abcde" colMin
  });

  // #P8.S2 — a colSpan-2 cell spans both columns; the next row routes around it.
  // Fixed columns [0.5, 0.5] over 600 → [300, 300]: the banner's inline-size is
  // the SUM of both columns (600) at offset 0; row1's cells sit at 0/300.
  // Parametrized over writing mode (#P8.S2.T6): the grid + colSpan inline-axis
  // math is purely LOGICAL, so vertical-rl must yield the SAME logical
  // inlineOffset/inlineSize (only the physical mapping differs at paint).
  for (const wm of ["horizontal-tb", "vertical-rl"] as const) {
    it(`a colSpan-2 cell spans both columns' widths + next row routes around it (${wm}, #P8.S2)`, () => {
      const banner = createElementBox(
        "c0", { display: "table-cell" }, [createTextBox("t0", {}, "x")], { colSpan: 2 },
      );
      const row0 = createElementBox("r0", { display: "table-row" }, [banner]);
      const a = createElementBox("c1a", { display: "table-cell" }, [createTextBox("t1", {}, "y")]);
      const b = createElementBox("c1b", { display: "table-cell" }, [createTextBox("t2", {}, "z")]);
      const row1 = createElementBox("r1", { display: "table-row" }, [a, b]);
      const table = cascadePass(
        createElementBox("t", { display: "table", writingMode: wm }, [row0, row1], {
          columnWidths: [0.5, 0.5],
        }),
      );
      if (table.type !== "element" || !table.computedStyle) throw new Error("?");
      const result = layoutTable(table, 0, 0, makeRootContext(table.computedStyle, 600), shaper, undefined);
      if (result.box === null) throw new Error("null");
      const out = result.box;
      expect(out.writingMode).toBe(wm);
      expect(out.columnPxWidths).toEqual([300, 300]);
      expect(out.columnCount).toBe(2);

      const r0 = nth(out.children, 0, "table-row");
      if (r0.type !== "table-row") throw new Error("?");
      expect(r0.children).toHaveLength(1);
      const bannerBox = nth(r0.children, 0, "cell");
      if (bannerBox.type !== "table-cell") throw new Error("?");
      expect(bannerBox.writingMode).toBe(wm);
      expect(bannerBox.inlineOffset).toBe(0);
      expect(bannerBox.inlineSize).toBe(600); // spans both logical columns — same in both modes
      expect(bannerBox.gridCol).toBe(0);
      expect(bannerBox.colSpan).toBe(2);

      const r1 = nth(out.children, 1, "table-row");
      if (r1.type !== "table-row") throw new Error("?");
      expect(
        r1.children.map((c) => [c.inlineOffset, c.inlineSize]),
      ).toEqual([[0, 300], [300, 300]]);
    });
  }

  it("auto-layout distributes a colSpan-2 cell's width across its columns (§17.4, #P8.S2)", () => {
    // charWidth=8. Banner "abcdefgh" colSpan-2: min 8, max 64. Row1 cells
    // "abc" (max 24) and "ab" (max 16) set the span-1 bases. The banner's max
    // shortfall (64 − 40 = 24) distributes proportional to [24, 16] →
    // col0 += 24·24/40 = 14.4 → 38.4; col1 += 24·16/40 = 9.6 → 25.6.
    // available 200 ≥ sumMax 64, so each column gets its max-content width.
    // The OLD sequential walk charged the whole 64 to col0 → [64, 16].
    const banner = createElementBox(
      "c0", { display: "table-cell" }, [createTextBox("t0", {}, "abcdefgh")], { colSpan: 2 },
    );
    const row0 = createElementBox("r0", { display: "table-row" }, [banner]);
    const a = createElementBox("c1a", { display: "table-cell" }, [createTextBox("t1", {}, "abc")]);
    const b = createElementBox("c1b", { display: "table-cell" }, [createTextBox("t2", {}, "ab")]);
    const row1 = createElementBox("r1", { display: "table-row" }, [a, b]);
    const cascaded = cascadePass(createElementBox("t", { display: "table" }, [row0, row1]));
    if (cascaded.type !== "element") throw new Error("?");
    const result = layoutTable(cascaded, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper, undefined);
    if (result.box === null) throw new Error("null");
    const out = result.box;
    expect(out.columnCount).toBe(2);
    const [w0, w1] = out.columnPxWidths;
    expect(w0).toBeCloseTo(38.4);
    expect(w1).toBeCloseTo(25.6);

    const r0 = nth(out.children, 0, "table-row");
    if (r0.type !== "table-row") throw new Error("?");
    const bannerBox = nth(r0.children, 0, "cell");
    if (bannerBox.type !== "table-cell") throw new Error("?");
    expect(bannerBox.inlineSize).toBeCloseTo(64); // spans both columns
  });

  // #P8.S3 — a rowSpan-2 sidebar cell spans both rows; later rows route around
  // it via occupancy. Parametrized over writing mode (#P8.S3.T3): the block-axis
  // distribution is purely LOGICAL, so vertical-rl yields identical logical
  // blockOffset/blockSize.
  for (const wm of ["horizontal-tb", "vertical-rl"] as const) {
    it(`rowSpan-2 cell spans both rows; next row routes around it (${wm}, #P8.S3)`, () => {
      const cellA = createElementBox(
        "a", { display: "table-cell" }, [createTextBox("ta", {}, "a")], { rowSpan: 2 },
      );
      const cellB = createElementBox("b", { display: "table-cell" }, [createTextBox("tb", {}, "b")]);
      const row0 = createElementBox("r0", { display: "table-row" }, [cellA, cellB]);
      const cellC = createElementBox("c", { display: "table-cell" }, [createTextBox("tc", {}, "c")]);
      const row1 = createElementBox("r1", { display: "table-row" }, [cellC]);
      const table = cascadePass(
        createElementBox("t", { display: "table", writingMode: wm }, [row0, row1], {
          columnWidths: [0.5, 0.5],
        }),
      );
      if (table.type !== "element" || !table.computedStyle) throw new Error("?");
      const result = layoutTable(table, 0, 0, makeRootContext(table.computedStyle, 400), shaper, undefined);
      if (result.box === null) throw new Error("null");
      const out = result.box;
      expect(out.columnCount).toBe(2);

      const r0 = nth(out.children, 0, "table-row");
      const r1 = nth(out.children, 1, "table-row");
      if (r0.type !== "table-row" || r1.type !== "table-row") throw new Error("?");

      // row0 holds A (col0, rowSpan2) + B (col1). A spans both rows' heights.
      const aBox = r0.children.find((c) => c.type === "table-cell" && c.gridCol === 0);
      if (aBox === undefined || aBox.type !== "table-cell") throw new Error("A?");
      expect(aBox.rowSpan).toBe(2);
      expect(aBox.gridCol).toBe(0);
      expect(aBox.inlineOffset).toBe(0);
      expect(aBox.blockOffset).toBe(0);
      expect(aBox.blockSize).toBe(r0.blockSize + r1.blockSize); // spans both rows

      // row1 holds only C, routed to col1 (col0 still occupied by A).
      expect(r1.children).toHaveLength(1);
      const cBox = nth(r1.children, 0, "cell");
      if (cBox.type !== "table-cell") throw new Error("C?");
      expect(cBox.gridCol).toBe(1);
      expect(cBox.inlineOffset).toBe(200); // sum of col0 width
      expect(r1.blockOffset).toBe(r0.blockSize); // rows stack
    });
  }

  it("rowSpan cell taller than its rows distributes the deficit (§17.5.3, #P8.S3)", () => {
    // cellA (rowSpan-2) holds 3 stacked block lines → interior 48 (3×16).
    // B and C are single-line (16). Base rows = [16, 16], Σ=32 < 48 → deficit 16
    // distributed equally → rows [24, 24]; A spans 48.
    const cellA = createElementBox(
      "a", { display: "table-cell" }, [
        createElementBox("ap0", { display: "block" }, [createTextBox("a0", {}, "x")]),
        createElementBox("ap1", { display: "block" }, [createTextBox("a1", {}, "y")]),
        createElementBox("ap2", { display: "block" }, [createTextBox("a2", {}, "z")]),
      ], { rowSpan: 2 },
    );
    const cellB = createElementBox("b", { display: "table-cell" }, [createTextBox("tb", {}, "b")]);
    const row0 = createElementBox("r0", { display: "table-row" }, [cellA, cellB]);
    const cellC = createElementBox("c", { display: "table-cell" }, [createTextBox("tc", {}, "c")]);
    const row1 = createElementBox("r1", { display: "table-row" }, [cellC]);
    const table = cascadePass(
      createElementBox("t", { display: "table" }, [row0, row1], { columnWidths: [0.5, 0.5] }),
    );
    if (table.type !== "element" || !table.computedStyle) throw new Error("?");
    const result = layoutTable(table, 0, 0, makeRootContext(table.computedStyle, 400), shaper, undefined);
    if (result.box === null) throw new Error("null");
    const out = result.box;

    const r0 = nth(out.children, 0, "table-row");
    const r1 = nth(out.children, 1, "table-row");
    if (r0.type !== "table-row" || r1.type !== "table-row") throw new Error("?");
    expect(r0.blockSize).toBe(24); // grew from 16
    expect(r1.blockSize).toBe(24); // equal split
    const aBox = r0.children.find((c) => c.type === "table-cell" && c.gridCol === 0);
    if (aBox === undefined || aBox.type !== "table-cell") throw new Error("A?");
    expect(aBox.blockSize).toBe(48); // = r0 + r1, absorbs the tall interior
  });

  it("bare table-cell direct children are wrapped in an anonymous row", () => {
    // Two table-cell children placed directly inside the table (no table-row).
    // The layout should produce exactly one TableRowBox (anonymous) containing both cells.
    const cell1 = createElementBox("c1", { display: "table-cell" }, [
      createTextBox("t1", {}, "a"),
    ]);
    const cell2 = createElementBox("c2", { display: "table-cell" }, [
      createTextBox("t2", {}, "b"),
    ]);
    const table = createElementBox("tbl", { display: "table" }, [cell1, cell2]);
    const cascaded = cascadePass(table);
    if (cascaded.type !== "element") throw new Error("?");
    const result = layoutTable(cascaded, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper, undefined);
    if (result.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = result.box;
    expect(out.type).toBe("table");
    // Exactly one row.
    expect(out.children.length).toBe(1);
    const row = nth(out.children, 0, "table-row");
    expect(row.type).toBe("table-row");
    // Row key is anonymous: "tbl/anon[0]".
    expect(row.key).toBe("tbl/anon[0]");
    // Two cells inside the anonymous row.
    if (row.type !== "table-row") throw new Error("?");
    expect(row.children.length).toBe(2);
    expect(nth(row.children, 0, "cell").key).toBe("c1");
    expect(nth(row.children, 1, "cell").key).toBe("c2");
  });

  it("mixed table-cell and table-row direct children: bare cells get anonymous row, real rows pass through", () => {
    // First two bare cells → anonymous row; then a proper row.
    const bareCell = createElementBox("bc", { display: "table-cell" }, [
      createTextBox("bt", {}, "bare"),
    ]);
    const realCell = createElementBox("rc", { display: "table-cell" }, [
      createTextBox("rt", {}, "real"),
    ]);
    const realRow = createElementBox("rr", { display: "table-row" }, [realCell]);
    const table = createElementBox("tbl2", { display: "table" }, [bareCell, realRow]);
    const cascaded = cascadePass(table);
    if (cascaded.type !== "element") throw new Error("?");
    const result = layoutTable(cascaded, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper, undefined);
    if (result.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = result.box;
    expect(out.children.length).toBe(2);
    // First row is anonymous (key = "tbl2/anon[0]").
    expect(nth(out.children, 0, "row").key).toBe("tbl2/anon[0]");
    // Second row is the real row (key = "rr").
    expect(nth(out.children, 1, "row").key).toBe("rr");
  });

  it("table-row with block child wraps it in an anonymous cell", () => {
    // A paragraph (display:block) inside a table-row should be wrapped in an
    // anonymous table-cell so the layout tree is structurally valid.
    const para = createElementBox("p", { display: "block" }, [
      createTextBox("pt", {}, "hello"),
    ]);
    const row = createElementBox("r3", { display: "table-row" }, [para]);
    const table = createElementBox("tbl3", { display: "table" }, [row]);
    const cascaded = cascadePass(table);
    if (cascaded.type !== "element") throw new Error("?");
    const result = layoutTable(cascaded, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper, undefined);
    if (result.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = result.box;
    expect(out.children.length).toBe(1);
    const outRow = nth(out.children, 0, "table-row");
    expect(outRow.type).toBe("table-row");
    expect(outRow.key).toBe("r3");
    if (outRow.type !== "table-row") throw new Error("?");
    // One anonymous cell.
    expect(outRow.children.length).toBe(1);
    // Anonymous cell key = "r3/anon[0]".
    expect(nth(outRow.children, 0, "cell").key).toBe("r3/anon[0]");
  });

  it("table-row with mixed cell and non-cell children: non-cell gets anonymous cell", () => {
    // A row with: [real-cell, block-para, real-cell].
    // Expected: [cell "rc1", anon-cell "r4/anon[1]", cell "rc2"].
    const realCell1 = createElementBox("rc1", { display: "table-cell" }, [
      createTextBox("rt1", {}, "a"),
    ]);
    const blockPara = createElementBox("para", { display: "block" }, [
      createTextBox("bt1", {}, "between"),
    ]);
    const realCell2 = createElementBox("rc2", { display: "table-cell" }, [
      createTextBox("rt2", {}, "b"),
    ]);
    const row = createElementBox("r4", { display: "table-row" }, [realCell1, blockPara, realCell2]);
    const table = createElementBox("tbl4", { display: "table" }, [row]);
    const cascaded = cascadePass(table);
    if (cascaded.type !== "element") throw new Error("?");
    const result = layoutTable(cascaded, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 300), shaper, undefined);
    if (result.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = result.box;
    expect(out.children.length).toBe(1);
    const outRow = nth(out.children, 0, "table-row");
    if (outRow.type !== "table-row") throw new Error("?");
    expect(outRow.children.length).toBe(3);
    expect(nth(outRow.children, 0, "cell").key).toBe("rc1");
    expect(nth(outRow.children, 1, "cell").key).toBe("r4/anon[1]");
    expect(nth(outRow.children, 2, "cell").key).toBe("rc2");
  });
});
