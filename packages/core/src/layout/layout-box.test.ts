import { describe, it, expect } from "vitest";
import { createBlockLayoutBox } from "./block-layout-box";
import { createGridLayoutBox } from "./grid-layout-box";
import { createLineLayoutBox } from "./line-layout-box";
import { createPageLayoutBox } from "./page-layout-box";
import { createTextLayoutBox } from "./text-layout-box";

describe("createTextLayoutBox", () => {
  it("creates a text layout box with correct properties", () => {
    const box = createTextLayoutBox("t1", 10, 20, 80, 16, "hello");
    expect(box.key).toBe("t1");
    expect(box.type).toBe("text");
    expect(box.x).toBe(10);
    expect(box.y).toBe(20);
    expect(box.width).toBe(80);
    expect(box.height).toBe(16);
    expect(box.text).toBe("hello");
    expect(box.children).toHaveLength(0);
  });

  it("freezes the returned box", () => {
    const box = createTextLayoutBox("t1", 0, 0, 10, 10, "a");
    expect(Object.isFrozen(box)).toBe(true);
  });

  it("freezes the children array", () => {
    const box = createTextLayoutBox("t1", 0, 0, 10, 10, "a");
    expect(Object.isFrozen(box.children)).toBe(true);
  });
});

describe("createLineLayoutBox", () => {
  it("creates a line layout box with text children", () => {
    const text = createTextLayoutBox("t1", 0, 0, 40, 16, "hello");
    const line = createLineLayoutBox("line1", 0, 0, 100, 16, [text]);
    expect(line.key).toBe("line1");
    expect(line.type).toBe("line");
    expect(line.children).toHaveLength(1);
    expect(line.children[0]).toBe(text);
  });

  it("freezes the returned box", () => {
    const line = createLineLayoutBox("line1", 0, 0, 100, 16, []);
    expect(Object.isFrozen(line)).toBe(true);
  });

  it("freezes the children array", () => {
    const text = createTextLayoutBox("t1", 0, 0, 40, 16, "hi");
    const line = createLineLayoutBox("line1", 0, 0, 100, 16, [text]);
    expect(Object.isFrozen(line.children)).toBe(true);
  });

  it("copies children array defensively", () => {
    const text = createTextLayoutBox("t1", 0, 0, 40, 16, "hi");
    const children = [text];
    const line = createLineLayoutBox("line1", 0, 0, 100, 16, children);
    children.push(createTextLayoutBox("t2", 0, 0, 40, 16, "bye"));
    expect(line.children).toHaveLength(1);
  });

  it("throws if child is a block box", () => {
    const block = createBlockLayoutBox("b1", 0, 0, 100, 50, []);
    expect(() =>
      createLineLayoutBox("line1", 0, 0, 100, 16, [block]),
    ).toThrow(/can only contain text children/);
  });

  it("throws if child is a line box", () => {
    const innerLine = createLineLayoutBox("inner", 0, 0, 100, 16, []);
    expect(() =>
      createLineLayoutBox("line1", 0, 0, 100, 16, [innerLine]),
    ).toThrow(/can only contain text children/);
  });
});

describe("createBlockLayoutBox", () => {
  it("creates a block layout box with line children", () => {
    const line = createLineLayoutBox("line1", 0, 0, 100, 16, []);
    const block = createBlockLayoutBox("b1", 0, 0, 100, 16, [line]);
    expect(block.key).toBe("b1");
    expect(block.type).toBe("block");
    expect(block.children).toHaveLength(1);
    expect(block.children[0]).toBe(line);
  });

  it("accepts nested block children", () => {
    const innerBlock = createBlockLayoutBox("inner", 0, 0, 100, 50, []);
    const outer = createBlockLayoutBox("outer", 0, 0, 100, 100, [innerBlock]);
    expect(outer.children).toHaveLength(1);
  });

  it("freezes the returned box", () => {
    const block = createBlockLayoutBox("b1", 0, 0, 100, 50, []);
    expect(Object.isFrozen(block)).toBe(true);
  });

  it("freezes the children array", () => {
    const block = createBlockLayoutBox("b1", 0, 0, 100, 50, []);
    expect(Object.isFrozen(block.children)).toBe(true);
  });

  it("copies children array defensively", () => {
    const line = createLineLayoutBox("line1", 0, 0, 100, 16, []);
    const children = [line];
    const block = createBlockLayoutBox("b1", 0, 0, 100, 50, children);
    children.push(createLineLayoutBox("line2", 0, 0, 100, 16, []));
    expect(block.children).toHaveLength(1);
  });

  it("throws if child is a text box", () => {
    const text = createTextLayoutBox("t1", 0, 0, 40, 16, "hello");
    expect(() =>
      createBlockLayoutBox("b1", 0, 0, 100, 50, [text]),
    ).toThrow(/cannot directly contain text child/);
  });

  it("accepts optional metadata", () => {
    const block = createBlockLayoutBox("b1", 0, 0, 100, 50, [], undefined, { type: "horizontal-line" });
    expect(block.metadata).toEqual({ type: "horizontal-line" });
  });

  it("freezes metadata", () => {
    const block = createBlockLayoutBox("b1", 0, 0, 100, 50, [], undefined, { type: "image" });
    expect(Object.isFrozen(block.metadata)).toBe(true);
  });

  it("omits metadata when not provided", () => {
    const block = createBlockLayoutBox("b1", 0, 0, 100, 50, []);
    expect(block.metadata).toBeUndefined();
  });
});

describe("createPageLayoutBox", () => {
  it("creates a page layout box with correct properties", () => {
    const line = createLineLayoutBox("line1", 0, 0, 100, 16, []);
    const block = createBlockLayoutBox("b1", 0, 0, 100, 16, [line]);
    const page = createPageLayoutBox("page-0", 0, 0, 200, 500, [block]);
    expect(page.key).toBe("page-0");
    expect(page.type).toBe("page");
    expect(page.x).toBe(0);
    expect(page.y).toBe(0);
    expect(page.width).toBe(200);
    expect(page.height).toBe(500);
    expect(page.children).toHaveLength(1);
    expect(page.children[0]).toBe(block);
  });

  it("freezes the returned box", () => {
    const page = createPageLayoutBox("page-0", 0, 0, 200, 500, []);
    expect(Object.isFrozen(page)).toBe(true);
  });

  it("freezes the children array", () => {
    const page = createPageLayoutBox("page-0", 0, 0, 200, 500, []);
    expect(Object.isFrozen(page.children)).toBe(true);
  });

  it("throws if child is a text box", () => {
    const text = createTextLayoutBox("t1", 0, 0, 40, 16, "hello");
    expect(() =>
      createPageLayoutBox("page-0", 0, 0, 200, 500, [text]),
    ).toThrow(/cannot directly contain text child/);
  });
});

describe("createGridLayoutBox", () => {
  it("creates a grid layout box with correct properties", () => {
    const row = createBlockLayoutBox("row1", 0, 0, 300, 24, []);
    const grid = createGridLayoutBox("g1", 10, 20, 300, 48, [row], [100, 200], [24, 24]);
    expect(grid.key).toBe("g1");
    expect(grid.type).toBe("grid");
    expect(grid.x).toBe(10);
    expect(grid.y).toBe(20);
    expect(grid.width).toBe(300);
    expect(grid.height).toBe(48);
    expect(grid.children).toHaveLength(1);
    expect(grid.children[0]).toBe(row);
    expect(grid.columnWidths).toEqual([100, 200]);
    expect(grid.rowHeights).toEqual([24, 24]);
  });

  it("freezes the returned box", () => {
    const grid = createGridLayoutBox("g1", 0, 0, 100, 50, [], [100], [0]);
    expect(Object.isFrozen(grid)).toBe(true);
  });

  it("freezes children, columnWidths, and rowHeights", () => {
    const grid = createGridLayoutBox("g1", 0, 0, 100, 50, [], [100], [0]);
    expect(Object.isFrozen(grid.children)).toBe(true);
    expect(Object.isFrozen(grid.columnWidths)).toBe(true);
    expect(Object.isFrozen(grid.rowHeights)).toBe(true);
  });

  it("copies arrays defensively", () => {
    const children = [createBlockLayoutBox("row1", 0, 0, 100, 24, [])];
    const colWidths = [100];
    const rowHeights = [24];
    const grid = createGridLayoutBox("g1", 0, 0, 100, 24, children, colWidths, rowHeights);
    children.push(createBlockLayoutBox("row2", 0, 0, 100, 24, []));
    colWidths.push(200);
    rowHeights.push(30);
    expect(grid.children).toHaveLength(1);
    expect(grid.columnWidths).toHaveLength(1);
    expect(grid.rowHeights).toHaveLength(1);
  });
});
