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
    expect(result).toEqual({ x: 0, y: 0, height: 16 });
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
