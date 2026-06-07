import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node";
import { cascadePass } from "../cascade";
import { createMockShaper } from "./mock-shaper";
import { layoutTable } from "./table-fc";
import { makeRootContext } from "./layout-context";
import { INITIAL_COMPUTED_STYLE } from "../styles";

const shaper = createMockShaper(8, 16);

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
    const result = layoutTable(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 600), shaper);
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
    const result = layoutTable(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper);
    if (result.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = result.box;
    if (out.children[0].type !== "table-row") throw new Error("?");
    const row = out.children[0];
    // Each cell is 100px wide; longer text wraps to 2+ lines
    expect(row.height).toBeGreaterThanOrEqual(32);
  });

  it("stretches cells to row height", () => {
    const tree = tableOf(
      [[[createTextBox("a", {}, "x")], [createTextBox("b", {}, "longer text that wraps in this cell")]]],
      [0.5, 0.5],
    );
    if (tree.type !== "element") throw new Error("?");
    const result = layoutTable(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper);
    if (result.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = result.box;
    if (out.children[0].type !== "table-row") throw new Error("?");
    const row = out.children[0];
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
    const result = layoutTable(cascaded, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper);
    if (result.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = result.box;
    expect(out.type).toBe("table");
    expect(out.columnPxWidths).toEqual([24, 40]);
  });

  it("auto-layout uses colMin widths when table overflows", () => {
    // shaper charWidth=8: each word has minContent=8 (one char cluster).
    // "abc" → maxContent=24; "abcde" → maxContent=40.
    // available=30; sumMin=8+8=16 < 30 < sumMax=64.
    // slack = 30-16 = 14; totalRange = 64-16 = 48.
    // col0: min=8, range=16, contribution = 14*(16/48) ≈ 4.67 → 8 + 4.67 ≈ 12.67
    // col1: min=8, range=32, contribution = 14*(32/48) ≈ 9.33 → 8 + 9.33 ≈ 17.33
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
    const result = layoutTable(cascaded, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 30), shaper);
    if (result.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = result.box;
    expect(out.type).toBe("table");
    // Proportional distribution between colMin and colMax.
    const [w0, w1] = out.columnPxWidths;
    expect(w0).toBeCloseTo(8 + 14 * (16 / 48));
    expect(w1).toBeCloseTo(8 + 14 * (32 / 48));
  });

  it("a colSpan-2 cell spans both columns' widths + the next row routes around it (#P8.S2)", () => {
    // Banner: row0 has one cell colSpan-2; row1 has two cells. Fixed columns
    // [0.5, 0.5] over 600 → [300, 300]. The banner's inline-size is the SUM of
    // both columns (600) at offset 0; row1's cells sit at 0/300, 300 wide each.
    const banner = createElementBox(
      "c0", { display: "table-cell" }, [createTextBox("t0", {}, "x")], { colSpan: 2 },
    );
    const row0 = createElementBox("r0", { display: "table-row" }, [banner]);
    const a = createElementBox("c1a", { display: "table-cell" }, [createTextBox("t1", {}, "y")]);
    const b = createElementBox("c1b", { display: "table-cell" }, [createTextBox("t2", {}, "z")]);
    const row1 = createElementBox("r1", { display: "table-row" }, [a, b]);
    const table = cascadePass(
      createElementBox("t", { display: "table" }, [row0, row1], { columnWidths: [0.5, 0.5] }),
    );
    if (table.type !== "element") throw new Error("?");
    const result = layoutTable(table, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 600), shaper);
    if (result.box === null) throw new Error("null");
    const out = result.box;
    expect(out.columnPxWidths).toEqual([300, 300]);
    expect(out.columnCount).toBe(2);

    const r0 = out.children[0];
    if (r0.type !== "table-row") throw new Error("?");
    expect(r0.children).toHaveLength(1);
    const bannerBox = r0.children[0];
    if (bannerBox.type !== "table-cell") throw new Error("?");
    expect(bannerBox.inlineOffset).toBe(0);
    expect(bannerBox.inlineSize).toBe(600);
    expect(bannerBox.gridCol).toBe(0);
    expect(bannerBox.colSpan).toBe(2);

    const r1 = out.children[1];
    if (r1.type !== "table-row") throw new Error("?");
    expect(
      r1.children.map((c) => [c.inlineOffset, c.inlineSize]),
    ).toEqual([[0, 300], [300, 300]]);
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
    const result = layoutTable(cascaded, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper);
    if (result.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = result.box;
    expect(out.type).toBe("table");
    // Exactly one row.
    expect(out.children.length).toBe(1);
    const row = out.children[0];
    expect(row.type).toBe("table-row");
    // Row key is anonymous: "tbl/anon[0]".
    expect(row.key).toBe("tbl/anon[0]");
    // Two cells inside the anonymous row.
    if (row.type !== "table-row") throw new Error("?");
    expect(row.children.length).toBe(2);
    expect(row.children[0].key).toBe("c1");
    expect(row.children[1].key).toBe("c2");
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
    const result = layoutTable(cascaded, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper);
    if (result.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = result.box;
    expect(out.children.length).toBe(2);
    // First row is anonymous (key = "tbl2/anon[0]").
    expect(out.children[0].key).toBe("tbl2/anon[0]");
    // Second row is the real row (key = "rr").
    expect(out.children[1].key).toBe("rr");
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
    const result = layoutTable(cascaded, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper);
    if (result.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = result.box;
    expect(out.children.length).toBe(1);
    const outRow = out.children[0];
    expect(outRow.type).toBe("table-row");
    expect(outRow.key).toBe("r3");
    if (outRow.type !== "table-row") throw new Error("?");
    // One anonymous cell.
    expect(outRow.children.length).toBe(1);
    // Anonymous cell key = "r3/anon[0]".
    expect(outRow.children[0].key).toBe("r3/anon[0]");
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
    const result = layoutTable(cascaded, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 300), shaper);
    if (result.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = result.box;
    expect(out.children.length).toBe(1);
    const outRow = out.children[0];
    if (outRow.type !== "table-row") throw new Error("?");
    expect(outRow.children.length).toBe(3);
    expect(outRow.children[0].key).toBe("rc1");
    expect(outRow.children[1].key).toBe("r4/anon[1]");
    expect(outRow.children[2].key).toBe("rc2");
  });
});
