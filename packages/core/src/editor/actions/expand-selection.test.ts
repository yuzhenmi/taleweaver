import { describe, it, expect } from "vitest";
import {
  config,
  stateWithText,
  stateWithTwoParagraphs,
  withSelection,
  reduceEditor,
  createCursor,
  createSelection,
  createPosition,
  isCollapsed,
} from "./test-helpers";

describe("EXPAND_SELECTION", () => {
  it("expands selection forward by one character", () => {
    let s = stateWithText("hello");
    // Put cursor at offset 1
    s = withSelection(s, createCursor([0, 0], 1));
    s = reduceEditor(s, { type: "EXPAND_SELECTION", direction: "forward" }, config);
    expect(s.selection.anchor.offset).toBe(1);
    expect(s.selection.focus.offset).toBe(2);
    expect(isCollapsed(s.selection)).toBe(false);
  });

  it("expands selection backward by one character", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(s, { type: "EXPAND_SELECTION", direction: "backward" }, config);
    expect(s.selection.anchor.offset).toBe(3);
    expect(s.selection.focus.offset).toBe(2);
  });

  it("can expand multiple times to grow selection", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createCursor([0, 0], 1));
    s = reduceEditor(s, { type: "EXPAND_SELECTION", direction: "forward" }, config);
    s = reduceEditor(s, { type: "EXPAND_SELECTION", direction: "forward" }, config);
    s = reduceEditor(s, { type: "EXPAND_SELECTION", direction: "forward" }, config);
    expect(s.selection.anchor.offset).toBe(1);
    expect(s.selection.focus.offset).toBe(4);
  });

  it("Shift+Left from EOL deselects only the indicator", () => {
    // Two paragraphs: "abc" and "def"
    let s = stateWithTwoParagraphs();
    // Select from offset 1 to virtual EOL (textLength+1 = 4) on first paragraph
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4), // virtual EOL for "abc" (length 3)
    ));
    // Shift+Left should deselect just the EOL → focus goes to 3 (textLength)
    s = reduceEditor(s, { type: "EXPAND_SELECTION", direction: "backward" }, config);
    expect(s.selection.anchor.offset).toBe(1);
    expect(s.selection.focus.offset).toBe(3);
  });

  it("expand forward from textLength stops at virtual EOL before crossing paragraph", () => {
    let s = stateWithTwoParagraphs();
    // Select from offset 0 to textLength (3) on first paragraph
    s = withSelection(s, createSelection(
      createPosition([0, 0], 0),
      createPosition([0, 0], 3),
    ));
    // Shift+Right should stop at virtual EOL (4), not cross to next paragraph
    s = reduceEditor(s, { type: "EXPAND_SELECTION", direction: "forward" }, config);
    expect(s.selection.focus.path).toEqual([0, 0]);
    expect(s.selection.focus.offset).toBe(4); // virtual EOL
  });
});
