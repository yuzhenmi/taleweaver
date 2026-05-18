/**
 * Integration: cross-paragraph workflows.
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node-legacy";
import { createPosition, createSpan } from "../state/position";
import { deleteRange } from "../state/transformations-legacy";
import { renderTree } from "../render/render";
import { layoutTree } from "../layout/layout-engine";
import { moveByCharacter } from "../cursor/cursor-ops";
import { registry, measurer, lineText } from "./setup";

const containerWidth = 200;

function setup() {
  const t1 = createTextNode("t1", "First paragraph");
  const t2 = createTextNode("t2", "Second paragraph");
  const t3 = createTextNode("t3", "Third paragraph");
  const p1 = createNode("p1", "paragraph", {}, [t1]);
  const p2 = createNode("p2", "paragraph", {}, [t2]);
  const p3 = createNode("p3", "paragraph", {}, [t3]);
  const doc = createNode("doc", "document", {}, [p1, p2, p3]);
  const rendered = renderTree(doc, registry);
  const layout = layoutTree(rendered, containerWidth, measurer);
  return { doc, rendered, layout };
}

describe("Integration: multi-paragraph editing", () => {
  it("document renders and lays out three paragraphs", () => {
    const { layout } = setup();
    // Should have 3 block children (one per paragraph)
    if (layout.type !== "block") throw new Error("expected block");
    expect(layout.children).toHaveLength(3);
    // All children are blocks
    for (const child of layout.children) {
      expect(child.type).toBe("block");
    }
  });

  it("paragraphs stack vertically", () => {
    const { layout } = setup();
    if (layout.type !== "block") throw new Error("expected block");
    const [p1, p2, p3] = layout.children;
    expect(p1.y).toBe(0);
    // Each paragraph is below the previous
    expect(p2.y).toBeGreaterThan(p1.y);
    expect(p3.y).toBeGreaterThan(p2.y);
  });

  it("line text matches input text", () => {
    const { layout } = setup();
    if (layout.type !== "block") throw new Error("expected block");
    const [p1Layout, p2Layout] = layout.children;
    if (p1Layout.type !== "block") throw new Error("expected block");
    if (p2Layout.type !== "block") throw new Error("expected block");
    // Each paragraph has at least one line
    expect(p1Layout.children.length).toBeGreaterThan(0);
    const firstLine = p1Layout.children[0];
    expect(lineText(firstLine)).toBe("First paragraph");
  });

  it("deleting across all three paragraphs fuses into one", () => {
    const { doc } = setup();

    const range = createSpan(
      createPosition([0, 0], 5),
      createPosition([2, 0], 5),
    );
    const change = deleteRange(doc, range);
    const newState = change.newState;

    expect(newState.children).toHaveLength(1);
    expect(newState.children[0].children[0].properties.content).toBe(
      "First paragraph",
    );

    const rendered = renderTree(newState, registry);
    const layout = layoutTree(rendered, containerWidth, measurer);
    if (layout.type !== "block") throw new Error("expected block");
    expect(layout.children).toHaveLength(1);
    if (layout.children[0].type !== "block") throw new Error("expected block");
    expect(lineText(layout.children[0].children[0])).toBe("First paragraph");
  });

  it("deleting from paragraph 1 into middle of paragraph 2 fuses two paragraphs", () => {
    const { doc } = setup();

    const range = createSpan(
      createPosition([0, 0], 5),
      createPosition([1, 0], 6),
    );
    const change = deleteRange(doc, range);
    const newState = change.newState;

    expect(newState.children).toHaveLength(2);
    expect(newState.children[0].children[0].properties.content).toBe(
      "First paragraph",
    );
    expect(newState.children[1].children[0].properties.content).toBe(
      "Third paragraph",
    );
  });

  it("cursor crosses paragraph boundary", () => {
    const { doc } = setup();

    const endOfP1 = createPosition([0, 0], 15);
    const sel = moveByCharacter(doc, endOfP1, "forward");
    expect(sel.focus.path).toEqual([1, 0]);
    expect(sel.focus.offset).toBe(0);

    const sel2 = moveByCharacter(doc, sel.focus, "forward");
    expect(sel2.focus.path).toEqual([1, 0]);
    expect(sel2.focus.offset).toBe(1);

    const startOfP2 = createPosition([1, 0], 0);
    const sel3 = moveByCharacter(doc, startOfP2, "backward");
    expect(sel3.focus.path).toEqual([0, 0]);
    expect(sel3.focus.offset).toBe(15);
  });
});
