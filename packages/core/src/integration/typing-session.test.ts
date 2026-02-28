/**
 * Integration: realistic typing session.
 *
 * Simulates a user typing character-by-character into an empty document,
 * running the full State → Render → Layout pipeline after each keystroke.
 * Tests undo/redo via collapsed history groups.
 */
import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "../state/create-node";
import { createPosition } from "../state/position";
import { insertText } from "../state/transformations";
import { renderTree, renderTreeIncremental } from "../render/render";
import { layoutTree, layoutTreeIncremental } from "../layout/layout-engine";
import { createHistory, pushChange, undo, redo } from "../state/history";
import type { Change } from "../state/change";
import type { StateNode } from "../state/state-node";
import type { History } from "../state/history";
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
 * Type a string character-by-character, running the full incremental
 * pipeline after each keystroke. Returns the final state and pipeline outputs.
 */
function typeChars(
  chars: string,
  initial: ReturnType<typeof setup>,
  containerWidth: number,
) {
  let state = initial.doc;
  let rendered = initial.rendered;
  let layout = initial.layout;

  for (let i = 0; i < chars.length; i++) {
    const pos = createPosition([0, 0], i);
    const change = insertText(state, pos, chars[i]);

    const newRendered = renderTreeIncremental(
      change.newState,
      state,
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

    state = change.newState;
    rendered = newRendered;
    layout = newLayout;
  }

  return { state, rendered, layout };
}

/**
 * Type a string with history tracking (fixed timestamps for collapse control).
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
  it("types 'Hi there' character-by-character with correct final layout", () => {
    const containerWidth = 200;
    const initial = setup(containerWidth);
    const { state, layout } = typeChars("Hi there", initial, containerWidth);

    // Final state has the full text
    expect(state.children[0].children[0].properties.content).toBe("Hi there");

    // Layout: single paragraph, single line with word boxes
    const para = layout.children[0];
    expect(para.children).toHaveLength(1);
    const line = para.children[0];
    expect(line.type).toBe("line");

    expect(lineText(line)).toBe("Hi there");
  });

  it("undoes all keystrokes in one collapsed group and redoes", () => {
    const initial = setup(200);
    // 50ms apart, all within 500ms collapse threshold
    const { state, history } = typeCharsWithHistory("Hi there", initial.doc, 50);

    // All keystrokes collapse into one undo entry
    expect(history.undoStack).toHaveLength(1);
    expect(state.children[0].children[0].properties.content).toBe("Hi there");

    // Undo restores to empty
    const undoResult = undo(history)!;
    expect(undoResult).not.toBeNull();
    expect(undoResult.state.children[0].children[0].properties.content).toBe("");

    // Redo restores the typed text
    const redoResult = redo(undoResult.history)!;
    expect(redoResult).not.toBeNull();
    expect(redoResult.state.children[0].children[0].properties.content).toBe(
      "Hi there",
    );

    // Verify layout of redone state
    const redoRendered = renderTree(redoResult.state, registry);
    const redoLayout = layoutTree(redoRendered, 200, measurer);
    const line = redoLayout.children[0].children[0];
    expect(lineText(line)).toBe("Hi there");
  });

  it("typing causes word wrap mid-session in a narrow container", () => {
    // 64px container = 8 characters per line
    const containerWidth = 64;
    const initial = setup(containerWidth);

    // "Hello " (6 chars = 48px) fits on one line
    const after6 = typeChars("Hello ", initial, containerWidth);
    expect(after6.layout.children[0].children).toHaveLength(1);

    // Continue typing "World" — "Hello " + "World" = 11 chars = 88px → wraps
    let state = after6.state;
    let rendered = after6.rendered;
    let layout = after6.layout;

    for (let i = 0; i < "World".length; i++) {
      const pos = createPosition([0, 0], 6 + i);
      const change = insertText(state, pos, "World"[i]);

      const newRendered = renderTreeIncremental(
        change.newState,
        state,
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

      state = change.newState;
      rendered = newRendered;
      layout = newLayout;
    }

    expect(state.children[0].children[0].properties.content).toBe(
      "Hello World",
    );

    // Should have wrapped: "Hello " on line 1, "World" on line 2
    const para = layout.children[0];
    expect(para.children).toHaveLength(2);
    expect(expectTextBox(para.children[0].children[0]).text).toBe("Hello ");
    expect(expectTextBox(para.children[1].children[0]).text).toBe("World");
  });
});
