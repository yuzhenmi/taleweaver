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
  createCursor,
} from "./test-helpers";

describe("PASTE", () => {
  it("pastes single-line text at cursor", () => {
    let s = stateWithText("ab");
    s = withSelection(s, createCursor([0, 0], 1));
    s = reduceEditor(s, { type: "PASTE", text: "XY" }, config);
    expect(getTextAt(s, [0, 0])).toBe("aXYb");
    expect(s.selection.focus.offset).toBe(3);
  });

  it("pastes multi-line text creating new paragraphs", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "PASTE", text: "line1\nline2\nline3" }, config);
    expect(s.stateLegacy.children).toHaveLength(3);
    expect(getTextAt(s, [0, 0])).toBe("line1");
    expect(getTextAt(s, [1, 0])).toBe("line2");
    expect(getTextAt(s, [2, 0])).toBe("line3");
  });

  it("replaces expanded selection when pasting", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "PASTE", text: "XY" }, config);
    expect(getTextAt(s, [0, 0])).toBe("hXYo");
  });

  it("does nothing for empty paste", () => {
    let s = stateWithText("hello");
    const before = s.state;
    s = reduceEditor(s, { type: "PASTE", text: "" }, config);
    expect(s.state).toBe(before);
  });

  it("pastes text with trailing newline", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "PASTE", text: "hello\n" }, config);
    expect(s.stateLegacy.children).toHaveLength(2);
    expect(getTextAt(s, [0, 0])).toBe("hello");
    expect(getTextAt(s, [1, 0])).toBe("");
  });

  it("undoes paste-over-selection in a single undo step", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "PASTE", text: "XY" }, config);
    expect(getTextAt(s, [0, 0])).toBe("hXYo");
    // Single undo should restore the original text and selection
    s = reduceEditor(s, { type: "UNDO" }, config);
    expect(getTextAt(s, [0, 0])).toBe("hello");
  });

  it("undoes multi-line paste in a single undo step", () => {
    let s = stateWithText("ab");
    s = withSelection(s, createCursor([0, 0], 1));
    s = reduceEditor(s, { type: "PASTE", text: "X\nY\nZ" }, config);
    expect(s.stateLegacy.children).toHaveLength(3);
    // Single undo should collapse back to one paragraph
    s = reduceEditor(s, { type: "UNDO" }, config);
    expect(s.stateLegacy.children).toHaveLength(1);
    expect(getTextAt(s, [0, 0])).toBe("ab");
  });

  it("consecutive multi-line pastes produce correct text and cursor", () => {
    let s = createInitialEditorState(config);

    // Paste 1: three lines into empty document
    s = reduceEditor(s, { type: "PASTE", text: "aaa\nbbb\nccc" }, config);
    expect(s.stateLegacy.children).toHaveLength(3);
    expect(getTextAt(s, [0, 0])).toBe("aaa");
    expect(getTextAt(s, [1, 0])).toBe("bbb");
    expect(getTextAt(s, [2, 0])).toBe("ccc");
    expect(s.selection.focus.path).toEqual([2, 0]);
    expect(s.selection.focus.offset).toBe(3);

    // Paste 2: two lines at current cursor (end of "ccc")
    s = reduceEditor(s, { type: "PASTE", text: "ddd\neee" }, config);
    expect(s.stateLegacy.children).toHaveLength(4);
    expect(getTextAt(s, [0, 0])).toBe("aaa");
    expect(getTextAt(s, [1, 0])).toBe("bbb");
    expect(getTextAt(s, [2, 0])).toBe("cccddd");
    expect(getTextAt(s, [3, 0])).toBe("eee");
    expect(s.selection.focus.path).toEqual([3, 0]);
    expect(s.selection.focus.offset).toBe(3);

    // Paste 3: single line at current cursor (end of "eee")
    s = reduceEditor(s, { type: "PASTE", text: "fff" }, config);
    expect(getTextAt(s, [3, 0])).toBe("eeefff");
    expect(s.selection.focus.offset).toBe(6);
  });

  it("consecutive pastes into middle of existing text", () => {
    let s = stateWithText("abcdef");
    s = withSelection(s, createCursor([0, 0], 3)); // cursor after "abc"

    // Paste 1: split "abcdef" → "abcX", "Ydef"
    s = reduceEditor(s, { type: "PASTE", text: "X\nY" }, config);
    expect(s.stateLegacy.children).toHaveLength(2);
    expect(getTextAt(s, [0, 0])).toBe("abcX");
    expect(getTextAt(s, [1, 0])).toBe("Ydef");
    expect(s.selection.focus.path).toEqual([1, 0]);
    expect(s.selection.focus.offset).toBe(1);

    // Paste 2: at cursor inside "Ydef" → "YM", "Ndef"
    s = reduceEditor(s, { type: "PASTE", text: "M\nN" }, config);
    expect(s.stateLegacy.children).toHaveLength(3);
    expect(getTextAt(s, [0, 0])).toBe("abcX");
    expect(getTextAt(s, [1, 0])).toBe("YM");
    expect(getTextAt(s, [2, 0])).toBe("Ndef");
    expect(s.selection.focus.path).toEqual([2, 0]);
    expect(s.selection.focus.offset).toBe(1);
  });

  // TODO Plan 2 — incremental layout test removed (layoutTreeIncremental not in Plan 1)

  it("strips carriage returns from pasted text", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "PASTE", text: "line1\r\nline2\r\nline3" }, config);
    expect(s.stateLegacy.children).toHaveLength(3);
    expect(getTextAt(s, [0, 0])).toBe("line1");
    expect(getTextAt(s, [1, 0])).toBe("line2");
    expect(getTextAt(s, [2, 0])).toBe("line3");
  });

  it("undoes consecutive pastes independently", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "PASTE", text: "aaa\nbbb" }, config);

    // After paste 1: 2 paragraphs, cursor at end of "bbb"
    expect(s.stateLegacy.children).toHaveLength(2);
    expect(getTextAt(s, [0, 0])).toBe("aaa");
    expect(getTextAt(s, [1, 0])).toBe("bbb");
    expect(s.selection.focus.path).toEqual([1, 0]);
    expect(s.selection.focus.offset).toBe(3);
    expect(s.historyLegacy.undoStack).toHaveLength(1);

    s = reduceEditor(s, { type: "PASTE", text: "ccc\nddd" }, config);

    // After paste 2: should have 4 paragraphs (bbb + ccc on same line, then ddd)
    // aaa, bbbccc, ddd — wait that's only 3. Let me check...
    // Cursor is at [1,0]:3. Paste "ccc\nddd":
    // Insert "ccc" at [1,0]:3 → "bbbccc", cursor at [1,0]:6
    // Split at [1,0]:6 → "bbbccc" and "", cursor at [2,0]:0
    // Insert "ddd" at [2,0]:0 → "ddd", cursor at [2,0]:3
    // So: aaa, bbbccc, ddd — 3 paragraphs is correct!
    expect(s.stateLegacy.children).toHaveLength(3);
    expect(getTextAt(s, [0, 0])).toBe("aaa");
    expect(getTextAt(s, [1, 0])).toBe("bbbccc");
    expect(getTextAt(s, [2, 0])).toBe("ddd");
    expect(s.historyLegacy.undoStack).toHaveLength(2);

    // Undo paste 2
    s = reduceEditor(s, { type: "UNDO" }, config);
    expect(s.stateLegacy.children).toHaveLength(2);
    expect(getTextAt(s, [0, 0])).toBe("aaa");
    expect(getTextAt(s, [1, 0])).toBe("bbb");

    // Undo paste 1
    s = reduceEditor(s, { type: "UNDO" }, config);
    expect(s.stateLegacy.children).toHaveLength(1);
    expect(getTextAt(s, [0, 0])).toBe("");
  });
});
