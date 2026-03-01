import { describe, it, expect } from "vitest";
import {
  config,
  getTextAt,
  createInitialEditorState,
  reduceEditor,
} from "./test-helpers";

describe("REDO", () => {
  it("redo restores undone change", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "x" }, config);
    s = reduceEditor(s, { type: "UNDO" }, config);
    s = reduceEditor(s, { type: "REDO" }, config);
    expect(getTextAt(s, [0, 0])).toBe("x");
  });

  it("does nothing when nothing to redo", () => {
    const s0 = createInitialEditorState(config);
    const s1 = reduceEditor(s0, { type: "REDO" }, config);
    expect(s1.state).toBe(s0.state);
  });
});
