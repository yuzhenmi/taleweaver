/**
 * Integration: split node (line break) with undo/redo.
 *
 * Start with one paragraph "Hello World".
 * Split at offset 5 → two paragraphs: "Hello" and " World".
 * Undo → back to one paragraph.
 * Redo → two paragraphs again.
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { createPosition } from "../state/position";
import { splitNode } from "../state/transformations";
import { renderTree } from "../render/render";
import { layoutTree } from "../layout/layout-engine";
import { createHistory, pushChange, undo, redo } from "../state/history";
import { registry, measurer, expectTextBox } from "./setup";

function setup() {
  const text = createTextNode("t1", "Hello World");
  const para = createNode("p1", "paragraph", {}, [text]);
  const doc = createNode("doc", "document", {}, [para]);
  const rendered = renderTree(doc, registry);
  const layout = layoutTree(rendered, 200, measurer);
  return { doc, rendered, layout };
}

describe("Integration: split node (line break) and undo/redo", () => {
  it("split produces two paragraphs with correct layout", () => {
    const { doc } = setup();

    const pos = createPosition([0, 0], 5);
    const change = splitNode(doc, pos, "p2");
    const newState = change.newState;

    expect(newState.children).toHaveLength(2);
    expect(newState.children[0].children[0].properties.content).toBe("Hello");
    expect(newState.children[1].children[0].properties.content).toBe(" World");

    // Full render and layout of split state
    const rendered = renderTree(newState, registry);
    const layout = layoutTree(rendered, 200, measurer);

    // Two paragraphs stacked vertically
    expect(layout.children).toHaveLength(2);

    const para1 = layout.children[0];
    const para2 = layout.children[1];

    // First paragraph: "Hello"
    expect(expectTextBox(para1.children[0].children[0]).text).toBe("Hello");
    expect(para1.y).toBe(0);
    expect(para1.height).toBe(16);

    // Second paragraph: " World" splits into leading space + "World"
    expect(para2.children[0].children).toHaveLength(2);
    expect(expectTextBox(para2.children[0].children[0]).text).toBe(" ");
    expect(expectTextBox(para2.children[0].children[1]).text).toBe("World");
    expect(para2.y).toBe(16);
  });

  it("undo reverts the split, redo reapplies it", () => {
    const { doc } = setup();

    const pos = createPosition([0, 0], 5);
    const change = splitNode(doc, pos, "p2");

    // Push change to history
    let history = createHistory();
    history = pushChange(history, change);
    expect(history.undoStack).toHaveLength(1);

    // Undo: back to original
    const undoResult = undo(history)!;
    expect(undoResult.state).toBe(doc);
    expect(undoResult.state.children).toHaveLength(1);
    expect(
      undoResult.state.children[0].children[0].properties.content,
    ).toBe("Hello World");

    // Verify layout after undo
    const undoRendered = renderTree(undoResult.state, registry);
    const undoLayout = layoutTree(undoRendered, 200, measurer);
    expect(undoLayout.children).toHaveLength(1);

    // Redo: back to split
    const redoResult = redo(undoResult.history)!;
    expect(redoResult.state.children).toHaveLength(2);
    expect(
      redoResult.state.children[0].children[0].properties.content,
    ).toBe("Hello");
    expect(
      redoResult.state.children[1].children[0].properties.content,
    ).toBe(" World");
  });
});
