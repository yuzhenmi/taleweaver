/**
 * Integration: realistic typing session.
 * TODO Plan 2 — incremental pipeline tests removed; non-incremental pipeline tests kept.
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node-legacy";
import { createPosition } from "../state/position";
import { insertText } from "../state/transformations-legacy";
import { renderTree } from "../render/render";
import { layoutTree } from "../layout/layout-engine";
import { createHistory, pushChange, undo, redo } from "../state/history-legacy";
import type { Change } from "../state/change-legacy";
import type { StateNode } from "../state/state-node-legacy";
import type { History } from "../state/history-legacy";
import { registry, measurer, expectTextBox, lineText } from "./setup";

function setup(containerWidth: number) {
  const text = createTextNode("t1", "");
  const para = createNode("p1", "paragraph", {}, [text]);
  const doc = createNode("doc", "document", {}, [para]);
  const rendered = renderTree(doc, registry);
  const layout = layoutTree(rendered, containerWidth, measurer);
  return { doc, rendered, layout };
}

/**
 * Type a string character-by-character, running the full pipeline after each keystroke.
 */
function typeChars(chars: string, initial: ReturnType<typeof setup>, containerWidth: number) {
  let state = initial.doc;

  for (let i = 0; i < chars.length; i++) {
    const pos = createPosition([0, 0], i);
    const change = insertText(state, pos, chars[i]);
    state = change.newState;
  }

  const rendered = renderTree(state, registry);
  const layout = layoutTree(rendered, containerWidth, measurer);
  return { state, rendered, layout };
}

/**
 * Type a string with history tracking.
 */
function typeCharsWithHistory(
  chars: string,
  initialDoc: StateNode,
  timestampStep: number,
): { state: StateNode; history: History } {
  let state = initialDoc;
  let history = createHistory();
  const baseTime = 1000;

  for (let i = 0; i < chars.length; i++) {
    const pos = createPosition([0, 0], i);
    const change = insertText(state, pos, chars[i]);
    const timedChange: Change = Object.freeze({
      oldState: change.oldState,
      newState: change.newState,
      timestamp: baseTime + i * timestampStep,
    });
    history = pushChange(history, timedChange);
    state = change.newState;
  }

  return { state, history };
}

describe("Integration: realistic typing session", () => {
  it("types 'Hi there' with correct final layout", () => {
    const containerWidth = 200;
    const initial = setup(containerWidth);
    const { state, layout } = typeChars("Hi there", initial, containerWidth);

    expect(state.children[0].children[0].properties.content).toBe("Hi there");

    if (layout.type !== "block") throw new Error("expected block");
    const para = layout.children[0];
    if (para.type !== "block") throw new Error("expected block");
    expect(para.children).toHaveLength(1);
    const line = para.children[0];
    expect(line.type).toBe("line");
    expect(lineText(line)).toBe("Hi there");
  });

  it("undoes all keystrokes in one collapsed group and redoes", () => {
    const initial = setup(200);
    const { state, history } = typeCharsWithHistory("Hi there", initial.doc, 50);

    expect(history.undoStack).toHaveLength(1);
    expect(state.children[0].children[0].properties.content).toBe("Hi there");

    const undoResult = undo(history);
    expect(undoResult).not.toBeNull();
    expect(undoResult!.state.children[0].children[0].properties.content).toBe("");

    const redoResult = redo(undoResult!.history);
    expect(redoResult).not.toBeNull();
    expect(redoResult!.state.children[0].children[0].properties.content).toBe("Hi there");

    const redoRendered = renderTree(redoResult!.state, registry);
    const redoLayout = layoutTree(redoRendered, 200, measurer);
    if (redoLayout.type !== "block") throw new Error("expected block");
    if (redoLayout.children[0].type !== "block") throw new Error("expected block");
    const line = redoLayout.children[0].children[0];
    expect(lineText(line)).toBe("Hi there");
  });

  it("typing causes word wrap in a narrow container", () => {
    const containerWidth = 64;
    const initial = setup(containerWidth);

    const { state, layout } = typeChars("Hello World", initial, containerWidth);

    expect(state.children[0].children[0].properties.content).toBe("Hello World");

    if (layout.type !== "block") throw new Error("expected block");
    const para = layout.children[0];
    if (para.type !== "block") throw new Error("expected block");
    // Should have wrapped: "Hello " on line 1, "World" on line 2
    expect(para.children).toHaveLength(2);
    if (para.children[0].type !== "line") throw new Error("expected line");
    if (para.children[1].type !== "line") throw new Error("expected line");
    expect(expectTextBox(para.children[0].children[0]).text).toBe("Hello ");
    expect(expectTextBox(para.children[1].children[0]).text).toBe("World");
  });
});
