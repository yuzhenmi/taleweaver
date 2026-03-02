import { describe, it, expect } from "vitest";
import {
  config,
  getTextAt,
  stateWithText,
  withSelection,
  reduceEditor,
  createCursor,
  createPosition,
  createSelection,
} from "./test-helpers";

describe("INSERT_TABLE", () => {
  it("inserts table with correct nested structure", () => {
    let s = stateWithText("abcdef");
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "INSERT_TABLE", rows: 2, columns: 3 }, config);

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
    s = reduceEditor(s, { type: "INSERT_TABLE", rows: 2, columns: 3 }, config);

    // Cursor should be at first text in first cell: [1, 0, 0, 0, 0]
    expect(s.selection.focus.path).toEqual([1, 0, 0, 0, 0]);
    expect(s.selection.focus.offset).toBe(0);
  });

  it("preserves split paragraph before/after", () => {
    let s = stateWithText("hello world");
    s = withSelection(s, createCursor([0, 0], 6)); // after "hello "
    s = reduceEditor(s, { type: "INSERT_TABLE", rows: 1, columns: 2 }, config);

    expect(getTextAt(s, [0, 0])).toBe("hello ");
    expect(s.state.children[1].type).toBe("table");
    expect(getTextAt(s, [2, 0])).toBe("world");
  });

  it("accepts custom columnWidths", () => {
    let s = stateWithText("text");
    s = reduceEditor(s, {
      type: "INSERT_TABLE",
      rows: 1,
      columns: 2,
      columnWidths: [80, 120],
    }, config);

    const table = s.state.children[1];
    expect(table.properties.columnWidths).toEqual([80, 120]);
  });

  it("defaults columnWidths to evenly split container width", () => {
    let s = stateWithText("text");
    s = reduceEditor(s, { type: "INSERT_TABLE", rows: 1, columns: 4 }, config);

    const table = s.state.children[1];
    // containerWidth = 200, 4 columns → 50px each
    expect(table.properties.columnWidths).toEqual([50, 50, 50, 50]);
  });

  it("supports undo", () => {
    let s = stateWithText("abcdef");
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "INSERT_TABLE", rows: 2, columns: 3 }, config);
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
    s = reduceEditor(s, { type: "INSERT_TABLE", rows: 1, columns: 2 }, config);

    // After deleting "bcd": "a" + table + "ef"
    expect(s.state.children).toHaveLength(3);
    expect(getTextAt(s, [0, 0])).toBe("a");
    expect(s.state.children[1].type).toBe("table");
    expect(getTextAt(s, [2, 0])).toBe("ef");
  });
});
