/**
 * Integration: cross-paragraph workflows.
 *
 * Multi-paragraph documents are the norm, not the exception.
 * Tests editing one paragraph while others are reused, cross-paragraph
 * deletion (fusion), and cursor movement across paragraph boundaries.
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { createPosition, createSpan } from "../state/position";
import { insertText, deleteRange } from "../state/transformations";
import { renderTree, renderTreeIncremental } from "../render/render";
import { layoutTree, layoutTreeIncremental } from "../layout/layout-engine";
import { moveByCharacter } from "../cursor/cursor-ops";
import { registry, measurer, expectTextRender, lineText } from "./setup";

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
  it("editing paragraph 2 reuses paragraphs 1 and 3 in render and layout trees", () => {
    const { doc, rendered, layout } = setup();

    // Edit only paragraph 2
    const pos = createPosition([1, 0], 16); // end of "Second paragraph"
    const change = insertText(doc, pos, "!");
    const newRendered = renderTreeIncremental(
      change.newState,
      doc,
      rendered,
      registry,
    );
    const newLayout = layoutTreeIncremental(
      newRendered,
      rendered,
      layout,
      containerWidth,
      measurer,
    );

    // Render: paragraphs 1 and 3 reused (same reference), paragraph 2 is new
    expect(newRendered.children[0]).toBe(rendered.children[0]);
    expect(newRendered.children[2]).toBe(rendered.children[2]);
    expect(newRendered.children[1]).not.toBe(rendered.children[1]);
    expect(expectTextRender(newRendered.children[1].children[0]).text).toBe(
      "Second paragraph!",
    );

    // Layout: paragraph 1 reused (same reference — same key, same width, same y)
    expect(newLayout.children[0]).toBe(layout.children[0]);

    // Layout: paragraph 2 is new
    expect(newLayout.children[1]).not.toBe(layout.children[1]);

    // Layout: paragraph 3 is repositioned but structurally reused
    // (same key, same internal content, only y may differ)
    const oldP3 = layout.children[2];
    const newP3 = newLayout.children[2];
    expect(newP3.key).toBe(oldP3.key);
    expect(newP3.width).toBe(oldP3.width);
    expect(newP3.height).toBe(oldP3.height);

    // Y-coordinates: paragraphs stack vertically
    expect(newLayout.children[0].y).toBe(0);
    expect(newLayout.children[1].y).toBe(newLayout.children[0].height);
    expect(newLayout.children[2].y).toBe(
      newLayout.children[1].y + newLayout.children[1].height,
    );
  });

  it("deleting across all three paragraphs fuses into one", () => {
    const { doc } = setup();

    // Delete from offset 5 in p1 ("First") to offset 5 in p3 ("Third")
    // Keeps "First" + " paragraph" → "First paragraph"
    const range = createSpan(
      createPosition([0, 0], 5),
      createPosition([2, 0], 5),
    );
    const change = deleteRange(doc, range);
    const newState = change.newState;

    // Should fuse into one paragraph
    expect(newState.children).toHaveLength(1);
    expect(newState.children[0].children[0].properties.content).toBe(
      "First paragraph",
    );

    // Verify it renders and lays out correctly
    const rendered = renderTree(newState, registry);
    const layout = layoutTree(rendered, containerWidth, measurer);
    expect(layout.children).toHaveLength(1);
    expect(lineText(layout.children[0].children[0])).toBe("First paragraph");
  });

  it("deleting from paragraph 1 into middle of paragraph 2 fuses two paragraphs", () => {
    const { doc } = setup();

    // Delete from offset 5 in p1 to offset 6 in p2 → "First paragraph"
    // "First" (keep) + " paragraph" (from p2 offset 6 onward) = "First paragraph"
    const range = createSpan(
      createPosition([0, 0], 5),
      createPosition([1, 0], 6),
    );
    const change = deleteRange(doc, range);
    const newState = change.newState;

    // p1 and p2 fused, p3 remains
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

    // Position at end of paragraph 1's text node
    const endOfP1 = createPosition([0, 0], 15); // "First paragraph" length

    // Move forward — should cross into paragraph 2's text node
    const sel = moveByCharacter(doc, endOfP1, "forward");
    expect(sel.focus.path).toEqual([1, 0]);
    expect(sel.focus.offset).toBe(0);

    // Move forward again — should advance within paragraph 2
    const sel2 = moveByCharacter(doc, sel.focus, "forward");
    expect(sel2.focus.path).toEqual([1, 0]);
    expect(sel2.focus.offset).toBe(1);

    // Move backward from start of paragraph 2 — should cross back to paragraph 1
    const startOfP2 = createPosition([1, 0], 0);
    const sel3 = moveByCharacter(doc, startOfP2, "backward");
    expect(sel3.focus.path).toEqual([0, 0]);
    expect(sel3.focus.offset).toBe(15);
  });
});
