import { describe, it, expect } from "vitest";
import {
  config,
  stateWithText,
  withSelection,
  reduceEditor,
  createCursor,
  isCollapsed,
} from "./test-helpers";

describe("MOVE_LINE_BOUNDARY", () => {
  it("moves to start of line", () => {
    let s = stateWithText("hello");
    // cursor at offset 3
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "MOVE_LINE_BOUNDARY", boundary: "start" }, config);
    expect(s.selection.focus.offset).toBe(0);
    expect(isCollapsed(s.selection)).toBe(true);
  });

  it("moves to end of line", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createCursor([0, 0], 2));
    s = reduceEditor(s, { type: "MOVE_LINE_BOUNDARY", boundary: "end" }, config);
    expect(s.selection.focus.offset).toBe(5);
    expect(isCollapsed(s.selection)).toBe(true);
  });
});
