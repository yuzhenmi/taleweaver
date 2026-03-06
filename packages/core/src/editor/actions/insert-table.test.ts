import { describe, it, expect } from "vitest";
import {
  config,
  getTextAt,
  stateWithText,
  withSelection,
  createInitialEditorState,
  reduceEditor,
  createCursor,
  createPosition,
  createSelection,
} from "./test-helpers";

describe("INSERT_BLOCK with table", () => {
  it("inserts table with correct nested structure", () => {
    let s = stateWithText("abcdef");
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, {
      type: "INSERT_BLOCK",
      blockType: "table",
      properties: { rows: 2, columns: 3 },
    }, config);

    // Should have 3 doc children: para("abc"), table, para("def")
    expect(s.state.children).toHaveLength(3);
    expect(s.state.children[0].type).toBe("paragraph");
    expect(getTextAt(s, [0, 0])).toBe("abc");

    const table = s.state.children[1];
    expect(table.type).toBe("table");
    expect(table.children).toHaveLength(2); // 2 rows
    expect(table.properties.columnWidths).toHaveLength(3);
    expect(table.properties.rowHeights).toEqual([0, 0]);

    // First row has 3 cells
    const row0 = table.children[0];
    expect(row0.type).toBe("table-row");
    expect(row0.children).toHaveLength(3);

    // Each cell has a paragraph with an empty text node
    const cell00 = row0.children[0];
    expect(cell00.type).toBe("table-cell");
    expect(cell00.children).toHaveLength(1);
    expect(cell00.children[0].type).toBe("paragraph");
    expect(cell00.children[0].children).toHaveLength(1);
    expect(cell00.children[0].children[0].type).toBe("text");

    // Second row also has 3 cells
    const row1 = table.children[1];
    expect(row1.type).toBe("table-row");
    expect(row1.children).toHaveLength(3);

    expect(s.state.children[2].type).toBe("paragraph");
    expect(getTextAt(s, [2, 0])).toBe("def");
  });

  it("places cursor in first cell after insertion", () => {
    let s = stateWithText("abcdef");
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, {
      type: "INSERT_BLOCK",
      blockType: "table",
      properties: { rows: 2, columns: 3 },
    }, config);

    // Cursor should be at first text in first cell: [1, 0, 0, 0, 0]
    expect(s.selection.focus.path).toEqual([1, 0, 0, 0, 0]);
    expect(s.selection.focus.offset).toBe(0);
  });

  it("preserves split paragraph before/after", () => {
    let s = stateWithText("hello world");
    s = withSelection(s, createCursor([0, 0], 6)); // after "hello "
    s = reduceEditor(s, {
      type: "INSERT_BLOCK",
      blockType: "table",
      properties: { rows: 1, columns: 2 },
    }, config);

    expect(getTextAt(s, [0, 0])).toBe("hello ");
    expect(s.state.children[1].type).toBe("table");
    expect(getTextAt(s, [2, 0])).toBe("world");
  });

  it("accepts custom columnWidths", () => {
    let s = stateWithText("text");
    s = reduceEditor(s, {
      type: "INSERT_BLOCK",
      blockType: "table",
      properties: { rows: 1, columns: 2, columnWidths: [0.4, 0.6] },
    }, config);

    const table = s.state.children[1];
    expect(table.properties.columnWidths).toEqual([0.4, 0.6]);
  });

  it("defaults columnWidths to equal fractions summing to 1", () => {
    let s = stateWithText("text");
    s = reduceEditor(s, {
      type: "INSERT_BLOCK",
      blockType: "table",
      properties: { rows: 1, columns: 4 },
    }, config);

    const table = s.state.children[1];
    // 4 columns → 0.25 each
    expect(table.properties.columnWidths).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it("supports undo", () => {
    let s = stateWithText("abcdef");
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, {
      type: "INSERT_BLOCK",
      blockType: "table",
      properties: { rows: 2, columns: 3 },
    }, config);
    s = reduceEditor(s, { type: "UNDO" }, config);

    expect(s.state.children).toHaveLength(1);
    expect(getTextAt(s, [0, 0])).toBe("abcdef");
  });

  it("handles expanded selection", () => {
    let s = stateWithText("abcdef");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, {
      type: "INSERT_BLOCK",
      blockType: "table",
      properties: { rows: 1, columns: 2 },
    }, config);

    // After deleting "bcd": "a" + table + "ef"
    expect(s.state.children).toHaveLength(3);
    expect(getTextAt(s, [0, 0])).toBe("a");
    expect(s.state.children[1].type).toBe("table");
    expect(getTextAt(s, [2, 0])).toBe("ef");
  });

  it("replaces empty paragraph with table and normalizes", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, {
      type: "INSERT_BLOCK",
      blockType: "table",
      properties: { rows: 2, columns: 3 },
    }, config);

    // Normalizer inserts structural para before table at doc start
    expect(s.state.children).toHaveLength(3);
    expect(s.state.children[0].type).toBe("paragraph");
    expect(s.state.children[1].type).toBe("table");
    expect(s.state.children[2].type).toBe("paragraph");
    expect(getTextAt(s, [2, 0])).toBe("");
  });

  it("cursor in first cell after replacing empty paragraph", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, {
      type: "INSERT_BLOCK",
      blockType: "table",
      properties: { rows: 2, columns: 3 },
    }, config);

    // After normalization, table is at index 1
    expect(s.selection.focus.path).toEqual([1, 0, 0, 0, 0]);
    expect(s.selection.focus.offset).toBe(0);
  });

  it("replaces empty paragraph between paragraphs", () => {
    // Build: ["abc", empty, "def"]
    let s = stateWithText("abc");
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "def" }, config);
    // Move cursor to the empty middle paragraph
    s = withSelection(s, createCursor([1, 0], 0));

    s = reduceEditor(s, {
      type: "INSERT_BLOCK",
      blockType: "table",
      properties: { rows: 1, columns: 2 },
    }, config);

    // para("abc"), table, empty-para, para("def")
    expect(s.state.children).toHaveLength(4);
    expect(getTextAt(s, [0, 0])).toBe("abc");
    expect(s.state.children[1].type).toBe("table");
    expect(s.state.children[2].type).toBe("paragraph");
    expect(getTextAt(s, [2, 0])).toBe("");
    expect(getTextAt(s, [3, 0])).toBe("def");
  });
});
