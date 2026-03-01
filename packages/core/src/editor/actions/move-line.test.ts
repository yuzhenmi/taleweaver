import { describe, it, expect } from "vitest";
import {
  config,
  stateWithText,
  stateWithTwoParagraphs,
  withSelection,
  reduceEditor,
  createPosition,
  createSelection,
  createCursor,
  isCollapsed,
} from "./test-helpers";

describe("MOVE_LINE", () => {
  it("moves cursor down to next paragraph", () => {
    let s = stateWithTwoParagraphs();
    s = withSelection(s, createCursor([0, 0], 1));
    s = reduceEditor(s, { type: "MOVE_LINE", direction: "down" }, config);
    expect(s.selection.focus.path[0]).toBe(1);
    expect(isCollapsed(s.selection)).toBe(true);
  });

  it("moves cursor up to previous paragraph", () => {
    let s = stateWithTwoParagraphs();
    // cursor in second paragraph
    s = withSelection(s, createCursor([1, 0], 1));
    s = reduceEditor(s, { type: "MOVE_LINE", direction: "up" }, config);
    expect(s.selection.focus.path[0]).toBe(0);
    expect(isCollapsed(s.selection)).toBe(true);
  });

  it("moves to end of document when going down on last line", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createCursor([0, 0], 2));
    s = reduceEditor(s, { type: "MOVE_LINE", direction: "down" }, config);
    expect(s.selection.focus.offset).toBe(5); // end of "hello"
  });

  it("moves to start of document when going up on first line", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "MOVE_LINE", direction: "up" }, config);
    expect(s.selection.focus.offset).toBe(0);
  });

  it("collapses expanded selection when moving down", () => {
    let s = stateWithTwoParagraphs();
    s = withSelection(s, createSelection(
      createPosition([0, 0], 0),
      createPosition([0, 0], 2),
    ));
    s = reduceEditor(s, { type: "MOVE_LINE", direction: "down" }, config);
    expect(isCollapsed(s.selection)).toBe(true);
  });

  it("preserves targetX across consecutive vertical moves", () => {
    let s = stateWithTwoParagraphs();
    s = withSelection(s, createCursor([0, 0], 2));
    s = reduceEditor(s, { type: "MOVE_LINE", direction: "down" }, config);
    expect(s.targetX).not.toBeNull();
    const savedTargetX = s.targetX;
    s = reduceEditor(s, { type: "MOVE_LINE", direction: "up" }, config);
    // targetX should persist across vertical moves
    expect(s.targetX).toBe(savedTargetX);
  });

  it("clears targetX on non-vertical action", () => {
    let s = stateWithTwoParagraphs();
    s = withSelection(s, createCursor([0, 0], 2));
    s = reduceEditor(s, { type: "MOVE_LINE", direction: "down" }, config);
    expect(s.targetX).not.toBeNull();
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "forward" }, config);
    expect(s.targetX).toBeNull();
  });
});
