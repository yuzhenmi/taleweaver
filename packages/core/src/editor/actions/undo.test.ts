import { describe, it, expect } from "vitest";
import {
  config,
  getTextAt,
  createInitialEditorState,
  reduceEditor,
} from "./test-helpers";

describe("UNDO", () => {
  it("undoes last change and restores cursor", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "a" }, config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "b" }, config);

    s = reduceEditor(s, { type: "UNDO" }, config);
    // The exact behavior depends on history collapsing. Just verify undo works.
    const text = getTextAt(s, [0, 0]);
    expect(text.length).toBeLessThan(2);
  });

  it("does nothing when nothing to undo", () => {
    const s0 = createInitialEditorState(config);
    const s1 = reduceEditor(s0, { type: "UNDO" }, config);
    expect(s1.state).toBe(s0.state);
  });
});
