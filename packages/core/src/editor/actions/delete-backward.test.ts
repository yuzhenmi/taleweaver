import { describe, it, expect } from "vitest";
import {
  config,
  getTextAt,
  stateWithText,
  withSelection,
  createInitialEditorState,
  reduceEditor,
  createPosition,
  createSelection,
  isCollapsed,
} from "./test-helpers";

describe("DELETE_BACKWARD", () => {
  it("deletes character before cursor", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    expect(getTextAt(s, [0, 0])).toBe("ab");
    expect(s.selection.focus.offset).toBe(2);
  });

  it("does nothing at start of document", () => {
    const s0 = createInitialEditorState(config);
    const s1 = reduceEditor(s0, { type: "DELETE_BACKWARD" }, config);
    expect(getTextAt(s1, [0, 0])).toBe("");
    expect(s1.selection.focus.offset).toBe(0);
  });

  it("merges paragraphs at paragraph boundary", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "def" }, config);
    // Cursor is at [1, 0] offset 3. Move to start of second paragraph.
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    // Now at [1, 0] offset 0. Delete backward should merge.
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    expect(s.state.children).toHaveLength(1);
    expect(getTextAt(s, [0, 0])).toBe("abcdef");
    expect(s.selection.focus.offset).toBe(3);
  });

  it("deletes the selected range instead of single char", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    expect(getTextAt(s, [0, 0])).toBe("ho");
    expect(isCollapsed(s.selection)).toBe(true);
    expect(s.selection.focus.offset).toBe(1);
  });
});
