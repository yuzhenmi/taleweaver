import { describe, it, expect } from "vitest";
import { coalesceKeyOf } from "./coalesce-key";
import type { EditorAction } from "./editor-action";
import { createSpan, createPosition } from "../state";
import type { BlockId } from "../state";

const SAMPLE_SPAN = createSpan(
  createPosition("b" as BlockId, 0),
  createPosition("b" as BlockId, 0),
);

describe("coalesceKeyOf", () => {
  it("classifies text editing", () => {
    expect(coalesceKeyOf({ type: "INSERT_TEXT", text: "a" })).toBe("insert");
    expect(coalesceKeyOf({ type: "DELETE_BACKWARD" })).toBe("delete");
    expect(coalesceKeyOf({ type: "DELETE_FORWARD" })).toBe("delete");
    expect(coalesceKeyOf({ type: "DELETE_WORD", direction: "backward" })).toBe("delete");
    expect(coalesceKeyOf({ type: "DELETE_RANGE", span: SAMPLE_SPAN })).toBe("delete");
  });

  it("classifies discrete commands", () => {
    const commands: EditorAction[] = [
      { type: "SPLIT_NODE" },
      { type: "PASTE", text: "x" },
      { type: "TOGGLE_STYLE", style: "bold" },
      { type: "SET_LINK", url: "https://example.com" },
      { type: "SET_TEXT_COLOR", color: "#111111" },
      { type: "SET_HIGHLIGHT", color: "#ff0" },
      { type: "SET_FONT_SIZE", size: 14 },
      { type: "SET_FONT_FAMILY", family: "Serif" },
      { type: "CLEAR_FORMATTING" },
      { type: "INDENT" },
      { type: "OUTDENT" },
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } },
      { type: "TOGGLE_LIST", listType: "ordered" },
      { type: "INSERT_NODE", node: { type: "paragraph" } },
      { type: "SECTION_BREAK" },
      { type: "TOGGLE_SECTION_LANDSCAPE" },
      { type: "INSERT_HEADER" },
      { type: "INSERT_FOOTER" },
      { type: "INSERT_FOOTNOTE" },
      { type: "SET_FOOTNOTE_POLICY", reset: "restart-per-page" },
      { type: "SET_LINE_SPACING", spacing: 1.5 },
      { type: "SET_PARAGRAPH_SPACING", edge: "before", value: 8 },
      { type: "SET_TEXT_ALIGN", align: "center" },
    ];
    for (const a of commands) expect(coalesceKeyOf(a)).toBe("command");
  });

  it("classifies selection-break actions", () => {
    // Phase 0b: the geometric MOVE_CURSOR/MOVE_LINE/EXPAND_* nav actions moved to
    // the backend NavIntent resolver, which dispatches SET_SELECTION — so the
    // remaining geometry-free selection-break actions are what core classifies.
    expect(coalesceKeyOf({ type: "MOVE_WORD", direction: "backward" })).toBe("selection-break");
    expect(coalesceKeyOf({ type: "MOVE_DOCUMENT_BOUNDARY", boundary: "end" })).toBe("selection-break");
    expect(coalesceKeyOf({ type: "SET_SELECTION", selection: SAMPLE_SPAN })).toBe("selection-break");
    expect(coalesceKeyOf({ type: "EXPAND_WORD", direction: "backward" })).toBe("selection-break");
    expect(coalesceKeyOf({ type: "EXPAND_DOCUMENT_BOUNDARY", boundary: "start" })).toBe("selection-break");
    expect(coalesceKeyOf({ type: "SELECT_ALL" })).toBe("selection-break");
    expect(coalesceKeyOf({ type: "UNDO" })).toBe("selection-break");
    expect(coalesceKeyOf({ type: "REDO" })).toBe("selection-break");
  });

  it("classifies inert actions", () => {
    expect(coalesceKeyOf({ type: "SET_CONTAINER_WIDTH", width: 800 })).toBe("inert");
  });
});
