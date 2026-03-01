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

    // Second paragraph starts at y=16
    const pos = resolvePositionFromPixel(state, layout, measurer, 0, 16);
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
});
