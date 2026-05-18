import { describe, it, expect } from "vitest";
import {
  createEmptyDocument,
  createNode,
  createTextNode,
  createPosition,
  createMockShaper,
  createRegistry,
  defaultComponents,
  renderTree,
  layoutTree,
  insertText,
  splitNode,
} from "@taleweaver/core";
import { resolvePixelPosition } from "./cursor-position-legacy";

const measurer = createMockShaper(8, 16);
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
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.height).toBe(16);
    expect(result.pageIndex).toBe(0);
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
    // Second paragraph y depends on BFC margin collapse of first paragraph's marginBottom
    expect(result.y).toBeGreaterThan(0); // must be below the first line
  });

  it("caret returns line height", () => {
    const tallMeasurer = createMockShaper(8, 24);
    let state = createEmptyDocument();
    state = insertText(state, createPosition([0, 0], 0), "hello").newState;
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 200, tallMeasurer);
    const pos = createPosition([0, 0], 3); // after "hel"

    const result = resolvePixelPosition(state, pos, layout, tallMeasurer);
    expect(result.x).toBe(24); // 3 * 8
    expect(result.y).toBe(0); // top of line box
    expect(result.height).toBe(24); // line height
    expect(result.lineY).toBe(0);
    expect(result.lineHeight).toBe(24);
  });

  it("cursor at end of text stays on its line", () => {
    const tallMeasurer = createMockShaper(8, 24);
    let state = createEmptyDocument();
    state = insertText(state, createPosition([0, 0], 0), "hi").newState;
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 200, tallMeasurer);
    const pos = createPosition([0, 0], 2);

    const result = resolvePixelPosition(state, pos, layout, tallMeasurer);
    expect(result.x).toBe(16); // 2 * 8
    expect(result.y).toBe(0);
    expect(result.height).toBe(24);
    expect(result.lineY).toBe(0);
    expect(result.lineHeight).toBe(24);
  });

  it("cursor in second paragraph is below first paragraph", () => {
    const tallMeasurer = createMockShaper(8, 24);
    let state = createEmptyDocument();
    state = insertText(state, createPosition([0, 0], 0), "abc").newState;
    state = splitNode(state, createPosition([0, 0], 3), "node-1").newState;
    state = insertText(state, createPosition([1, 0], 0), "de").newState;
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 200, tallMeasurer);

    const pos = createPosition([1, 0], 1);
    const result = resolvePixelPosition(state, pos, layout, tallMeasurer);
    expect(result.x).toBe(8); // 1 * 8
    expect(result.y).toBeGreaterThan(24); // must be below first para's line
    expect(result.height).toBe(24);
    expect(result.lineHeight).toBe(24);
  });

  it("handles word-wrapped text across multiple layout boxes", () => {
    let state = createEmptyDocument();
    state = insertText(
      state,
      createPosition([0, 0], 0),
      "hello world test wrap",
    ).newState;
    const layout = buildLayout(state);

    // Position at offset 12 (in "test" on possibly second line)
    const pos = createPosition([0, 0], 12);
    const result = resolvePixelPosition(state, pos, layout, measurer);
    // Just verify it returns valid values.
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.height).toBe(16);
  });

  it("soft-wrap boundary renders at start of next line (word-level wrap)", () => {
    // "hello world" in 80px container wraps: "hello " (48px) + "world" (40px)
    const text = createTextNode("t0", "hello world");
    const para = createNode("p0", "paragraph", {}, [text]);
    const state = createNode("doc", "document", {}, [para]);
    const render = renderTree(state, registry);
    const layout = layoutTree(render, 80, measurer);

    // Offset 6 = boundary between "hello " and "world" → start of line 2
    const pos6 = resolvePixelPosition(state, createPosition([0, 0], 6), layout, measurer);
    expect(pos6.x).toBe(0);
    expect(pos6.y).toBe(16); // line 2 y

    // Offset 5 = within "hello " → still on line 1
    const pos5 = resolvePixelPosition(state, createPosition([0, 0], 5), layout, measurer);
    expect(pos5.x).toBe(40); // 5 * 8px
    expect(pos5.y).toBe(0); // line 1
  });

  it("end of last text box in paragraph stays on its line (no next line to jump to)", () => {
    // Single paragraph "hello" (not wrapped) — offset at textLength stays at end
    let state = createEmptyDocument();
    state = insertText(state, createPosition([0, 0], 0), "hello").newState;
    const layout = buildLayout(state);

    const pos = resolvePixelPosition(state, createPosition([0, 0], 5), layout, measurer);
    expect(pos.x).toBe(40); // end of "hello"
    expect(pos.y).toBe(0);
  });
});
