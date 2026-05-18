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
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(s.state).toBe(before);
  });

  it("merges with next paragraph at paragraph boundary", () => {
    let s = stateWithTwoParagraphs();
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

  it("still allows forward delete on non-structural empty paragraph", () => {
    let s = stateWithText("abc");
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "def" }, config);
    s = withSelection(s, createCursor([1, 0], 0));
    s = reduceEditor(s, { type: "DELETE_FORWARD" }, config);
    expect(s.state.children).toHaveLength(2);
  });
});

// TODO Plan 2 — void block and table DELETE_FORWARD tests removed (INSERT_BLOCK not in Plan 1)
