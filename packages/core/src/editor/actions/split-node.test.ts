import { describe, it, expect } from "vitest";
import { getTextContent, getNodeByPath } from "@taleweaver/core";
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
} from "./test-helpers";

describe("SPLIT_NODE", () => {
  it("splits paragraph and moves cursor to new paragraph", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abcdef" }, config);
    // Move cursor to offset 3
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);

    expect(s.state.children).toHaveLength(2);
    expect(getTextAt(s, [0, 0])).toBe("abc");
    expect(getTextAt(s, [1, 0])).toBe("def");
    // Cursor at start of new paragraph
    expect(s.selection.focus.path).toEqual([1, 0]);
    expect(s.selection.focus.offset).toBe(0);
  });

  it("splits at end creates empty paragraph", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);

    expect(s.state.children).toHaveLength(2);
    expect(getTextAt(s, [0, 0])).toBe("abc");
    expect(getTextAt(s, [1, 0])).toBe("");
  });

  it("deletes selection then splits", () => {
    let s = stateWithText("abcdef");
    // Select "cd" (offset 2-4)
    s = withSelection(s, createSelection(
      createPosition([0, 0], 2),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    expect(s.state.children).toHaveLength(2);
    expect(getTextAt(s, [0, 0])).toBe("ab");
    expect(getTextAt(s, [1, 0])).toBe("ef");
  });
});

describe("SPLIT_NODE with styled text", () => {
  it("splits correctly when selection spans bold paragraph to plain paragraph", () => {
    // Setup: two paragraphs, first is bold, second is plain
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "hello" }, config);
    // Select all text and bold it
    s = withSelection(s, createSelection(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    ));
    s = reduceEditor(s, { type: "TOGGLE_STYLE", style: "bold" }, config);
    // Move cursor to end of bolded text, then split to create second paragraph
    const boldPara = s.state.children[0];
    const boldTextPath = boldPara.children.some(c => c.type === "span")
      ? [0, 0, 0] // paragraph > span > text
      : [0, 0];   // paragraph > text
    const boldTextLen = getTextContent(
      boldPara.children.some(c => c.type === "span")
        ? boldPara.children[0].children[0]
        : boldPara.children[0],
    ).length;
    s = withSelection(s, createCursor(boldTextPath, boldTextLen));
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    // Type in second paragraph (plain)
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "world" }, config);

    expect(s.state.children).toHaveLength(2);

    // Now select from middle of first paragraph to end of second
    s = withSelection(s, createSelection(
      createPosition(boldTextPath, 2),
      createPosition([1, 0], 5),
    ));

    // This should not crash
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    expect(s.state.children).toHaveLength(2);
    // Cursor should be at start of new (second) paragraph
    expect(s.selection.focus.offset).toBe(0);
  });
});

describe("SPLIT_NODE on heading", () => {
  it("creates a new paragraph (not heading) after splitting", () => {
    let s = stateWithText("Title text");
    s = reduceEditor(
      s,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } },
      config,
    );
    // Move cursor to middle of heading
    s = withSelection(s, createCursor([0, 0], 5));
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    expect(s.state.children).toHaveLength(2);
    expect(s.state.children[0].type).toBe("heading");
    expect(s.state.children[1].type).toBe("paragraph");
    expect(getTextAt(s, [0, 0])).toBe("Title");
    expect(getTextAt(s, [1, 0])).toBe(" text");
  });
});

describe("SPLIT_NODE in list", () => {
  it("creates a new list item when splitting within a list item", () => {
    let s = stateWithText("item one");
    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "unordered" }, config);
    // Move to middle: [0, 0, 0] offset 4
    s = withSelection(s, createCursor([0, 0, 0], 4));
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    const list = s.state.children[0];
    expect(list.type).toBe("list");
    expect(list.children).toHaveLength(2);
    expect(getTextContent(list.children[0].children[0])).toBe("item");
    expect(getTextContent(list.children[1].children[0])).toBe(" one");
  });

  it("exits list when pressing enter on empty list item", () => {
    let s = stateWithText("");
    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "unordered" }, config);
    // Cursor at [0, 0, 0] offset 0, empty list item
    s = withSelection(s, createCursor([0, 0, 0], 0));
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    // Should have exited the list — first child should be a paragraph
    expect(s.state.children[0].type).toBe("paragraph");
  });
});

describe("SPLIT_NODE in table cell", () => {
  function stateWithTable(): ReturnType<typeof createInitialEditorState> {
    let s = stateWithText("");
    s = withSelection(s, createCursor([0, 0], 0));
    s = reduceEditor(s, { type: "INSERT_TABLE", rows: 2, columns: 2 }, config);
    return s;
  }

  it("creates new paragraph within same cell (not a new row)", () => {
    let s = stateWithTable();
    // Type text in first cell
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "hello" }, config);
    // Enter → should split paragraph within the cell
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);

    const table = s.state.children[1];
    expect(table.type).toBe("table");
    // Still 2 rows (no new row created)
    expect(table.children).toHaveLength(2);
    // First cell should have 2 paragraphs now
    const cell00 = table.children[0].children[0];
    expect(cell00.children).toHaveLength(2);
    // cell > para > text: access the text node directly
    expect(getTextContent(cell00.children[0].children[0])).toBe("hello");
    expect(getTextContent(cell00.children[1].children[0])).toBe("");
  });

  it("places cursor at start of new paragraph in cell", () => {
    let s = stateWithTable();
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    // Move to middle
    s = withSelection(s, createCursor([1, 0, 0, 0, 0], 1));
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);

    // Cursor at new paragraph in first cell: [1, 0, 0, 1, 0]
    expect(s.selection.focus.path).toEqual([1, 0, 0, 1, 0]);
    expect(s.selection.focus.offset).toBe(0);
  });

  it("splits at start of cell paragraph", () => {
    let s = stateWithTable();
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "text" }, config);
    // Move cursor to start of the text in first cell
    s = withSelection(s, createCursor([1, 0, 0, 0, 0], 0));
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);

    const cell00 = s.state.children[1].children[0].children[0];
    expect(cell00.children).toHaveLength(2);
    expect(getTextContent(cell00.children[0].children[0])).toBe("");
    expect(getTextContent(cell00.children[1].children[0])).toBe("text");
  });

  it("splits at end of cell paragraph", () => {
    let s = stateWithTable();
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "text" }, config);
    // Cursor should already be at end: [1, 0, 0, 0, 0] offset 4
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);

    const cell00 = s.state.children[1].children[0].children[0];
    expect(cell00.children).toHaveLength(2);
    expect(getTextContent(cell00.children[0].children[0])).toBe("text");
    expect(getTextContent(cell00.children[1].children[0])).toBe("");
  });
});
