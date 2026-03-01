import { describe, it, expect } from "vitest";
import {
  config,
  stateWithText,
  withSelection,
  reduceEditor,
  createCursor,
} from "./test-helpers";

describe("EXPAND_WORD", () => {
  it("expands selection forward by one word", () => {
    let s = stateWithText("hello world");
    s = withSelection(s, createCursor([0, 0], 0));
    s = reduceEditor(s, { type: "EXPAND_WORD", direction: "forward" }, config);
    expect(s.selection.anchor.offset).toBe(0);
    expect(s.selection.focus.offset).toBe(5); // "hello"
  });

  it("expands selection backward by one word", () => {
    let s = stateWithText("hello world");
    // Cursor at end
    s = reduceEditor(s, { type: "EXPAND_WORD", direction: "backward" }, config);
    expect(s.selection.anchor.offset).toBe(11);
    expect(s.selection.focus.offset).toBe(6); // start of "world"
  });
});
