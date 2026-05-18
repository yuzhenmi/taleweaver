/**
 * Integration: inserting a character causes word wrap.
 * TODO Plan 2 — incremental pipeline tests replaced with non-incremental.
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node-legacy";
import { createPosition } from "../state/position";
import { insertText } from "../state/transformations-legacy";
import { renderTree } from "../render/render-legacy";
import { layoutTree } from "../layout/layout-engine";
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

    if (layout.type !== "block") throw new Error("expected block");
    const para = layout.children[0];
    if (para.type !== "block") throw new Error("expected block");
    expect(para.children).toHaveLength(1);

    const line = para.children[0];
    expect(line.type).toBe("line");
    if (line.type !== "line") throw new Error("expected line");
    expect(line.children).toHaveLength(2);
    expect(expectTextBox(line.children[0]).text).toBe("hello ");
    expect(expectTextBox(line.children[1]).text).toBe("wo");
  });

  it("inserting a character wraps the word to a second line", () => {
    const { doc } = setup();

    const change = insertText(doc, createPosition([0, 0], 8), "r");
    const newState = change.newState;

    expect(newState.children[0].children[0].properties.content).toBe("hello wor");

    const newRendered = renderTree(newState, registry);
    const newLayout = layoutTree(newRendered, containerWidth, measurer);

    if (newLayout.type !== "block") throw new Error("expected block");
    const para = newLayout.children[0];
    if (para.type !== "block") throw new Error("expected block");
    expect(para.children).toHaveLength(2);

    const line1 = para.children[0];
    const line2 = para.children[1];

    expect(line1.type).toBe("line");
    if (line1.type !== "line") throw new Error("expected line");
    expect(line1.children).toHaveLength(1);
    expect(expectTextBox(line1.children[0]).text).toBe("hello ");

    expect(line2.type).toBe("line");
    if (line2.type !== "line") throw new Error("expected line");
    expect(line2.children).toHaveLength(1);
    expect(expectTextBox(line2.children[0]).text).toBe("wor");

    expect(line1.y).toBe(0);
    expect(line2.y).toBe(16); // line height = 16, no margins in Plan 1
  });

  it("cursor advances to after the inserted character", () => {
    const { doc } = setup();

    const cursorPos = createPosition([0, 0], 8);
    const change = insertText(doc, cursorPos, "r");

    const newCursorPos = createPosition([0, 0], 9);
    const newCursor = createCursor([0, 0], 9);
    expect(isCollapsed(newCursor)).toBe(true);
    expect(newCursorPos.offset).toBe(9);

    const moved = moveByCharacter(change.newState, newCursorPos, "backward");
    expect(moved.focus.offset).toBe(8);

    const atEnd = moveByCharacter(change.newState, newCursorPos, "forward");
    expect(atEnd.focus.path).toEqual([0, 0]);
    expect(atEnd.focus.offset).toBe(9);
  });
});
