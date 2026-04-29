import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node-v2";
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
    const out = layoutTable(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 600), shaper);
    expect(out.type).toBe("table");
    expect(out.columnPxWidths).toEqual([300, 300]);
  });

  it("row height = max cell height", () => {
    const tree = tableOf(
      [[[createTextBox("a", {}, "short")], [createTextBox("b", {}, "longer text that wraps")]]],
      [0.5, 0.5],
    );
    if (tree.type !== "element") throw new Error("?");
    const out = layoutTable(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper);
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
    const out = layoutTable(tree, 0, 0, makeRootContext(INITIAL_COMPUTED_STYLE, 200), shaper);
    if (out.children[0].type !== "table-row") throw new Error("?");
    const row = out.children[0];
    // Both cells should have row.height
    for (const cell of row.children) {
      expect(cell.height).toBe(row.height);
    }
  });
});
