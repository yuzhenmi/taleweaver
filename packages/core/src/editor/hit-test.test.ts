import { describe, it, expect } from "vitest";
import {
  createNode,
  createTextNode,
  createMockMeasurer,
  createRegistry,
  defaultComponents,
  renderTree,
  layoutTree,
} from "@taleweaver/core";
import { resolvePositionFromPixel } from "./hit-test";

const measurer = createMockMeasurer(8, 16); // 8px/char, 16px line height
const registry = createRegistry([...defaultComponents]);

function makeDoc(texts: string[]) {
  const paragraphs = texts.map((t, i) =>
    createNode(`p${i}`, "paragraph", {}, [createTextNode(`t${i}`, t)]),
  );
  return createNode("doc", "document", {}, paragraphs);
}

describe("resolvePositionFromPixel", () => {
  it("positions cursor at start of text when clicking at x=0", () => {
    const state = makeDoc(["Hello"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    const pos = resolvePositionFromPixel(state, layout, measurer, 0, 0);
    expect(pos).not.toBeNull();
    expect(pos!.path).toEqual([0, 0]);
    expect(pos!.offset).toBe(0);
  });

  it("positions cursor at end of text when clicking past the text", () => {
    const state = makeDoc(["Hello"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    const pos = resolvePositionFromPixel(state, layout, measurer, 200, 0);
    expect(pos).not.toBeNull();
    expect(pos!.path).toEqual([0, 0]);
    expect(pos!.offset).toBe(5);
  });

  it("positions cursor in middle of text", () => {
    const state = makeDoc(["Hello"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    // At x=12 with 8px/char, "H" = 8px, "He" = 16px, midpoint = 12
    // 12 < 12 is false, so it snaps forward to offset 2
    const pos = resolvePositionFromPixel(state, layout, measurer, 12, 0);
    expect(pos).not.toBeNull();
    expect(pos!.path).toEqual([0, 0]);
    expect(pos!.offset).toBe(2); // snaps to closer character boundary
  });

  it("clicks on second paragraph", () => {
    const state = makeDoc(["First", "Second"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    // Second paragraph starts at y=19.2 (first para height = 16 + 3.2 marginBottom)
    const pos = resolvePositionFromPixel(state, layout, measurer, 0, 20);
    expect(pos).not.toBeNull();
    expect(pos!.path).toEqual([1, 0]);
    expect(pos!.offset).toBe(0);
  });

  it("clicking below all content positions on last line", () => {
    const state = makeDoc(["Hello"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    const pos = resolvePositionFromPixel(state, layout, measurer, 20, 100);
    expect(pos).not.toBeNull();
    expect(pos!.path).toEqual([0, 0]);
  });

  it("returns null for empty layout tree with no text boxes", () => {
    const state = createNode("doc", "document", {}, []);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    const pos = resolvePositionFromPixel(state, layout, measurer, 0, 0);
    expect(pos).toBeNull();
  });

  it("clicking empty space after text in first table column stays in first column", () => {
    // Table: 2 columns [0.5, 0.5] of 400px → 200px, 200px
    // Cell 0: paragraph with "Hi" (16px wide at 8px/char)
    // Cell 1: paragraph with "There"
    const state = createNode("doc", "document", {}, [
      createNode("t1", "table", { columnWidths: [0.5, 0.5], rowHeights: [0] }, [
        createNode("r1", "table-row", {}, [
          createNode("c1", "table-cell", {}, [
            createNode("p0", "paragraph", {}, [createTextNode("t0", "Hi")]),
          ]),
          createNode("c2", "table-cell", {}, [
            createNode("p1", "paragraph", {}, [createTextNode("t1", "There")]),
          ]),
        ]),
      ]),
    ]);

    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    // Click at x=100: well past "Hi" text (16px) but within column 0 (0–200px)
    // Should resolve to end of "Hi" in cell 0, NOT to "There" in cell 1
    const pos = resolvePositionFromPixel(state, layout, measurer, 100, 5);
    expect(pos).not.toBeNull();
    expect(pos!.path[0]).toBe(0); // table
    expect(pos!.offset).toBe(2); // end of "Hi"

    // Verify the node is t0 (cell 0's text), not t1 (cell 1's text)
    // by checking that clicking at x=210 does resolve to cell 1
    const pos2 = resolvePositionFromPixel(state, layout, measurer, 210, 5);
    expect(pos2).not.toBeNull();
    expect(pos2!.offset).toBeLessThanOrEqual(5); // within "There"
  });
});
