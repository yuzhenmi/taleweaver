import { describe, it, expect } from "vitest";
import {
  config,
  createInitialEditorState,
  reduceEditor,
} from "./test-helpers";

describe("SET_CONTAINER_WIDTH", () => {
  it("re-layouts with new width", () => {
    let s = createInitialEditorState(config);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "hello" }, config);
    const oldLayout = s.layoutTree;
    s = reduceEditor(s, { type: "SET_CONTAINER_WIDTH", width: 300 }, config);
    expect(s.containerWidth).toBe(300);
    expect(s.layoutTree).not.toBe(oldLayout);
  });
});
