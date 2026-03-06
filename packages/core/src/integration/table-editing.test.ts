import { describe, it, expect } from "vitest";
import { registry, measurer } from "./setup";
import {
  createInitialEditorState,
  reduceEditor,
  type EditorConfig,
  type EditorState,
} from "../editor/editor-state";
import {
  createCursor,
  createSelection,
  createPosition,
  getNodeByPath,
  getTextContent,
} from "../index";

const config: EditorConfig = { measurer, registry, containerWidth: 600 };

function insertTable(s: EditorState, rows = 2, columns = 3): EditorState {
  return reduceEditor(s, {
    type: "INSERT_BLOCK",
    blockType: "table",
    properties: { rows, columns },
  }, config);
}

function withSelection(
  s: EditorState,
  sel: ReturnType<typeof createCursor>,
): EditorState {
  return reduceEditor(s, { type: "SET_SELECTION", selection: sel }, config);
}

/** Find the index of the table in the document children. */
function tableIdx(s: EditorState): number {
  return s.state.children.findIndex(c => c.type === "table");
}

describe("Table editing integration", () => {
  it("INSERT_BLOCK table creates correct state/render/layout tree structure", () => {
    let s = createInitialEditorState(config);
    s = insertTable(s);

    // Normalizer inserts structural para before table
    expect(s.state.children).toHaveLength(3);
    const ti = tableIdx(s);
    expect(ti).toBe(1);
    const table = s.state.children[ti];
    expect(table.type).toBe("table");
    expect(table.children).toHaveLength(2); // 2 rows

    // Each row has 3 cells
    for (const row of table.children) {
      expect(row.type).toBe("table-row");
      expect(row.children).toHaveLength(3);
      for (const cell of row.children) {
        expect(cell.type).toBe("table-cell");
        expect(cell.children).toHaveLength(1); // 1 paragraph
        expect(cell.children[0].type).toBe("paragraph");
        expect(cell.children[0].children).toHaveLength(1); // 1 text node
        expect(cell.children[0].children[0].type).toBe("text");
      }
    }

    // Render tree should have a table node
    const renderDoc = s.renderTree;
    expect(renderDoc.type).toBe("block");
    const renderTable = renderDoc.children[ti];
    expect(renderTable.type).toBe("table");

    // Layout tree should have a table box
    const layoutDoc = s.layoutTree;
    const layoutTable = layoutDoc.children[ti];
    expect(layoutTable.type).toBe("table");
  });

  it("type text in a cell and verify content", () => {
    let s = createInitialEditorState(config);
    s = insertTable(s);
    const ti = tableIdx(s);
    // Cursor should be in first cell
    expect(s.selection.focus.path).toEqual([ti, 0, 0, 0, 0]);

    s = reduceEditor(s, { type: "INSERT_TEXT", text: "Hello" }, config);
    const textNode = getNodeByPath(s.state, [ti, 0, 0, 0, 0]);
    expect(textNode).toBeDefined();
    expect(getTextContent(textNode!)).toBe("Hello");
  });

  it("Enter in cell creates new paragraph within cell", () => {
    let s = createInitialEditorState(config);
    s = insertTable(s);
    const ti = tableIdx(s);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);

    const cell = s.state.children[ti].children[0].children[0];
    expect(cell.children).toHaveLength(2);
    expect(cell.children[0].type).toBe("paragraph");
    expect(cell.children[1].type).toBe("paragraph");
    // Cursor in new paragraph
    expect(s.selection.focus.path).toEqual([ti, 0, 0, 1, 0]);
  });

  it("backspace at cell start does nothing", () => {
    let s = createInitialEditorState(config);
    s = insertTable(s);
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, config);
    expect(s.state).toBe(before);
  });

  it("forward-delete at cell end does nothing", () => {
    let s = createInitialEditorState(config);
    s = insertTable(s);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    // cursor at end of first cell
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(s.state).toBe(before);
  });

  it("arrow key navigation between cells", () => {
    let s = createInitialEditorState(config);
    s = insertTable(s);
    const ti = tableIdx(s);
    // Cursor at first cell [ti, 0, 0, 0, 0]
    // Move forward should traverse to second cell
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "forward" }, config);
    // Should be at second cell's text: [ti, 0, 1, 0, 0]
    expect(s.selection.focus.path).toEqual([ti, 0, 1, 0, 0]);
    expect(s.selection.focus.offset).toBe(0);
  });

  it("undo after table insertion restores pre-table state", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "hello" }, config);
    s = insertTable(s);
    expect(s.state.children.length).toBeGreaterThan(1);

    s = reduceEditor(s, { type: "UNDO" }, config);
    expect(s.state.children).toHaveLength(1);
    expect(getTextContent(s.state.children[0].children[0])).toBe("hello");
  });

  it("layout: cells positioned horizontally, rows stacked vertically", () => {
    let s = createInitialEditorState(config);
    s = insertTable(s, 2, 2);
    const ti = tableIdx(s);

    const gridBox = s.layoutTree.children[ti];
    expect(gridBox.type).toBe("table");
    if (gridBox.type !== "table") return;

    // Two rows
    expect(gridBox.children).toHaveLength(2);

    const row0 = gridBox.children[0];
    const row1 = gridBox.children[1];

    // Row 0 cells positioned horizontally
    expect(row0.children[0].x).toBe(0);
    expect(row0.children[1].x).toBe(row0.children[0].width);

    // Row 1 stacked below row 0
    expect(row1.y).toBe(row0.height);
  });

  it("auto row height adjusts to content", () => {
    let s = createInitialEditorState(config);
    s = insertTable(s, 1, 2);
    const ti = tableIdx(s);
    // Type in first cell to make it have content
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "text" }, config);

    const gridBox = s.layoutTree.children[ti];
    expect(gridBox.type).toBe("table");
    if (gridBox.type !== "table") return;

    // Row height should be at least the cell content height
    expect(gridBox.rowHeights[0]).toBeGreaterThan(0);
  });
});
