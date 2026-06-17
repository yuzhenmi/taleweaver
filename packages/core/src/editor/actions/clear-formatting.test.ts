import { describe, it, expect } from "vitest";
import {
  createInitialEditorState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  getBlock,
  createPosition,
  createSpan,
  INLINE_FORMAT_ATTR_KEYS,
  type EditorConfig,
} from "../../index";
import type { TextItem } from "../../state";

function makeConfig(): EditorConfig {
  return {
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry: createDefaultAttrRegistry(),
    containerWidth: 800,
  };
}

/** All text items from the doc's first (and only) paragraph. */
function textItems(
  editor: ReturnType<typeof createInitialEditorState>,
): TextItem[] {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null || root.firstChildId === null) return [];
  const p = getBlock(editor.state, root.firstChildId);
  if (p === null || p.inlineContent === null) return [];
  return p.inlineContent.items.filter(
    (i): i is TextItem => i.kind === "text",
  );
}

function selectAll(
  editor: ReturnType<typeof createInitialEditorState>,
  length: number,
  config: EditorConfig,
): ReturnType<typeof createInitialEditorState> {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null || root.firstChildId === null) throw new Error("no para");
  const pId = root.firstChildId;
  return reduceEditor(
    editor,
    {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(pId, 0), createPosition(pId, length)),
    },
    config,
  );
}

describe("handleClearFormatting", () => {
  it("removes every inline-format attr from each text item in the selection", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "format me" }, config);
    // Apply a spread of inline formats: bold + color + font size.
    editor = selectAll(editor, 9, config);
    editor = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" }, config);
    editor = selectAll(editor, 9, config);
    editor = reduceEditor(editor, { type: "SET_TEXT_COLOR", color: "#ff0000" }, config);
    editor = selectAll(editor, 9, config);
    editor = reduceEditor(editor, { type: "SET_FONT_SIZE", size: 24 }, config);

    // Sanity: the formats actually landed.
    const before = textItems(editor);
    expect(before.length).toBeGreaterThan(0);
    expect(before.some((i) => i.attrs.bold === true)).toBe(true);
    expect(before.some((i) => i.attrs.color === "#ff0000")).toBe(true);
    expect(before.some((i) => i.attrs.fontSize === 24)).toBe(true);

    editor = selectAll(editor, 9, config);
    editor = reduceEditor(editor, { type: "CLEAR_FORMATTING" }, config);

    const after = textItems(editor);
    // The text content survives untouched.
    expect(after.map((i) => i.text).join("")).toBe("format me");
    // Every inline-format attr is gone from every text item.
    for (const item of after) {
      for (const key of INLINE_FORMAT_ATTR_KEYS) {
        expect(item.attrs[key]).toBeUndefined();
      }
    }
  });

  it("no-ops on an already-clean selection (returns the same editor ref)", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "plain text" }, config);
    editor = selectAll(editor, 10, config);
    const before = editor;
    editor = reduceEditor(editor, { type: "CLEAR_FORMATTING" }, config);
    // State-equality short-circuit: nothing to clear → same editor object.
    expect(editor).toBe(before);
  });

  it("no-ops on a collapsed selection (same state reference)", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "hello" }, config);
    const before = editor;
    // Collapsed at end of insert.
    editor = reduceEditor(editor, { type: "CLEAR_FORMATTING" }, config);
    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(editor.state).toBe(before.state);
  });

  it("undo restores all the cleared formatting in one step", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "format me" }, config);
    editor = selectAll(editor, 9, config);
    editor = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" }, config);
    editor = selectAll(editor, 9, config);
    editor = reduceEditor(editor, { type: "SET_TEXT_COLOR", color: "#ff0000" }, config);
    editor = selectAll(editor, 9, config);
    editor = reduceEditor(editor, { type: "SET_FONT_SIZE", size: 24 }, config);

    editor = selectAll(editor, 9, config);
    editor = reduceEditor(editor, { type: "CLEAR_FORMATTING" }, config);
    // Cleared.
    for (const item of textItems(editor)) {
      for (const key of INLINE_FORMAT_ATTR_KEYS) {
        expect(item.attrs[key]).toBeUndefined();
      }
    }

    // A single undo brings every format back at once.
    editor = reduceEditor(editor, { type: "UNDO" }, config);
    const restored = textItems(editor);
    expect(restored.some((i) => i.attrs.bold === true)).toBe(true);
    expect(restored.some((i) => i.attrs.color === "#ff0000")).toBe(true);
    expect(restored.some((i) => i.attrs.fontSize === 24)).toBe(true);
  });
});
