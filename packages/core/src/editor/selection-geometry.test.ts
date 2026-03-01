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
    expect(rects[0].pageIndex).toBe(0);
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
    // First rect: from offset 2 to end of "First" + line-break indicator (2 spaces)
    // "First" = 5*8=40, indicator = 2*8=16, so right edge = 56
    expect(rects[0].x).toBe(16);
    expect(rects[0].width).toBe(56 - 16); // text end + indicator - start offset
    // Last rect: from start to offset 3 (mid-line, no EOL indicator)
    const last = rects[rects.length - 1];
    expect(last.x).toBe(0);
    expect(last.width).toBe(24); // 3 * 8
  });

  it("multi-line selection rects respect page margins (lines start at marginLeft, not 0)", () => {
    const margins = { top: 96, bottom: 96, left: 72, right: 72 };
    const state = makeDoc(["First", "Second", "Third"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 816, measurer, 1056, margins);

    // Select from middle of "First" to middle of "Third"
    const sel = createSelection(
      createPosition([0, 0], 2),
      createPosition([2, 0], 3),
    );

    const rects = computeSelectionRects(state, sel, layout, measurer, 816);

    // Should have 3 rects: first line, middle line ("Second"), last line
    expect(rects).toHaveLength(3);

    // First rect: starts at cursor, extends to text end + indicator (2 spaces)
    // "First" = 5*8=40px at x=72, so end=112, +indicator(16)=128. start=72+16=88
    expect(rects[0].x).toBe(72 + 16);
    expect(rects[0].width).toBe(128 - 88);

    // Middle rect ("Second" line): marginLeft to text end + indicator (2 spaces)
    // "Second" = 6*8=48 at x=72, end=120, +indicator(16)=136
    expect(rects[1].x).toBe(72);
    expect(rects[1].width).toBe(136 - 72);

    // Last rect ("Third" line): no line break indicator
    expect(rects[2].x).toBe(72);
    expect(rects[2].width).toBe(24); // 3 * 8
  });

  it("shows line break indicator on empty lines in selection", () => {
    const state = makeDoc(["Hello", "", "World"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    // Select all: from start of "Hello" to virtual EOL of "World"
    const sel = createSelection(
      createPosition([0, 0], 0),
      createPosition([2, 0], 6), // textLength(5) + 1
    );

    const rects = computeSelectionRects(state, sel, layout, measurer, 400);

    // Should have 3 rects: "Hello" line, empty line, "World" line
    expect(rects).toHaveLength(3);

    // First line ("Hello"): text + line-break indicator (2 spaces)
    expect(rects[0].x).toBe(0);
    expect(rects[0].width).toBe(40 + 16); // "Hello"(40) + indicator(16)

    // Empty line: should still show indicator highlight (2 spaces)
    expect(rects[1].width).toBe(16); // two space widths with default styles

    // Last line ("World"): virtual EOL → EOL indicator shown
    expect(rects[2].x).toBe(0);
    expect(rects[2].width).toBe(40 + 16); // "World"(40) + indicator(16)
  });

  it("shows EOL indicator on last line when selection reaches end of text (virtual EOL)", () => {
    const state = makeDoc(["Hello", "World"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    // Select from middle of "Hello" to virtual EOL of "World" (textLength+1)
    const sel = createSelection(
      createPosition([0, 0], 2),
      createPosition([1, 0], 6), // textLength(5) + 1
    );

    const rects = computeSelectionRects(state, sel, layout, measurer, 400);
    expect(rects).toHaveLength(2);

    // Last line: virtual EOL offset → include EOL indicator
    expect(rects[1].x).toBe(0);
    expect(rects[1].width).toBe(40 + 16); // "World"(40) + indicator(16)
  });

  it("no EOL indicator on last line when selection ends at textLength (not virtual EOL)", () => {
    const state = makeDoc(["Hello", "World"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    // Select from middle of "Hello" to end of "World" at textLength (not +1)
    const sel = createSelection(
      createPosition([0, 0], 2),
      createPosition([1, 0], 5), // textLength, NOT virtual EOL
    );

    const rects = computeSelectionRects(state, sel, layout, measurer, 400);
    expect(rects).toHaveLength(2);

    // Last line: at textLength but NOT virtual EOL → no indicator
    expect(rects[1].x).toBe(0);
    expect(rects[1].width).toBe(40); // just "World"(40), no indicator
  });

  it("no EOL indicator on last line when selection ends mid-line", () => {
    const state = makeDoc(["Hello", "World"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    // Select from middle of "Hello" to middle of "World"
    const sel = createSelection(
      createPosition([0, 0], 2),
      createPosition([1, 0], 3),
    );

    const rects = computeSelectionRects(state, sel, layout, measurer, 400);
    expect(rects).toHaveLength(2);

    // Last line: selection ends mid-line → no EOL indicator
    expect(rects[1].x).toBe(0);
    expect(rects[1].width).toBe(24); // 3 * 8, no indicator
  });

  it("shows EOL indicator on empty first line in multi-line selection", () => {
    const state = makeDoc(["", "Hello"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    // Select from empty first paragraph to middle of "Hello" (no virtual EOL on last line)
    const sel = createSelection(
      createPosition([0, 0], 0),
      createPosition([1, 0], 3),
    );

    const rects = computeSelectionRects(state, sel, layout, measurer, 400);
    expect(rects).toHaveLength(2);
    // Empty first line: always shows EOL indicator (middle/first lines always include paragraph break)
    expect(rects[0].width).toBe(16); // 2-space indicator
    // Second line: 3 chars, no virtual EOL → no indicator
    expect(rects[1].width).toBe(24);
  });

  it("shows EOL indicator when selecting across empty paragraphs", () => {
    const state = makeDoc(["", ""]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    // Select from first empty paragraph to virtual EOL of second empty paragraph
    const sel = createSelection(
      createPosition([0, 0], 0),
      createPosition([1, 0], 1), // virtual EOL for empty text (textLength 0 + 1)
    );

    const rects = computeSelectionRects(state, sel, layout, measurer, 400);
    expect(rects).toHaveLength(2);
    expect(rects[0].width).toBe(16); // EOL indicator on first empty line
    expect(rects[1].width).toBe(16); // EOL indicator on second empty line
  });

  it("returns empty for collapsed selection in empty paragraph (no virtual EOL offset)", () => {
    const state = makeDoc([""]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    // Collapsed cursor at offset 0 — not a virtual EOL, so no highlight
    const sel = createCursor([0, 0], 0);
    const rects = computeSelectionRects(state, sel, layout, measurer, 400);
    expect(rects).toEqual([]);
  });

  it("returns EOL indicator for selection in empty paragraph with virtual EOL", () => {
    const state = makeDoc([""]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    // Non-collapsed selection with virtual EOL (as produced by select-all)
    const sel = createSelection(
      createPosition([0, 0], 0),
      createPosition([0, 0], 1), // virtual EOL for empty text
    );
    const rects = computeSelectionRects(state, sel, layout, measurer, 400);
    expect(rects).toHaveLength(1);
    expect(rects[0].width).toBe(16); // 2-space EOL indicator
  });

  it("returns empty for collapsed selection mid-line", () => {
    const state = makeDoc(["Hello"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    const sel = createCursor([0, 0], 2);

    const rects = computeSelectionRects(state, sel, layout, measurer, 400);
    // Mid-line collapsed selection produces zero-width rect, filtered out
    expect(rects).toEqual([]);
  });

  it("shows EOL indicator on single-line selection with virtual EOL", () => {
    const state = makeDoc(["Hello"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    // Select all of "Hello" with virtual EOL
    const sel = createSelection(
      createPosition([0, 0], 0),
      createPosition([0, 0], 6), // textLength(5) + 1
    );

    const rects = computeSelectionRects(state, sel, layout, measurer, 400);
    expect(rects).toHaveLength(1);
    expect(rects[0].x).toBe(0);
    expect(rects[0].width).toBe(40 + 16); // "Hello"(40) + indicator(16)
  });

  it("no EOL indicator on single-line selection at textLength (not virtual EOL)", () => {
    const state = makeDoc(["Hello"]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 400, measurer);

    // Select all of "Hello" but only to textLength, not virtual EOL
    const sel = createSelection(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5), // textLength, NOT virtual EOL
    );

    const rects = computeSelectionRects(state, sel, layout, measurer, 400);
    expect(rects).toHaveLength(1);
    expect(rects[0].x).toBe(0);
    expect(rects[0].width).toBe(40); // just "Hello"(40), no indicator
  });
});
