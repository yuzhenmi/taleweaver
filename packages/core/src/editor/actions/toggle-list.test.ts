import { describe, it, expect } from "vitest";
import { getTextContent } from "@taleweaver/core";
import {
  config,
  getTextAt,
  stateWithText,
  withSelection,
  reduceEditor,
  createCursor,
} from "./test-helpers";

describe("TOGGLE_LIST", () => {
  it("wraps paragraph in a list", () => {
    let s = stateWithText("item");
    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "unordered" }, config);
    const firstChild = s.state.children[0];
    expect(firstChild.type).toBe("list");
    expect(firstChild.properties.listType).toBe("unordered");
    expect(firstChild.children).toHaveLength(1);
    expect(firstChild.children[0].type).toBe("list-item");
    // Content preserved
    expect(getTextContent(firstChild.children[0].children[0])).toBe("item");
  });

  it("adjusts selection path when wrapping in list", () => {
    let s = stateWithText("item");
    s = withSelection(s, createCursor([0, 0], 2));
    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "unordered" }, config);
    // Path should go from [0, 0] to [0, 0, 0]
    expect(s.selection.focus.path).toEqual([0, 0, 0]);
    expect(s.selection.focus.offset).toBe(2);
  });

  it("unwraps list back to paragraph", () => {
    let s = stateWithText("item");
    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "unordered" }, config);
    expect(s.state.children[0].type).toBe("list");
    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "unordered" }, config);
    expect(s.state.children[0].type).toBe("paragraph");
    expect(getTextAt(s, [0, 0])).toBe("item");
  });
});
