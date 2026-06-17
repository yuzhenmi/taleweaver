import { describe, it, expect } from "vitest";
import {
  createInitialEditorState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  getBlock,
  createPosition,
  createSpan,
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

/** First text item from the doc's first (and only) paragraph. */
function firstTextItem(editor: ReturnType<typeof createInitialEditorState>): TextItem | null {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null) return null;
  const pId = root.firstChildId;
  if (pId === null) return null;
  const p = getBlock(editor.state, pId);
  if (p === null || p.inlineContent === null) return null;
  const first = p.inlineContent.items[0];
  if (first === undefined || first.kind !== "text") return null;
  return first;
}

function selectAll(
  editor: ReturnType<typeof createInitialEditorState>,
  length: number,
  config: EditorConfig,
): ReturnType<typeof createInitialEditorState> {
  const pId = (() => {
    const root = getBlock(editor.state, editor.state.rootId);
    if (root === null || root.firstChildId === null) throw new Error("no para");
    return root.firstChildId;
  })();
  return reduceEditor(
    editor,
    {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(pId, 0), createPosition(pId, length)),
    },
    config,
  );
}

describe("handleSetFontFamily", () => {
  it("no-op on collapsed selection (no font family can target a single cursor)", () => {
    const config = makeConfig();
    const initial = createInitialEditorState(config);
    let editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hello" }, config);
    const before = editor;
    // Collapsed at end.
    editor = reduceEditor(editor, { type: "SET_FONT_FAMILY", family: "Courier New" }, config);
    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(editor.state).toBe(before.state);
  });

  it("sets fontFamily attr on every text item in the selection", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "font me" }, config);
    editor = selectAll(editor, 7, config);
    editor = reduceEditor(editor, { type: "SET_FONT_FAMILY", family: "Courier New" }, config);

    const item = firstTextItem(editor);
    expect(item).not.toBeNull();
    if (item === null) return;
    expect(item.text).toBe("font me");
    expect(item.attrs.fontFamily).toBe("Courier New");
  });

  it("clears fontFamily attr when given null (family removed → inherit default)", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "font me" }, config);
    editor = selectAll(editor, 7, config);
    editor = reduceEditor(editor, { type: "SET_FONT_FAMILY", family: "Courier New" }, config);
    expect(firstTextItem(editor)?.attrs.fontFamily).toBe("Courier New");
    editor = reduceEditor(editor, { type: "SET_FONT_FAMILY", family: null }, config);
    expect(firstTextItem(editor)?.attrs.fontFamily).toBeUndefined();
  });

  it("clears fontFamily attr when given empty string (empty isn't a meaningful family)", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "font me" }, config);
    editor = selectAll(editor, 7, config);
    editor = reduceEditor(editor, { type: "SET_FONT_FAMILY", family: "Courier New" }, config);
    expect(firstTextItem(editor)?.attrs.fontFamily).toBe("Courier New");
    editor = reduceEditor(editor, { type: "SET_FONT_FAMILY", family: "" }, config);
    expect(firstTextItem(editor)?.attrs.fontFamily).toBeUndefined();
  });

  it("undo restores the pre-family state", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "font me" }, config);
    editor = selectAll(editor, 7, config);
    editor = reduceEditor(editor, { type: "SET_FONT_FAMILY", family: "Courier New" }, config);
    expect(firstTextItem(editor)?.attrs.fontFamily).toBe("Courier New");

    editor = reduceEditor(editor, { type: "UNDO" }, config);
    expect(firstTextItem(editor)?.attrs.fontFamily).toBeUndefined();

    editor = reduceEditor(editor, { type: "REDO" }, config);
    expect(firstTextItem(editor)?.attrs.fontFamily).toBe("Courier New");
  });
});
