import { describe, it, expect } from "vitest";
import {
  config,
  createInitialEditorState,
  reduceEditor,
} from "./test-helpers";

describe("MOVE_WORD", () => {
  it("moves by word forward", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "hello world" }, config);
    // Move cursor to start
    for (let i = 0; i < 11; i++) {
      s = reduceEditor(
        s,
        { type: "MOVE_CURSOR", direction: "backward" },
        config,
      );
    }
    s = reduceEditor(s, { type: "MOVE_WORD", direction: "forward" }, config);
    expect(s.selection.focus.offset).toBe(5); // after "hello"
  });
});
