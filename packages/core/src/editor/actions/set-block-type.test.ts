import { describe, it, expect } from "vitest";
import {
  config,
  getTextAt,
  stateWithText,
  withSelection,
  reduceEditor,
  createCursor,
} from "./test-helpers";

describe("SET_BLOCK_TYPE", () => {
  it("converts paragraph to heading", () => {
    let s = stateWithText("Title");
    s = reduceEditor(
      s,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } },
      config,
    );
    expect(s.state.children[0].type).toBe("heading");
    expect(s.state.children[0].properties.level).toBe(1);
    // Content should be preserved
    expect(getTextAt(s, [0, 0])).toBe("Title");
  });

  it("toggles heading back to paragraph", () => {
    let s = stateWithText("Title");
    s = reduceEditor(
      s,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } },
      config,
    );
    expect(s.state.children[0].type).toBe("heading");
    s = reduceEditor(
      s,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } },
      config,
    );
    expect(s.state.children[0].type).toBe("paragraph");
  });

  it("preserves selection after block type change", () => {
    let s = stateWithText("Title");
    s = withSelection(s, createCursor([0, 0], 3));
    s = reduceEditor(
      s,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 2 } },
      config,
    );
    expect(s.selection.focus.offset).toBe(3);
  });

  it("is undoable", () => {
    let s = stateWithText("Title");
    s = reduceEditor(
      s,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } },
      config,
    );
    s = reduceEditor(s, { type: "UNDO" }, config);
    expect(s.state.children[0].type).toBe("paragraph");
  });
});
