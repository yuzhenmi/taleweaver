import { describe, it, expect } from "vitest";
import { createBlockNode } from "./block-render-node";
import { createGridNode } from "./grid-render-node";
import { createInlineNode } from "./inline-render-node";
import { createTextRenderNode } from "./text-render-node";

describe("createTextRenderNode", () => {
  it("creates a text render node with correct properties", () => {
    const node = createTextRenderNode("t1", "hello", { fontSize: 16 });
    expect(node.key).toBe("t1");
    expect(node.type).toBe("text");
    expect(node.text).toBe("hello");
    expect(node.styles.fontSize).toBe(16);
    expect(node.children).toHaveLength(0);
  });

  it("freezes the node", () => {
    const node = createTextRenderNode("t1", "hi", {});
    expect(Object.isFrozen(node)).toBe(true);
  });

  it("freezes styles", () => {
    const node = createTextRenderNode("t1", "hi", { fontWeight: "bold" });
    expect(Object.isFrozen(node.styles)).toBe(true);
  });

  it("freezes children", () => {
    const node = createTextRenderNode("t1", "hi", {});
    expect(Object.isFrozen(node.children)).toBe(true);
  });

  it("copies styles defensively", () => {
    const styles = { fontSize: 16 };
    const node = createTextRenderNode("t1", "hi", styles);
    styles.fontSize = 32;
    expect(node.styles.fontSize).toBe(16);
  });
});

describe("createBlockNode", () => {
  it("creates a block render node", () => {
    const child = createTextRenderNode("t1", "hi", {});
    const block = createBlockNode("b1", { marginTop: 10 }, [child]);
    expect(block.key).toBe("b1");
    expect(block.type).toBe("block");
    expect(block.styles.marginTop).toBe(10);
    expect(block.children).toHaveLength(1);
    expect(block.children[0]).toBe(child);
  });

  it("freezes the node", () => {
    const block = createBlockNode("b1", {}, []);
    expect(Object.isFrozen(block)).toBe(true);
  });

  it("freezes styles and children", () => {
    const block = createBlockNode("b1", {}, []);
    expect(Object.isFrozen(block.styles)).toBe(true);
    expect(Object.isFrozen(block.children)).toBe(true);
  });

  it("copies children defensively", () => {
    const child = createTextRenderNode("t1", "hi", {});
    const children = [child];
    const block = createBlockNode("b1", {}, children);
    children.push(createTextRenderNode("t2", "bye", {}));
    expect(block.children).toHaveLength(1);
  });

  it("accepts optional metadata", () => {
    const block = createBlockNode("b1", {}, [], undefined, { type: "image", src: "data:image/png;base64,abc" });
    expect(block.metadata).toEqual({ type: "image", src: "data:image/png;base64,abc" });
  });

  it("freezes metadata", () => {
    const block = createBlockNode("b1", {}, [], undefined, { type: "hr" });
    expect(Object.isFrozen(block.metadata)).toBe(true);
  });

  it("omits metadata when not provided", () => {
    const block = createBlockNode("b1", {}, []);
    expect(block.metadata).toBeUndefined();
  });

  it("accepts any child types without constraint", () => {
    const text = createTextRenderNode("t1", "hi", {});
    const inline = createInlineNode("i1", {}, [text]);
    const innerBlock = createBlockNode("inner", {}, []);
    const block = createBlockNode("outer", {}, [text, inline, innerBlock]);
    expect(block.children).toHaveLength(3);
  });
});

describe("createGridNode", () => {
  it("creates a grid render node with correct properties", () => {
    const child = createBlockNode("row1", {}, []);
    const grid = createGridNode("g1", {}, [child], [100, 200], [0, 50]);
    expect(grid.key).toBe("g1");
    expect(grid.type).toBe("grid");
    expect(grid.children).toHaveLength(1);
    expect(grid.children[0]).toBe(child);
    expect(grid.columnWidths).toEqual([100, 200]);
    expect(grid.rowHeights).toEqual([0, 50]);
  });

  it("freezes the node", () => {
    const grid = createGridNode("g1", {}, [], [100], [0]);
    expect(Object.isFrozen(grid)).toBe(true);
  });

  it("freezes styles, children, columnWidths, and rowHeights", () => {
    const grid = createGridNode("g1", {}, [], [100], [0]);
    expect(Object.isFrozen(grid.styles)).toBe(true);
    expect(Object.isFrozen(grid.children)).toBe(true);
    expect(Object.isFrozen(grid.columnWidths)).toBe(true);
    expect(Object.isFrozen(grid.rowHeights)).toBe(true);
  });

  it("copies arrays defensively", () => {
    const children = [createBlockNode("row1", {}, [])];
    const colWidths = [100, 200];
    const rowHeights = [0, 50];
    const grid = createGridNode("g1", {}, children, colWidths, rowHeights);
    children.push(createBlockNode("row2", {}, []));
    colWidths.push(300);
    rowHeights.push(60);
    expect(grid.children).toHaveLength(1);
    expect(grid.columnWidths).toHaveLength(2);
    expect(grid.rowHeights).toHaveLength(2);
  });
});

describe("createInlineNode", () => {
  it("creates an inline render node with text children", () => {
    const text = createTextRenderNode("t1", "hi", {});
    const inline = createInlineNode("i1", { fontWeight: "bold" }, [text]);
    expect(inline.key).toBe("i1");
    expect(inline.type).toBe("inline");
    expect(inline.styles.fontWeight).toBe("bold");
    expect(inline.children).toHaveLength(1);
  });

  it("freezes the node", () => {
    const inline = createInlineNode("i1", {}, []);
    expect(Object.isFrozen(inline)).toBe(true);
  });

  it("freezes styles and children", () => {
    const inline = createInlineNode("i1", {}, []);
    expect(Object.isFrozen(inline.styles)).toBe(true);
    expect(Object.isFrozen(inline.children)).toBe(true);
  });

  it("copies children defensively", () => {
    const text = createTextRenderNode("t1", "hi", {});
    const children = [text];
    const inline = createInlineNode("i1", {}, children);
    children.push(createTextRenderNode("t2", "bye", {}));
    expect(inline.children).toHaveLength(1);
  });

  it("throws if child is a block node", () => {
    const block = createBlockNode("b1", {}, []);
    expect(() => createInlineNode("i1", {}, [block])).toThrow(
      /cannot contain block child/,
    );
  });

  it("accepts inline children", () => {
    const inner = createInlineNode("inner", {}, []);
    const outer = createInlineNode("outer", {}, [inner]);
    expect(outer.children).toHaveLength(1);
  });
});
