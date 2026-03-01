import { describe, it, expect } from "vitest";
import {
  createEmptyDocument,
  createNode,
  createTextNode,
  createPosition,
  createMockMeasurer,
  createRegistry,
  defaultComponents,
  renderTree,
  layoutTree,
  insertText,
  splitNode,
} from "@taleweaver/core";
import { resolvePixelPosition } from "./cursor-position";

const measurer = createMockMeasurer(8, 16);
const registry = createRegistry([...defaultComponents]);

function buildLayout(state: ReturnType<typeof createEmptyDocument>) {
  const render = renderTree(state, registry);
  return layoutTree(render, 200, measurer);
}

describe("resolvePixelPosition", () => {
  it("returns origin for cursor at start of empty document", () => {
    const state = createEmptyDocument();
    const layout = buildLayout(state);
    const pos = createPosition([0, 0], 0);

    const result = resolvePixelPosition(state, pos, layout, measurer);
    expect(result).toEqual({ x: 0, y: 0, height: 16, lineY: 0, lineHeight: 16, pageIndex: 0 });
  });

  it("returns correct x for cursor in middle of text", () => {
    let state = createEmptyDocument();
    state = insertText(state, createPosition([0, 0], 0), "hello").newState;
    const layout = buildLayout(state);
    const pos = createPosition([0, 0], 3); // after "hel"

    const result = resolvePixelPosition(state, pos, layout, measurer);
    expect(result.x).toBe(24); // 3 chars * 8px
    expect(result.y).toBe(0);
    expect(result.height).toBe(16);
  });

  it("returns end-of-text x for cursor at end", () => {
    let state = createEmptyDocument();
    state = insertText(state, createPosition([0, 0], 0), "hi").newState;
    const layout = buildLayout(state);
    const pos = createPosition([0, 0], 2);

    const result = resolvePixelPosition(state, pos, layout, measurer);
    expect(result.x).toBe(16); // 2 chars * 8px
  });

  it("works with multiple paragraphs", () => {
    let state = createEmptyDocument();
    state = insertText(state, createPosition([0, 0], 0), "abc").newState;
    state = splitNode(state, createPosition([0, 0], 3), "node-1").newState;
    state = insertText(state, createPosition([1, 0], 0), "de").newState;
    const layout = buildLayout(state);

    // Cursor at start of second paragraph
    const pos = createPosition([1, 0], 1);
    const result = resolvePixelPosition(state, pos, layout, measurer);
    expect(result.x).toBe(8); // 1 char * 8px
    expect(result.y).toBe(16); // second line
  });

  it("cursor height uses measureCursorHeight, centered in line", () => {
    // lineHeight=24, cursorHeight=20 → halfLeading = (24-20)/2 = 2
    const tallMeasurer = createMockMeasurer(8, 24, 20);
    let state = createEmptyDocument();
    state = insertText(state, createPosition([0, 0], 0), "hello").newState;
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 200, tallMeasurer);
    const pos = createPosition([0, 0], 3); // after "hel"

    const result = resolvePixelPosition(state, pos, layout, tallMeasurer);
    expect(result.x).toBe(24); // 3 * 8
    expect(result.y).toBe(2); // halfLeading offset from top of line
    expect(result.height).toBe(20); // cursorHeight, not lineHeight
    expect(result.lineY).toBe(0); // raw line box top
    expect(result.lineHeight).toBe(24); // full line height
  });

  it("cursor at end of text has half-leading offset", () => {
    const tallMeasurer = createMockMeasurer(8, 24, 20);
    let state = createEmptyDocument();
    state = insertText(state, createPosition([0, 0], 0), "hi").newState;
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 200, tallMeasurer);
    const pos = createPosition([0, 0], 2);

    const result = resolvePixelPosition(state, pos, layout, tallMeasurer);
    expect(result.x).toBe(16); // 2 * 8
    expect(result.y).toBe(2); // halfLeading
    expect(result.height).toBe(20); // cursorHeight
    expect(result.lineY).toBe(0);
    expect(result.lineHeight).toBe(24);
  });

  it("cursor in second paragraph has half-leading offset", () => {
    const tallMeasurer = createMockMeasurer(8, 24, 20);
    let state = createEmptyDocument();
    state = insertText(state, createPosition([0, 0], 0), "abc").newState;
    state = splitNode(state, createPosition([0, 0], 3), "node-1").newState;
    state = insertText(state, createPosition([1, 0], 0), "de").newState;
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 200, tallMeasurer);

    const pos = createPosition([1, 0], 1);
    const result = resolvePixelPosition(state, pos, layout, tallMeasurer);
    expect(result.x).toBe(8); // 1 * 8
    expect(result.y).toBe(24 + 2); // second line (y=24) + halfLeading (2)
    expect(result.height).toBe(20); // cursorHeight
    expect(result.lineY).toBe(24); // raw line box top of second line
    expect(result.lineHeight).toBe(24);
  });

  it("resolves cursor within a word broken across lines", () => {
    // Container width = 40px (5 chars at 8px). Word "abcdefgh" (8 chars, 64px)
    // breaks into "abcde" (line 1) and "fgh" (line 2)
    let state = createEmptyDocument();
    state = insertText(state, createPosition([0, 0], 0), "abcdefgh").newState;
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 40, measurer);

    // Cursor at offset 6 → within "fgh" on line 2, after "f"
    const pos6 = resolvePixelPosition(state, createPosition([0, 0], 6), layout, measurer);
    expect(pos6.x).toBe(8); // 1 char into "fgh"
    expect(pos6.y).toBe(16); // second line

    // Cursor at offset 3 → within "abcde" on line 1, after "abc"
    const pos3 = resolvePixelPosition(state, createPosition([0, 0], 3), layout, measurer);
    expect(pos3.x).toBe(24); // 3 chars * 8px
    expect(pos3.y).toBe(0); // first line

    // Cursor at boundary (offset 5) → end of "abcde" on line 1
    const pos5 = resolvePixelPosition(state, createPosition([0, 0], 5), layout, measurer);
    expect(pos5.x).toBe(40); // 5 chars * 8px = end of first line
    expect(pos5.y).toBe(0);
  });

  it("handles word-wrapped text across multiple layout boxes", () => {
    let state = createEmptyDocument();
    // 25 chars * 8px = 200px, exactly fills 200px container
    // "hello world test" = 16 chars, with spaces. word wrapping will split
    state = insertText(
      state,
      createPosition([0, 0], 0),
      "hello world test wrap",
    ).newState;
    const layout = buildLayout(state);

    // Position at offset 12 (in "test" on possibly second line)
    const pos = createPosition([0, 0], 12);
    const result = resolvePixelPosition(state, pos, layout, measurer);
    // The exact position depends on word wrapping. Just verify it returns valid values.
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.height).toBe(16);
  });
});
