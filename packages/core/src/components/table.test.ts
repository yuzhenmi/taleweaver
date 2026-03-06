import { describe, it, expect } from "vitest";
import { tableComponent } from "./table";
import { tableRowComponent } from "./table-row";
import { tableCellComponent } from "./table-cell";
import { createNode, createTextNode } from "../state/create-node";
import { createTextRenderNode } from "../render/text-render-node";
import { createBlockNode } from "../render/block-render-node";
import { getTextContent } from "../state/text-utils";

describe("tableComponent.createInitialState", () => {
  it("produces correct nested structure", () => {
    let nextId = 0;
    const allocateId = () => `id-${nextId++}`;
    const node = tableComponent.createInitialState!(
      "table-1",
      { rows: 2, columns: 3, columnWidths: [1/3, 1/3, 1/3] },
      allocateId,
    );

    expect(node.type).toBe("table");
    expect(node.id).toBe("table-1");
    expect(node.children).toHaveLength(2); // 2 rows
    for (const row of node.children) {
      expect(row.type).toBe("table-row");
      expect(row.children).toHaveLength(3); // 3 cells
      for (const cell of row.children) {
        expect(cell.type).toBe("table-cell");
        expect(cell.children).toHaveLength(1); // 1 paragraph
        const para = cell.children[0];
        expect(para.type).toBe("paragraph");
        expect(para.children).toHaveLength(1); // 1 text node
        expect(para.children[0].type).toBe("text");
        expect(getTextContent(para.children[0])).toBe("");
      }
    }
  });

  it("stores columnWidths in properties", () => {
    let nextId = 0;
    const allocateId = () => `id-${nextId++}`;
    const node = tableComponent.createInitialState!(
      "table-1",
      { rows: 1, columns: 2, columnWidths: [0.4, 0.6] },
      allocateId,
    );
    expect(node.properties.columnWidths).toEqual([0.4, 0.6]);
  });

  it("stores rowHeights in properties", () => {
    let nextId = 0;
    const allocateId = () => `id-${nextId++}`;
    const node = tableComponent.createInitialState!(
      "table-1",
      { rows: 3, columns: 1, columnWidths: [1] },
      allocateId,
    );
    expect(node.properties.rowHeights).toEqual([0, 0, 0]);
  });

  it("allocates unique IDs via allocateId", () => {
    const ids: string[] = [];
    const allocateId = () => {
      const id = `id-${ids.length}`;
      ids.push(id);
      return id;
    };
    tableComponent.createInitialState!(
      "table-1",
      { rows: 1, columns: 2, columnWidths: [0.5, 0.5] },
      allocateId,
    );
    // Should have allocated IDs for: 2*(text + para + cell) + 1 row = 7
    expect(ids.length).toBe(7);
    // All IDs should be unique
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("tableComponent", () => {
  it("renders a table render node", () => {
    const node = createNode("t1", "table", {
      columnWidths: [0.4, 0.6],
      rowHeights: [0, 0],
    });
    const result = tableComponent.render(node, []);
    expect(result.type).toBe("table");
  });

  it("propagates columnWidths and rowHeights from properties", () => {
    const node = createNode("t1", "table", {
      columnWidths: [0.4, 0.6],
      rowHeights: [0, 50],
    });
    const result = tableComponent.render(node, []);
    if (result.type !== "table") throw new Error("expected table");
    expect(result.columnWidths).toEqual([0.4, 0.6]);
    expect(result.rowHeights).toEqual([0, 50]);
  });

  it("passes children through", () => {
    const child = createBlockNode("row1", {}, []);
    const node = createNode("t1", "table", {
      columnWidths: [1],
      rowHeights: [0],
    });
    const result = tableComponent.render(node, [child]);
    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toBe(child);
  });

  it("defaults to empty arrays when properties are missing", () => {
    const node = createNode("t1", "table", {});
    const result = tableComponent.render(node, []);
    if (result.type !== "table") throw new Error("expected table");
    expect(result.columnWidths).toEqual([]);
    expect(result.rowHeights).toEqual([]);
  });
});

describe("tableRowComponent", () => {
  it("renders a block node with zero margins", () => {
    const node = createNode("r1", "table-row", {});
    const result = tableRowComponent.render(node, []);
    expect(result.type).toBe("block");
    expect(result.styles.lineMarginTop).toBe(0);
    expect(result.styles.lineMarginBottom).toBe(0);
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
