import { describe, it, expect } from "vitest";
import {
  config,
  stateWithText,
  stateWithTwoParagraphs,
  withSelection,
  createInitialEditorState,
  reduceEditor,
  createPosition,
  createSelection,
  isCollapsed,
  getTextContentLength,
} from "./test-helpers";

describe("MOVE_CURSOR", () => {
  it("moves forward", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "forward" }, config);
    expect(s.selection.focus.offset).toBe(3);
  });

  it("moves backward", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, config);
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    expect(s.selection.focus.offset).toBe(2);
  });

  it("collapses to end when moving forward with expanded selection", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "forward" }, config);
    expect(isCollapsed(s.selection)).toBe(true);
    expect(s.selection.focus.offset).toBe(4);
  });

  it("collapses to start when moving backward with expanded selection", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    expect(isCollapsed(s.selection)).toBe(true);
    expect(s.selection.focus.offset).toBe(1);
  });

  it("collapses from virtual EOL offset to textLength when moving forward", () => {
    let s = stateWithText("hello");
    // Selection with virtual EOL at focus (textLength + 1 = 6)
    s = withSelection(s, createSelection(
      createPosition([0, 0], 2),
      createPosition([0, 0], 6), // virtual EOL
    ));
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "forward" }, config);
    expect(isCollapsed(s.selection)).toBe(true);
    // Should clamp to textLength (5), not stay at 6
    expect(s.selection.focus.offset).toBe(5);
  });

  it("pressing right after selecting to EOL moves to next line", () => {
    let s = stateWithTwoParagraphs();
    // Select from offset 1 to end of first paragraph, then shift+right to EOL
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 3), // textLength of "abc"
    ));
    // Shift+Right expands to next line (no virtual EOL step)
    s = reduceEditor(s, { type: "EXPAND_SELECTION", direction: "forward" }, config);
    // Now press right arrow to collapse selection
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "forward" }, config);
    expect(isCollapsed(s.selection)).toBe(true);
    // Should be at the beginning of the second paragraph
    expect(s.selection.focus.path).toEqual([1, 0]);
    expect(s.selection.focus.offset).toBe(0);
  });

  it("collapses from virtual EOL offset to anchor when moving backward", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 2),
      createPosition([0, 0], 6), // virtual EOL
    ));
    s = reduceEditor(s, { type: "MOVE_CURSOR", direction: "backward" }, config);
    expect(isCollapsed(s.selection)).toBe(true);
    expect(s.selection.focus.offset).toBe(2); // anchor position
  });
});
