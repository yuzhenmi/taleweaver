import { describe, it, expect } from "vitest";
import {
  createNode,
  createTextNode,
  createMockMeasurer,
  createRegistry,
  defaultComponents,
  renderTree,
  layoutTree,
  createCursor,
  createSelection,
  createPosition,
} from "@taleweaver/core";
import { computeSelectionRects } from "./selection-geometry";

const measurer = createMockMeasurer(8, 16);
const registry = createRegistry([...defaultComponents]);

function makeDoc(texts: string[]) {
  const paragraphs = texts.map((t, i) =>
    createNode(`p${i}`, "paragraph", {}, [createTextNode(`t${i}`, t)]),
  );
  return createNode("doc", "document", {}, paragraphs);
}

describe("computeSelectionRects", () => {
  it("returns empty for collapsed selection", () => {
    const state = makeDoc(["Hello"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);
    const sel = createCursor([0, 0], 2);

    const rects = computeSelectionRects(state, sel, layout, measurer, 400);
    expect(rects).toEqual([]);
  });

  it("returns one rect for single-line selection", () => {
    const state = makeDoc(["Hello world"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);
    // Select "llo w" (offset 2 to 7)
    const sel = createSelection(
      createPosition([0, 0], 2),
      createPosition([0, 0], 7),
    );

    const rects = computeSelectionRects(state, sel, layout, measurer, 400);
    expect(rects).toHaveLength(1);
    expect(rects[0].x).toBe(16); // 2 * 8
    expect(rects[0].width).toBe(40); // (7 - 2) * 8
    expect(rects[0].height).toBe(16);
  });

  it("returns multiple rects for multi-line selection", () => {
    const state = makeDoc(["First", "Second"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);
    // Select from "rst" to "Sec"
    const sel = createSelection(
      createPosition([0, 0], 2),
      createPosition([1, 0], 3),
    );

    const rects = computeSelectionRects(state, sel, layout, measurer, 400);
    expect(rects.length).toBeGreaterThanOrEqual(2);
    // First rect: from offset 2 to end of text content ("First" = 5 chars = 40px)
    expect(rects[0].x).toBe(16);
    expect(rects[0].width).toBe(40 - 16); // end of "First" minus start offset
    // Last rect: from start to offset 3
    const last = rects[rects.length - 1];
    expect(last.x).toBe(0);
    expect(last.width).toBe(24); // 3 * 8
  });
});
