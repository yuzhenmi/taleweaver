import { describe, it, expect } from "vitest";
import {
  config,
  getTextAt,
  stateWithText,
  withSelection,
  createInitialEditorState,
  reduceEditor,
  createPosition,
  createSelection,
} from "./test-helpers";

describe("INSERT_TEXT", () => {
  it("inserts a character and moves cursor", () => {
    const s0 = createInitialEditorState(config);
    const s1 = reduceEditor(s0, { type: "INSERT_TEXT", text: "a" }, config);
    expect(getTextAt(s1, [0, 0])).toBe("a");
    expect(s1.selection.focus.offset).toBe(1);
  });

  it("inserts multiple characters", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "hello" }, config);
    expect(getTextAt(s, [0, 0])).toBe("hello");
    expect(s.selection.focus.offset).toBe(5);
  });

  it("inserts at cursor position", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "ab" }, config);
    // Move cursor backward
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "X" }, config);
    expect(getTextAt(s, [0, 0])).toBe("aXb");
  });

  it("replaces selected text with typed character", () => {
    let s = stateWithText("hello");
    // Select "ell" (offset 1–4)
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "X" }, config);
    expect(getTextAt(s, [0, 0])).toBe("hXo");
    expect(s.selection.focus.offset).toBe(2);
  });

  it("replaces entire text when all selected", () => {
    let s = stateWithText("abc");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 0),
      createPosition([0, 0], 3),
    ));
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "Z" }, config);
    expect(getTextAt(s, [0, 0])).toBe("Z");
    expect(s.selection.focus.offset).toBe(1);
  });
});
