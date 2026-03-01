import { describe, it, expect } from "vitest";
import { getTextContent } from "@taleweaver/core";
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
