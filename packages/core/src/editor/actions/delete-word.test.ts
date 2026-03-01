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

describe("DELETE_WORD", () => {
  it("deletes word backward", () => {
    let s = stateWithText("hello world");
    // cursor at end
    s = reduceEditor(s, { type: "DELETE_WORD", direction: "backward" }, config);
    expect(getTextAt(s, [0, 0])).toBe("hello ");
  });

  it("deletes word forward", () => {
    let s = stateWithText("hello world");
    s = withSelection(s, createCursor([0, 0], 0));
    s = reduceEditor(s, { type: "DELETE_WORD", direction: "forward" }, config);
    expect(getTextAt(s, [0, 0])).toBe(" world");
  });

  it("deletes expanded selection instead of word", () => {
    let s = stateWithText("hello world");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "DELETE_WORD", direction: "backward" }, config);
    expect(getTextAt(s, [0, 0])).toBe("ho world");
  });
});
