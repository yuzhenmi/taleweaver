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

  it("removes void block when backspacing from non-structural paragraph", () => {
    // Build: para("abc"), HR, para("def") — the trailing para has content, so it's non-structural
    let s = stateWithText("abc");
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "def" }, config);
    // Move cursor to start of the paragraph after the HR
    const hrIdx = s.state.children.findIndex(c => c.type === "horizontal-line");
    s = withSelection(s, createCursor([hrIdx + 1, 0], 0));
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    // HR should be removed
    expect(s.state.children.every(c => c.type !== "horizontal-line")).toBe(true);
  });

  it("does not remove void block when backspacing from structural paragraph", () => {
    let s = stateWithText("abc");
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);
    // State: para("abc"), HR, para("")  — trailing para is structural
    const hrIdx = s.state.children.findIndex(c => c.type === "horizontal-line");
    expect(hrIdx).toBeGreaterThanOrEqual(0);

    // Cursor should be in trailing structural para
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    // Should be no-op — structural paragraph is protected
    expect(s.state).toBe(before);
  });
});

describe("DELETE_BACKWARD in table cell", () => {
  function stateWithTable() {
    let s = stateWithText("");
    s = withSelection(s, createCursor([0, 0], 0));
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "table", properties: { rows: 2, columns: 2 } }, config);
    return s;
  }

  function tableIndex(s: ReturnType<typeof stateWithTable>): number {
    return s.state.children.findIndex(c => c.type === "table");
  }

  it("does nothing at start of first cell", () => {
    let s = stateWithTable();
    // Cursor should already be at first cell
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    expect(s.state).toBe(before);
  });

  it("does nothing at start of any cell", () => {
    let s = stateWithTable();
    const ti = tableIndex(s);
    // Move cursor to start of cell [ti,0,1] (second column, first row)
    s = withSelection(s, createCursor([ti, 0, 1, 0, 0], 0));
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    expect(s.state).toBe(before);
  });

  it("allows normal deletion within a cell", () => {
    let s = stateWithTable();
    const ti = tableIndex(s);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    // cursor at [ti, 0, 0, 0, 0] offset 3
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    expect(getTextAt(s, [ti, 0, 0, 0, 0])).toBe("ab");
  });

  it("merges paragraphs within same cell when backspace at start of 2nd para", () => {
    let s = stateWithTable();
    const ti = tableIndex(s);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    // Cursor now at [ti, 0, 0, 1, 0] offset 0 (start of 2nd paragraph in cell)
    // This is NOT a cell boundary (it's a paragraph boundary within the cell)
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    // Should merge the two paragraphs within the cell
    const cell = s.state.children[ti].children[0].children[0];
    expect(cell.children).toHaveLength(1);
  });
});

describe("DELETE_BACKWARD on structural paragraphs", () => {
  it("is a no-op on empty paragraph between two HRs", () => {
    // Build: para, HR, structural-para, HR, para
    let s = stateWithText("abc");
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);
    // Now at trailing para. Insert another HR:
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);

    // Find the structural paragraph between the two HRs
    const types = s.state.children.map(c => c.type);
    let structuralIdx = -1;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === "paragraph" && i > 0 && types[i - 1] === "horizontal-line" && i < types.length - 1 && types[i + 1] === "horizontal-line") {
        structuralIdx = i;
        break;
      }
    }
    expect(structuralIdx).toBeGreaterThan(0);

    s = withSelection(s, createCursor([structuralIdx, 0], 0));
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    expect(s.state).toBe(before);
  });

  it("is a no-op on empty paragraph at doc start before table", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, {
      type: "INSERT_BLOCK",
      blockType: "table",
      properties: { rows: 1, columns: 2 },
    }, config);

    // After normalization: [structural-para, table, para]
    expect(s.state.children[0].type).toBe("paragraph");
    s = withSelection(s, createCursor([0, 0], 0));
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    expect(s.state).toBe(before);
  });

  it("still deletes non-structural empty paragraphs normally", () => {
    // Build: para("abc"), empty-para, para("def") — the empty-para is NOT structural
    let s = stateWithText("abc");
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "def" }, config);
    // Move cursor to empty middle paragraph
    s = withSelection(s, createCursor([1, 0], 0));
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    // Should merge — the empty para was not structural
    expect(s.state.children).toHaveLength(2);
  });
});
