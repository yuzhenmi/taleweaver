/**
 * Integration: inserting a character causes word wrap.
 *
 * Container: 64px wide (8 characters worth of space).
 * Initial text: "hello wo" → "hello " (48px) + "wo" (16px) = 64px → fits on one line.
 * Insert "r" at offset 8 → "hello wor" → "hello " (48px) + "wor" (24px) = 72px → wraps!
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { createPosition } from "../state/position";
import { insertText } from "../state/transformations";
import { renderTree, renderTreeIncremental } from "../render/render";
import { layoutTree, layoutTreeIncremental } from "../layout/layout-engine";
import { moveByCharacter } from "../cursor/cursor-ops";
import { createCursor, isCollapsed } from "../cursor/selection";
import { registry, measurer, expectTextBox } from "./setup";

const containerWidth = 64;

function setup() {
  const text = createTextNode("t1", "hello wo");
  const para = createNode("p1", "paragraph", {}, [text]);
  const doc = createNode("doc", "document", {}, [para]);
  const rendered = renderTree(doc, registry);
  const layout = layoutTree(rendered, containerWidth, measurer);
  return { doc, rendered, layout };
}

describe("Integration: insert character causes word wrap", () => {
  it("before insertion: all text fits on a single line", () => {
    const { layout } = setup();

    const para = layout.children[0];
    expect(para.children).toHaveLength(1); // one line

    const line = para.children[0];
    expect(line.type).toBe("line");
    // "hello " and "wo" are two word boxes on the same line
    expect(line.children).toHaveLength(2);
    expect(expectTextBox(line.children[0]).text).toBe("hello ");
    expect(expectTextBox(line.children[1]).text).toBe("wo");
  });

  it("inserting a character wraps the word to a second line", () => {
    const { doc, rendered, layout } = setup();

    // Cursor is at the end of "hello wo" — offset 8
    const cursorPos = createPosition([0, 0], 8);

    // 1. Insert "r" at the cursor
    const change = insertText(doc, cursorPos, "r");
    const newState = change.newState;

    // Verify state updated
    expect(newState.children[0].children[0].properties.content).toBe(
      "hello wor",
    );

    // 2. Incrementally render
    const newRendered = renderTreeIncremental(
      newState,
      doc,
      rendered,
      registry,
    );

    // 3. Incrementally layout
    const newLayout = layoutTreeIncremental(
      newRendered,
      rendered,
      layout,
      containerWidth,
      measurer,
    );

    // 4. Verify layout: should now have two lines
    const para = newLayout.children[0];
    expect(para.children).toHaveLength(2);

    const line1 = para.children[0];
    const line2 = para.children[1];

    expect(line1.type).toBe("line");
    expect(line1.children).toHaveLength(1);
    expect(expectTextBox(line1.children[0]).text).toBe("hello ");

    expect(line2.type).toBe("line");
    expect(line2.children).toHaveLength(1);
    expect(expectTextBox(line2.children[0]).text).toBe("wor");

    // Lines are stacked vertically (relative to para)
    expect(line1.y).toBe(0);
    expect(line2.y).toBe(16);
  });

  it("cursor advances to after the inserted character", () => {
    const { doc } = setup();

    const cursorPos = createPosition([0, 0], 8);
    const change = insertText(doc, cursorPos, "r");

    // After inserting 1 character at offset 8, cursor should be at offset 9
    const newCursorPos = createPosition([0, 0], 9);
    const newCursor = createCursor([0, 0], 9);
    expect(isCollapsed(newCursor)).toBe(true);
    expect(newCursorPos.offset).toBe(9);

    // Moving backward from the new cursor should land at offset 8
    const moved = moveByCharacter(change.newState, newCursorPos, "backward");
    expect(moved.focus.offset).toBe(8);

    // And that position is the end of "hello wor" — moving forward hits end of node
    const atEnd = moveByCharacter(change.newState, newCursorPos, "forward");
    // No more content → stays at 9
    expect(atEnd.focus.path).toEqual([0, 0]);
    expect(atEnd.focus.offset).toBe(9);
  });
});
