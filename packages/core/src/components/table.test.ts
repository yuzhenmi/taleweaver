import { describe, it, expect } from "vitest";
import { tableComponent } from "./table";
import { tableRowComponent } from "./table-row";
import { tableCellComponent } from "./table-cell";
import { createNode, createTextNode } from "../state/create-node";
import { createTextRenderNode } from "../render/text-render-node";
import { createBlockNode } from "../render/block-render-node";

describe("tableComponent", () => {
  it("renders a grid render node", () => {
    const node = createNode("t1", "table", {
      columnWidths: [100, 200],
      rowHeights: [0, 0],
    });
    const result = tableComponent.render(node, []);
    expect(result.type).toBe("grid");
  });

  it("propagates columnWidths and rowHeights from properties", () => {
    const node = createNode("t1", "table", {
      columnWidths: [100, 200],
      rowHeights: [0, 50],
    });
    const result = tableComponent.render(node, []);
    if (result.type !== "grid") throw new Error("expected grid");
    expect(result.columnWidths).toEqual([100, 200]);
    expect(result.rowHeights).toEqual([0, 50]);
  });

  it("passes children through", () => {
    const child = createBlockNode("row1", {}, []);
    const node = createNode("t1", "table", {
      columnWidths: [100],
      rowHeights: [0],
    });
    const result = tableComponent.render(node, [child]);
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toBe(child);
  });

  it("defaults to empty arrays when properties are missing", () => {
    const node = createNode("t1", "table", {});
    const result = tableComponent.render(node, []);
    if (result.type !== "grid") throw new Error("expected grid");
    expect(result.columnWidths).toEqual([]);
    expect(result.rowHeights).toEqual([]);
  });
});

describe("tableRowComponent", () => {
  it("renders a block node with zero margins", () => {
    const node = createNode("r1", "table-row", {});
    const result = tableRowComponent.render(node, []);
    expect(result.type).toBe("block");
    expect(result.styles.marginTop).toBe(0);
    expect(result.styles.marginBottom).toBe(0);
  });

  it("passes children through", () => {
    const child = createBlockNode("cell1", {}, []);
    const node = createNode("r1", "table-row", {});
    const result = tableRowComponent.render(node, [child]);
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toBe(child);
  });
});

describe("tableCellComponent", () => {
  it("renders a block node with 4px padding", () => {
    const node = createNode("c1", "table-cell", {});
    const result = tableCellComponent.render(node, []);
    expect(result.type).toBe("block");
    expect(result.styles.paddingTop).toBe(4);
    expect(result.styles.paddingBottom).toBe(4);
    expect(result.styles.paddingLeft).toBe(4);
    expect(result.styles.paddingRight).toBe(4);
  });

  it("passes children through", () => {
    const child = createTextRenderNode("t1", "text", {});
    const node = createNode("c1", "table-cell", {});
    const result = tableCellComponent.render(node, [child]);
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toBe(child);
  });
});
