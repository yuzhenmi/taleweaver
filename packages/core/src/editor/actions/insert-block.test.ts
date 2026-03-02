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
});
