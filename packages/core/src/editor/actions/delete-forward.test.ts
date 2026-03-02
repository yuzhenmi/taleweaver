import { describe, it, expect } from "vitest";
import {
  config,
  getTextAt,
  stateWithText,
  stateWithTwoParagraphs,
  withSelection,
  reduceEditor,
  createPosition,
  createSelection,
  createCursor,
  isCollapsed,
} from "./test-helpers";

describe("DELETE_FORWARD", () => {
  it("deletes character after cursor", () => {
    let s = stateWithText("abc");
    s = withSelection(s, createCursor([0, 0], 1));
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(getTextAt(s, [0, 0])).toBe("ac");
    expect(s.selection.focus.offset).toBe(1);
  });

  it("does nothing at end of last paragraph", () => {
    let s = stateWithText("abc");
    // cursor at end (offset 3)
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(s.state).toBe(before);
  });

  it("merges with next paragraph at paragraph boundary", () => {
    let s = stateWithTwoParagraphs();
    // Move to end of first paragraph
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(s.state.children).toHaveLength(1);
    expect(getTextAt(s, [0, 0])).toBe("abcdef");
    expect(s.selection.focus.offset).toBe(3);
  });

  it("deletes selected range when selection is expanded", () => {
    let s = stateWithText("abcde");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 3),
    ));
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(getTextAt(s, [0, 0])).toBe("ade");
    expect(isCollapsed(s.selection)).toBe(true);
  });

  it("deletes first character when cursor at start", () => {
    let s = stateWithText("abc");
    s = withSelection(s, createCursor([0, 0], 0));
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(getTextAt(s, [0, 0])).toBe("bc");
    expect(s.selection.focus.offset).toBe(0);
  });

  it("removes void block when forward-deleting at end of paragraph before it", () => {
    let s = stateWithText("abc");
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);
    // State: para("abc"), HR, para("")  — cursor at [2, 0] offset 0
    // Move cursor to end of first paragraph
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);

    // HR should be removed, leaving: para("abc"), para("")
    expect(s.state.children).toHaveLength(2);
    expect(s.state.children[0].type).toBe("paragraph");
    expect(s.state.children[1].type).toBe("paragraph");
  });

  it("keeps cursor in place after forward-deleting void block", () => {
    let s = stateWithText("abc");
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);

    expect(s.selection.focus.path).toEqual([0, 0]);
    expect(s.selection.focus.offset).toBe(3);
  });
});

describe("DELETE_FORWARD in table cell", () => {
  function stateWithTable() {
    let s = stateWithText("");
    s = withSelection(s, createCursor([0, 0], 0));
    s = reduceEditor(s, { type: "INSERT_TABLE", rows: 2, columns: 2 }, config);
    return s;
  }

  it("does nothing at end of last cell", () => {
    let s = stateWithTable();
    // Move cursor to last cell [1, 1, 1, 0, 0] offset 0 (empty text)
    s = withSelection(s, createCursor([1, 1, 1, 0, 0], 0));
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(s.state).toBe(before);
  });

  it("does nothing at end of any cell", () => {
    let s = stateWithTable();
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    // cursor at [1, 0, 0, 0, 0] offset 3 (end of first cell)
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(s.state).toBe(before);
  });

  it("allows normal forward deletion within a cell", () => {
    let s = stateWithTable();
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    // Move cursor to start, then delete forward
    s = withSelection(s, createCursor([1, 0, 0, 0, 0], 0));
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(getTextAt(s, [1, 0, 0, 0, 0])).toBe("bc");
  });
});
