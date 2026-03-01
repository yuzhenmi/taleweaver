import { describe, it, expect } from "vitest";
import {
  config,
  stateWithText,
  withSelection,
  reduceEditor,
  createCursor,
} from "./test-helpers";

describe("EXPAND_LINE_BOUNDARY", () => {
  it("expands selection to start of line", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "EXPAND_LINE_BOUNDARY", boundary: "start" }, config);
    expect(s.selection.anchor.offset).toBe(3);
    expect(s.selection.focus.offset).toBe(0);
  });

  it("expands selection to end of line (no virtual EOL)", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createCursor([0, 0], 2));
    s = reduceEditor(s, { type: "EXPAND_LINE_BOUNDARY", boundary: "end" }, config);
    expect(s.selection.anchor.offset).toBe(2);
    expect(s.selection.focus.offset).toBe(5); // textLength, not virtual EOL
  });
});
