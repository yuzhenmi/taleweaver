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
  createCursor,
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

  it("removes void block when backspacing at start of paragraph after it", () => {
    let s = stateWithText("abc");
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);
    // State: para("abc"), HR, para("")  — cursor at [2, 0] offset 0
    expect(s.state.children).toHaveLength(3);
    expect(s.state.children[1].type).toBe("horizontal-line");

    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    // HR should be removed, leaving: para("abc"), para("")
    expect(s.state.children).toHaveLength(2);
    expect(s.state.children[0].type).toBe("paragraph");
    expect(s.state.children[1].type).toBe("paragraph");
    expect(getTextAt(s, [0, 0])).toBe("abc");
  });

  it("removes void block and adjusts cursor path", () => {
    let s = stateWithText("abc");
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "def" }, config);
    // State: para("abc"), HR, para("def")  — cursor at [2, 0] offset 3
    s = withSelection(s, createCursor([2, 0], 0));
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);

    expect(s.state.children).toHaveLength(2);
    expect(s.selection.focus.path).toEqual([1, 0]);
    expect(s.selection.focus.offset).toBe(0);
  });
});

describe("DELETE_BACKWARD in table cell", () => {
  function stateWithTable() {
    let s = stateWithText("");
    s = withSelection(s, createCursor([0, 0], 0));
    s = reduceEditor(s, { type: "INSERT_TABLE", rows: 2, columns: 2 }, config);
    return s;
  }

  it("does nothing at start of first cell", () => {
    let s = stateWithTable();
    // Cursor at [1, 0, 0, 0, 0] offset 0 (start of first cell)
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    expect(s.state).toBe(before);
  });

  it("does nothing at start of any cell", () => {
    let s = stateWithTable();
    // Move cursor to start of cell [0,1] (second column, first row)
    s = withSelection(s, createCursor([1, 0, 1, 0, 0], 0));
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    expect(s.state).toBe(before);
  });

  it("allows normal deletion within a cell", () => {
    let s = stateWithTable();
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    // cursor at [1, 0, 0, 0, 0] offset 3
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    expect(getTextAt(s, [1, 0, 0, 0, 0])).toBe("ab");
  });

  it("merges paragraphs within same cell when backspace at start of 2nd para", () => {
    let s = stateWithTable();
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    // Cursor now at [1, 0, 0, 1, 0] offset 0 (start of 2nd paragraph in cell)
    // This is NOT a cell boundary (it's a paragraph boundary within the cell)
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    // Should merge the two paragraphs within the cell
    const cell = s.state.children[1].children[0].children[0];
    expect(cell.children).toHaveLength(1);
  });
});
