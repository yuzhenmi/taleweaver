import { describe, it, expect } from "vitest";
import {
  config,
  getTextAt,
  stateWithText,
  withSelection,
  reduceEditor,
  createPosition,
  createSelection,
  createCursor,
} from "./test-helpers";

describe("DELETE_LINE", () => {
  it("deletes from cursor to start of line", () => {
    let s = stateWithText("hello");
    // cursor at offset 3
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "DELETE_LINE" }, config);
    expect(getTextAt(s, [0, 0])).toBe("lo");
    expect(s.selection.focus.offset).toBe(0);
  });

  it("deletes expanded selection instead", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "DELETE_LINE" }, config);
    expect(getTextAt(s, [0, 0])).toBe("ho");
  });

  it("does nothing at start of line", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createCursor([0, 0], 0));
    const before = s.state;
    s = reduceEditor(s, { type: "DELETE_LINE" }, config);
    expect(s.state).toBe(before);
  });
});
