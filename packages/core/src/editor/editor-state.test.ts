import { describe, it, expect, vi } from "vitest";
import {
  createMockMeasurer,
  createRegistry,
  defaultComponents,
  getNodeByPath,
  getTextContent,
} from "@taleweaver/core";
import {
  createInitialEditorState,
  reduceEditor,
  type EditorConfig,
  type EditorState,
} from "./editor-state";

const measurer = createMockMeasurer(8, 16);
const registry = createRegistry([...defaultComponents]);
const config: EditorConfig = { measurer, registry, containerWidth: 200 };

function getTextAt(
  state: ReturnType<typeof createInitialEditorState>,
  path: readonly number[],
): string {
  const node = getNodeByPath(state.state, path);
  return node ? getTextContent(node) : "";
}

function typeChars(
  state: EditorState,
  chars: string,
): EditorState {
  let s = state;
  for (const ch of chars) {
    s = reduceEditor(s, { type: "INSERT_TEXT", text: ch }, config);
  }
  return s;
}

describe("createInitialEditorState", () => {
  it("creates state with empty document", () => {
    const s = createInitialEditorState(config);
    expect(s.state.type).toBe("document");
    expect(s.state.children).toHaveLength(1);
    expect(getTextAt(s, [0, 0])).toBe("");
  });

  it("has cursor at start", () => {
    const s = createInitialEditorState(config);
    expect(s.selection.anchor.path).toEqual([0, 0]);
    expect(s.selection.anchor.offset).toBe(0);
  });

  it("has render and layout trees", () => {
    const s = createInitialEditorState(config);
    expect(s.renderTree).toBeDefined();
    expect(s.layoutTree).toBeDefined();
  });

  it("initializes targetX to null", () => {
    const s = createInitialEditorState(config);
    expect(s.targetX).toBeNull();
  });
});

describe("undo history grouping", () => {
  it("merges rapid INSERT_TEXT actions into a single undo entry", () => {
    let state = createInitialEditorState(config);
    // Type "hello" rapidly (timestamps from Date.now() will be very close)
    state = typeChars(state, "hello");

    // All 5 characters should be merged into 1 undo entry
    expect(state.history.undoStack.length).toBe(1);

    // Undo should revert all 5 characters at once
    state = reduceEditor(state, { type: "UNDO" }, config);
    expect(getTextAt(state, [0, 0])).toBe("");
  });

  it("creates a new undo group after a pause", () => {
    let state = createInitialEditorState(config);

    // Type "hi" rapidly
    state = typeChars(state, "hi");
    expect(state.history.undoStack.length).toBe(1);

    // Simulate a pause by advancing Date.now() beyond the merge threshold
    const realNow = Date.now;
    Date.now = vi.fn(() => realNow() + 1000);
    try {
      state = typeChars(state, "x");
    } finally {
      Date.now = realNow;
    }

    // Should have 2 undo entries: "hi" and "x"
    expect(state.history.undoStack.length).toBe(2);

    // Undo should revert just "x"
    state = reduceEditor(state, { type: "UNDO" }, config);
    expect(getTextAt(state, [0, 0])).toBe("hi");
  });

  it("does not merge across SPLIT_NODE", () => {
    let state = createInitialEditorState(config);

    // Type "ab" (merged into 1 entry)
    state = typeChars(state, "ab");
    expect(state.history.undoStack.length).toBe(1);

    // Press Enter (structural — breaks merge chain)
    state = reduceEditor(state, { type: "SPLIT_NODE" }, config);
    expect(state.history.undoStack.length).toBe(2);

    // Type "cd" — should NOT merge with "ab" group
    state = typeChars(state, "cd");
    expect(state.history.undoStack.length).toBe(3);
  });

  it("merges rapid DELETE_BACKWARD actions into a single undo entry", () => {
    let state = createInitialEditorState(config);

    // Type "hello" (1 merged entry)
    state = typeChars(state, "hello");
    const undoCountAfterType = state.history.undoStack.length;
    expect(undoCountAfterType).toBe(1);

    // Delete 3 chars rapidly
    state = reduceEditor(state, { type: "DELETE_BACKWARD" }, config);
    state = reduceEditor(state, { type: "DELETE_BACKWARD" }, config);
    state = reduceEditor(state, { type: "DELETE_BACKWARD" }, config);

    // Should have 1 more undo entry (the merged deletes), not 3
    expect(state.history.undoStack.length).toBe(undoCountAfterType + 1);

    // Undo should restore all 3 chars at once
    state = reduceEditor(state, { type: "UNDO" }, config);
    expect(getTextAt(state, [0, 0])).toBe("hello");
  });

  it("does not merge inserts with deletes", () => {
    let state = createInitialEditorState(config);

    // Type "abc" (1 merged entry)
    state = typeChars(state, "abc");
    expect(state.history.undoStack.length).toBe(1);

    // Delete 1 char — different action type, should start new group
    state = reduceEditor(state, { type: "DELETE_BACKWARD" }, config);
    expect(state.history.undoStack.length).toBe(2);
  });
});
