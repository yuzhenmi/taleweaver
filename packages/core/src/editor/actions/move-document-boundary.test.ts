import { describe, it, expect } from "vitest";
import {
  config,
  stateWithTwoParagraphs,
  withSelection,
  reduceEditor,
  createCursor,
  isCollapsed,
} from "./test-helpers";

describe("MOVE_DOCUMENT_BOUNDARY", () => {
  it("moves to start of document", () => {
    let s = stateWithTwoParagraphs();
    // cursor at end of second paragraph
    s = reduceEditor(s, { type: "MOVE_DOCUMENT_BOUNDARY", boundary: "start" }, config);
    expect(s.selection.focus.path[0]).toBe(0);
    expect(s.selection.focus.offset).toBe(0);
    expect(isCollapsed(s.selection)).toBe(true);
  });

  it("moves to end of document", () => {
    let s = stateWithTwoParagraphs();
    s = withSelection(s, createCursor([0, 0], 0));
    s = reduceEditor(s, { type: "MOVE_DOCUMENT_BOUNDARY", boundary: "end" }, config);
    expect(s.selection.focus.path[0]).toBe(1);
    expect(s.selection.focus.offset).toBe(3);
    expect(isCollapsed(s.selection)).toBe(true);
  });
});
