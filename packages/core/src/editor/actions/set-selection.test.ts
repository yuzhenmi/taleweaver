import { describe, it, expect } from "vitest";
import {
  config,
  stateWithText,
  reduceEditor,
  createPosition,
  createSelection,
  createCursor,
  isCollapsed,
} from "./test-helpers";

describe("SET_SELECTION", () => {
  it("sets selection to a specific collapsed cursor", () => {
    let s = stateWithText("hello");
    const sel = createCursor([0, 0], 2);
    s = reduceEditor(s, { type: "SET_SELECTION", selection: sel }, config);
    expect(s.selection.focus.offset).toBe(2);
    expect(s.selection.anchor.offset).toBe(2);
  });

  it("sets an expanded (non-collapsed) selection", () => {
    let s = stateWithText("hello");
    const sel = createSelection(
      createPosition([0, 0], 1),
      createPosition([0, 0], 4),
    );
    s = reduceEditor(s, { type: "SET_SELECTION", selection: sel }, config);
    expect(s.selection.anchor.offset).toBe(1);
    expect(s.selection.focus.offset).toBe(4);
    expect(isCollapsed(s.selection)).toBe(false);
  });

  it("does not modify document state", () => {
    let s = stateWithText("hello");
    const stateBefore = s.state;
    s = reduceEditor(
      s,
      { type: "SET_SELECTION", selection: createCursor([0, 0], 3) },
      config,
    );
    expect(s.state).toBe(stateBefore);
  });
});
