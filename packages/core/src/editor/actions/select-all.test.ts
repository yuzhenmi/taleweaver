import { describe, it, expect } from "vitest";
import {
  config,
  stateWithText,
  stateWithTwoParagraphs,
  reduceEditor,
  createInitialEditorState,
  isCollapsed,
} from "./test-helpers";

describe("SELECT_ALL", () => {
  it("selects all text in single paragraph with virtual line break", () => {
    let s = stateWithText("hello");
    s = reduceEditor(s, { type: "SELECT_ALL" }, config);
    expect(s.selection.anchor.offset).toBe(0);
    expect(s.selection.focus.path[0]).toBe(0);
    expect(s.selection.focus.offset).toBe(6); // textLength(5) + 1
    expect(isCollapsed(s.selection)).toBe(false);
  });

  it("selects all text across paragraphs with virtual line break", () => {
    let s = stateWithTwoParagraphs(); // "abc" + "def"
    s = reduceEditor(s, { type: "SELECT_ALL" }, config);
    expect(s.selection.anchor.path[0]).toBe(0);
    expect(s.selection.anchor.offset).toBe(0);
    expect(s.selection.focus.path[0]).toBe(1);
    expect(s.selection.focus.offset).toBe(4); // textLength(3) + 1
  });

  it("select-all in empty doc produces non-collapsed selection", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "SELECT_ALL" }, config);
    // Empty doc has textLength 0, so focus at 0+1=1
    expect(s.selection.anchor.offset).toBe(0);
    expect(s.selection.focus.offset).toBe(1);
    expect(isCollapsed(s.selection)).toBe(false);
  });

  it("does not modify document state", () => {
    let s = stateWithText("hello");
    const before = s.state;
    s = reduceEditor(s, { type: "SELECT_ALL" }, config);
    expect(s.state).toBe(before);
  });
});
