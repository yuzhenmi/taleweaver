import { describe, it, expect } from "vitest";
import {
  config,
  getTextAt,
  stateWithText,
  stateWithTwoParagraphs,
  withSelection,
  createInitialEditorState,
  reduceEditor,
  createCursor,
  createPosition,
  createSelection,
} from "./test-helpers";

describe("INSERT_BLOCK", () => {
  it("inserts a void block at cursor position (middle of text)", () => {
    let s = stateWithText("abcdef");
    // Cursor at offset 3
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);

    // Should have 3 doc children: para("abc"), HR, para("def")
    expect(s.state.children).toHaveLength(3);
    expect(s.state.children[0].type).toBe("paragraph");
    expect(getTextAt(s, [0, 0])).toBe("abc");
    expect(s.state.children[1].type).toBe("horizontal-line");
    expect(s.state.children[1].children).toHaveLength(0);
    expect(s.state.children[2].type).toBe("paragraph");
    expect(getTextAt(s, [2, 0])).toBe("def");
  });

  it("places cursor in the paragraph after the void block", () => {
    let s = stateWithText("abcdef");
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);

    expect(s.selection.focus.path).toEqual([2, 0]);
    expect(s.selection.focus.offset).toBe(0);
  });

  it("inserts at start of paragraph", () => {
    let s = stateWithText("abc");
    s = withSelection(s, createCursor([0, 0], 0));
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);

    // para(""), HR, para("abc")
    expect(s.state.children).toHaveLength(3);
    expect(getTextAt(s, [0, 0])).toBe("");
    expect(s.state.children[1].type).toBe("horizontal-line");
    expect(getTextAt(s, [2, 0])).toBe("abc");
  });

  it("inserts at end of paragraph", () => {
    let s = stateWithText("abc");
    // cursor at end, offset 3
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);

    // para("abc"), HR, para("")
    expect(s.state.children).toHaveLength(3);
    expect(getTextAt(s, [0, 0])).toBe("abc");
    expect(s.state.children[1].type).toBe("horizontal-line");
    expect(getTextAt(s, [2, 0])).toBe("");
  });

  it("inserts with properties (image)", () => {
    let s = stateWithText("text");
    s = withSelection(s, createCursor([0, 0], 2));
    s = reduceEditor(s, {
      type: "INSERT_BLOCK",
      blockType: "image",
      properties: { src: "data:image/png;base64,abc", width: 200, height: 100 },
    }, config);

    expect(s.state.children).toHaveLength(3);
    expect(s.state.children[1].type).toBe("image");
    expect(s.state.children[1].properties.src).toBe("data:image/png;base64,abc");
    expect(s.state.children[1].properties.width).toBe(200);
    expect(s.state.children[1].properties.height).toBe(100);
  });

  it("deletes expanded selection before inserting", () => {
    let s = stateWithText("abcdef");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);

    // After deleting "bcd": "a" + HR + "ef"
    expect(s.state.children).toHaveLength(3);
    expect(getTextAt(s, [0, 0])).toBe("a");
    expect(s.state.children[1].type).toBe("horizontal-line");
    expect(getTextAt(s, [2, 0])).toBe("ef");
  });

  it("supports undo", () => {
    let s = stateWithText("abcdef");
    s = withSelection(s, createCursor([0, 0], 3));
    const before = s.state;
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);
    s = reduceEditor(s, { type: "UNDO" }, config);

    expect(s.state.children).toHaveLength(1);
    expect(getTextAt(s, [0, 0])).toBe("abcdef");
  });

  it("inserts between two existing paragraphs", () => {
    let s = stateWithTwoParagraphs();
    // cursor at start of second paragraph
    s = withSelection(s, createCursor([1, 0], 0));
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);

    // para("abc"), para(""), HR, para("def")
    expect(s.state.children).toHaveLength(4);
    expect(getTextAt(s, [0, 0])).toBe("abc");
    expect(getTextAt(s, [1, 0])).toBe("");
    expect(s.state.children[2].type).toBe("horizontal-line");
    expect(getTextAt(s, [3, 0])).toBe("def");
  });

  it("replaces empty paragraph with void block and normalizes", () => {
    let s = createInitialEditorState(config);
    // Initial state is a single empty paragraph
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);

    // Normalizer inserts structural para before HR at doc start
    expect(s.state.children).toHaveLength(3);
    expect(s.state.children[0].type).toBe("paragraph");
    expect(s.state.children[1].type).toBe("horizontal-line");
    expect(s.state.children[2].type).toBe("paragraph");
    expect(getTextAt(s, [2, 0])).toBe("");
  });

  it("replaces empty paragraph between paragraphs", () => {
    // Build: ["abc", empty, "def"]
    let s = stateWithText("abc");
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "def" }, config);
    // Move cursor to the empty middle paragraph
    s = withSelection(s, createCursor([1, 0], 0));

    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);

    // para("abc"), HR, empty-para, para("def")
    expect(s.state.children).toHaveLength(4);
    expect(getTextAt(s, [0, 0])).toBe("abc");
    expect(s.state.children[1].type).toBe("horizontal-line");
    expect(s.state.children[2].type).toBe("paragraph");
    expect(getTextAt(s, [2, 0])).toBe("");
    expect(getTextAt(s, [3, 0])).toBe("def");
  });

  it("cursor goes to paragraph after void block on replace", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);

    // Cursor should be in the trailing empty paragraph (after normalization, HR is at index 1)
    expect(s.selection.focus.path).toEqual([2, 0]);
    expect(s.selection.focus.offset).toBe(0);
  });
});

describe("INSERT_BLOCK with createInitialState (table)", () => {
  it("inserts table with correct nested structure via INSERT_BLOCK", () => {
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

    expect(s.state.children[2].type).toBe("paragraph");
    expect(getTextAt(s, [2, 0])).toBe("def");
  });

  it("places cursor inside table (first cell text node)", () => {
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

    // After normalization, table is at index 1 (structural para at 0)
    expect(s.selection.focus.path).toEqual([1, 0, 0, 0, 0]);
    expect(s.selection.focus.offset).toBe(0);
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

  it("void block (no createInitialState) still works as before", () => {
    let s = stateWithText("text");
    s = withSelection(s, createCursor([0, 0], 2));
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);

    expect(s.state.children).toHaveLength(3);
    expect(s.state.children[1].type).toBe("horizontal-line");
    expect(s.state.children[1].children).toHaveLength(0);
    // Cursor after void block
    expect(s.selection.focus.path).toEqual([2, 0]);
  });
});

describe("INSERT_BLOCK normalization", () => {
  it("inserts structural paragraph between two adjacent HRs", () => {
    // Start with "text", insert HR at end → [para, HR, para("")]
    let s = stateWithText("text");
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);
    // Now cursor is at [2, 0] in the trailing empty para. Insert another HR.
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);

    // After normalization: para("text"), HR, para(""), HR, para("")
    // The two HRs must be separated by a paragraph
    const types = s.state.children.map(c => c.type);
    // Find all HR indices
    const hrIndices = types.reduce<number[]>((acc, t, i) => t === "horizontal-line" ? [...acc, i] : acc, []);
    expect(hrIndices.length).toBe(2);
    // Between the two HRs there must be a paragraph
    for (let i = 0; i < hrIndices.length - 1; i++) {
      const between = types.slice(hrIndices[i] + 1, hrIndices[i + 1]);
      expect(between).toContain("paragraph");
    }
  });

  it("inserts structural paragraph between table and HR", () => {
    let s = createInitialEditorState(config);
    // Insert table
    s = reduceEditor(s, {
      type: "INSERT_BLOCK",
      blockType: "table",
      properties: { rows: 1, columns: 2 },
    }, config);
    // Move cursor to trailing paragraph
    const lastIdx = s.state.children.length - 1;
    s = withSelection(s, createCursor([lastIdx, 0], 0));
    // Insert HR
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);

    // Table and HR should not be adjacent — paragraph must exist between
    const types = s.state.children.map(c => c.type);
    for (let i = 0; i < types.length - 1; i++) {
      if (types[i] === "table" || types[i] === "horizontal-line") {
        if (types[i + 1] === "table" || types[i + 1] === "horizontal-line") {
          throw new Error(`Adjacent opaque blocks at indices ${i} and ${i + 1}: ${types.join(", ")}`);
        }
      }
    }
  });

  it("cursor placed correctly after normalization", () => {
    // Insert HR from empty doc, then insert another HR
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_BLOCK", blockType: "horizontal-line" }, config);
    // Cursor should be valid
    expect(s.selection.focus.path.length).toBeGreaterThan(0);
    expect(s.selection.focus.offset).toBe(0);
  });
});
