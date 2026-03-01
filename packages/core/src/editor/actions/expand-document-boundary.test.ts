import { describe, it, expect } from "vitest";
import {
  config,
  stateWithTwoParagraphs,
  withSelection,
  reduceEditor,
  createCursor,
} from "./test-helpers";

describe("EXPAND_DOCUMENT_BOUNDARY", () => {
  it("expands selection to start of document", () => {
    let s = stateWithTwoParagraphs();
    // cursor at end of second paragraph
    s = reduceEditor(s, { type: "EXPAND_DOCUMENT_BOUNDARY", boundary: "start" }, config);
    expect(s.selection.anchor.path).toEqual([1, 0]);
    expect(s.selection.anchor.offset).toBe(3);
    expect(s.selection.focus.path[0]).toBe(0);
    expect(s.selection.focus.offset).toBe(0);
  });

  it("expands selection to end of document with virtual EOL", () => {
    let s = stateWithTwoParagraphs();
    s = withSelection(s, createCursor([0, 0], 1));
    s = reduceEditor(s, { type: "EXPAND_DOCUMENT_BOUNDARY", boundary: "end" }, config);
    expect(s.selection.anchor.offset).toBe(1);
    expect(s.selection.focus.path[0]).toBe(1);
    expect(s.selection.focus.offset).toBe(4); // textLength(3) + 1
  });
});
