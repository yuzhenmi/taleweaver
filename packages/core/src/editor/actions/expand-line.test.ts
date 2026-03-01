import { describe, it, expect } from "vitest";
import {
  config,
  stateWithTwoParagraphs,
  withSelection,
  reduceEditor,
  createCursor,
  isCollapsed,
} from "./test-helpers";

describe("EXPAND_LINE", () => {
  it("expands selection down to next line", () => {
    let s = stateWithTwoParagraphs();
    s = withSelection(s, createCursor([0, 0], 1));
    s = reduceEditor(s, { type: "EXPAND_LINE", direction: "down" }, config);
    expect(s.selection.anchor.path).toEqual([0, 0]);
    expect(s.selection.anchor.offset).toBe(1);
    expect(s.selection.focus.path[0]).toBe(1);
    expect(isCollapsed(s.selection)).toBe(false);
  });

  it("expands selection up to previous line", () => {
    let s = stateWithTwoParagraphs();
    s = withSelection(s, createCursor([1, 0], 2));
    s = reduceEditor(s, { type: "EXPAND_LINE", direction: "up" }, config);
    expect(s.selection.anchor.path).toEqual([1, 0]);
    expect(s.selection.anchor.offset).toBe(2);
    expect(s.selection.focus.path[0]).toBe(0);
  });
});
