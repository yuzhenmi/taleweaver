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
});
