import { describe, it, expect } from "vitest";
import {
  config,
  getTextAt,
  stateWithText,
  stateWithTwoParagraphs,
  withSelection,
  createInitialEditorState,
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
    // Move cursor to end of first paragraph
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);

    // HR should be removed
    expect(s.state.children.every(c => c.type !== "horizontal-line")).toBe(true);
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
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "table", properties: { rows: 2, columns: 2 } }, config);
    return s;
  }

  function tableIndex(s: ReturnType<typeof stateWithTable>): number {
    return s.state.children.findIndex(c => c.type === "table");
  }

  it("does nothing at end of last cell", () => {
    let s = stateWithTable();
    const ti = tableIndex(s);
    // Move cursor to last cell [ti, 1, 1, 0, 0] offset 0 (empty text)
    s = withSelection(s, createCursor([ti, 1, 1, 0, 0], 0));
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(s.state).toBe(before);
  });

  it("does nothing at end of any cell", () => {
    let s = stateWithTable();
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    // cursor at [ti, 0, 0, 0, 0] offset 3 (end of first cell)
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(s.state).toBe(before);
  });

  it("allows normal forward deletion within a cell", () => {
    let s = stateWithTable();
    const ti = tableIndex(s);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    // Move cursor to start, then delete forward
    s = withSelection(s, createCursor([ti, 0, 0, 0, 0], 0));
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(getTextAt(s, [ti, 0, 0, 0, 0])).toBe("bc");
  });
});

describe("DELETE_FORWARD on structural paragraphs", () => {
  it("is a no-op on empty paragraph between two tables", () => {
    // Build: para, table, structural-para, table, para
    let s = createInitialEditorState(config);
    s = reduceEditor(s, {
      type: "INSERT_BLOCK",
      blockType: "table",
      properties: { rows: 1, columns: 1 },
    }, config);
    // Move cursor to trailing para
    const lastIdx = s.state.children.length - 1;
    s = withSelection(s, createCursor([lastIdx, 0], 0));
    s = reduceEditor(s, {
      type: "INSERT_BLOCK",
      blockType: "table",
      properties: { rows: 1, columns: 1 },
    }, config);

    // Find structural paragraph between two tables
    const types = s.state.children.map(c => c.type);
    let structuralIdx = -1;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === "paragraph" && i > 0 && types[i - 1] === "table" && i < types.length - 1 && types[i + 1] === "table") {
        structuralIdx = i;
        break;
      }
    }
    expect(structuralIdx).toBeGreaterThan(0);

    s = withSelection(s, createCursor([structuralIdx, 0], 0));
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(s.state).toBe(before);
  });

  it("still allows forward delete on non-structural empty paragraph", () => {
    // Build: para("abc"), empty-para, para("def")
    let s = stateWithText("abc");
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "def" }, config);
    // Move cursor to empty middle paragraph
    s = withSelection(s, createCursor([1, 0], 0));
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    // Should merge with next — the empty para was not structural
    expect(s.state.children).toHaveLength(2);
  });
});
