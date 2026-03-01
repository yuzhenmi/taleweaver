import { describe, it, expect } from "vitest";
import {
  config,
  stateWithText,
  withSelection,
  reduceEditor,
  createPosition,
  createSelection,
} from "./test-helpers";

describe("TOGGLE_STYLE", () => {
  it("does nothing with collapsed selection", () => {
    let s = stateWithText("hello");
    const before = s.state;
    s = reduceEditor(s, { type: "TOGGLE_STYLE", style: "bold" }, config);
    expect(s.state).toBe(before);
  });

  it("applies bold style to selected text", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    ));
    s = reduceEditor(s, { type: "TOGGLE_STYLE", style: "bold" }, config);
    // The paragraph should now contain a span with fontWeight: "bold"
    const para = s.state.children[0];
    const hasSpanWithBold = para.children.some(
      (child) => child.type === "span" && child.styles.fontWeight === "bold",
    );
    expect(hasSpanWithBold).toBe(true);
  });

  it("applies italic style to selected text", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    ));
    s = reduceEditor(s, { type: "TOGGLE_STYLE", style: "italic" }, config);
    const para = s.state.children[0];
    const hasSpanWithItalic = para.children.some(
      (child) => child.type === "span" && child.styles.fontStyle === "italic",
    );
    expect(hasSpanWithItalic).toBe(true);
  });

  it("applies underline style to selected text", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    ));
    s = reduceEditor(s, { type: "TOGGLE_STYLE", style: "underline" }, config);
    const para = s.state.children[0];
    const hasSpanWithUnderline = para.children.some(
      (child) => child.type === "span" && child.styles.textDecoration === "underline",
    );
    expect(hasSpanWithUnderline).toBe(true);
  });

  it("is undoable", () => {
    let s = stateWithText("hello");
    s = withSelection(s, createSelection(
      createPosition([0, 0], 0),
      createPosition([0, 0], 5),
    ));
    s = reduceEditor(s, { type: "TOGGLE_STYLE", style: "bold" }, config);
    expect(s.history.undoStack.length).toBeGreaterThan(0);
    s = reduceEditor(s, { type: "UNDO" }, config);
    // After undo, should be plain text again
    const para = s.state.children[0];
    expect(para.children).toHaveLength(1);
    expect(para.children[0].type).toBe("text");
  });
});
