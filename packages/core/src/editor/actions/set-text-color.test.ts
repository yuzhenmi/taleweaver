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

describe("handleSetTextColor", () => {
  it("no-op on collapsed selection (no color can target a single cursor)", () => {
    const config = makeConfig();
    const initial = createInitialEditorState(config);
    let editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hello" }, config);
    const before = editor;
    // Collapsed at end.
    editor = reduceEditor(editor, { type: "SET_TEXT_COLOR", color: "#ff0000" }, config);
    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(editor.state).toBe(before.state);
  });

  it("sets color attr on every text item in the selection", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "color me" }, config);
    editor = selectAll(editor, 8, config);
    editor = reduceEditor(editor, { type: "SET_TEXT_COLOR", color: "#ff0000" }, config);

    const item = firstTextItem(editor);
    expect(item).not.toBeNull();
    if (item === null) return;
    expect(item.text).toBe("color me");
    expect(item.attrs.color).toBe("#ff0000");
  });

  it("clears color attr when given null (color removed)", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "color me" }, config);
    editor = selectAll(editor, 8, config);
    editor = reduceEditor(editor, { type: "SET_TEXT_COLOR", color: "#ff0000" }, config);
    expect(firstTextItem(editor)?.attrs.color).toBe("#ff0000");
    editor = reduceEditor(editor, { type: "SET_TEXT_COLOR", color: null }, config);
    expect(firstTextItem(editor)?.attrs.color).toBeUndefined();
  });

  it("clears color attr when given empty string (empty isn't a meaningful color)", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "color me" }, config);
    editor = selectAll(editor, 8, config);
    editor = reduceEditor(editor, { type: "SET_TEXT_COLOR", color: "#ff0000" }, config);
    expect(firstTextItem(editor)?.attrs.color).toBe("#ff0000");
    editor = reduceEditor(editor, { type: "SET_TEXT_COLOR", color: "" }, config);
    expect(firstTextItem(editor)?.attrs.color).toBeUndefined();
  });

  it("undo restores the pre-color state", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "color me" }, config);
    editor = selectAll(editor, 8, config);
    editor = reduceEditor(editor, { type: "SET_TEXT_COLOR", color: "#ff0000" }, config);
    expect(firstTextItem(editor)?.attrs.color).toBe("#ff0000");

    editor = reduceEditor(editor, { type: "UNDO" }, config);
    expect(firstTextItem(editor)?.attrs.color).toBeUndefined();

    editor = reduceEditor(editor, { type: "REDO" }, config);
    expect(firstTextItem(editor)?.attrs.color).toBe("#ff0000");
  });
});

describe("handleSetTextTransform", () => {
  it("no-op on collapsed selection (no transform can target a single cursor)", () => {
    const config = makeConfig();
    const initial = createInitialEditorState(config);
    let editor = reduceEditor(initial, { type: "INSERT_TEXT", text: "hello" }, config);
    const before = editor;
    editor = reduceEditor(editor, { type: "SET_TEXT_TRANSFORM", value: "uppercase" }, config);
    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(editor.state).toBe(before.state);
  });

  it("sets textTransform attr on every text item in the selection", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "shout me" }, config);
    editor = selectAll(editor, 8, config);
    editor = reduceEditor(editor, { type: "SET_TEXT_TRANSFORM", value: "uppercase" }, config);

    const item = firstTextItem(editor);
    expect(item).not.toBeNull();
    if (item === null) return;
    expect(item.text).toBe("shout me");
    expect(item.attrs.textTransform).toBe("uppercase");
  });

  it("sets textTransform 'none' by REMOVING the attr (none is the initial value; removal lets runs re-merge)", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "shout me" }, config);
    editor = selectAll(editor, 8, config);
    editor = reduceEditor(editor, { type: "SET_TEXT_TRANSFORM", value: "uppercase" }, config);
    expect(firstTextItem(editor)?.attrs.textTransform).toBe("uppercase");
    editor = reduceEditor(editor, { type: "SET_TEXT_TRANSFORM", value: "none" }, config);
    // "none" removes the attr entirely (mirrors how color clears to default) so
    // the run carries no textTransform key and can re-merge with untransformed
    // neighbours — it does NOT persist an explicit { textTransform: "none" }.
    expect(firstTextItem(editor)?.attrs.textTransform).toBeUndefined();
  });

  it("CLEAR_FORMATTING removes textTransform (it is in INLINE_FORMAT_ATTR_KEYS)", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "shout me" }, config);
    editor = selectAll(editor, 8, config);
    editor = reduceEditor(editor, { type: "SET_TEXT_TRANSFORM", value: "uppercase" }, config);
    expect(firstTextItem(editor)?.attrs.textTransform).toBe("uppercase");
    editor = reduceEditor(editor, { type: "CLEAR_FORMATTING" }, config);
    expect(firstTextItem(editor)?.attrs.textTransform).toBeUndefined();
  });

  it("undo restores the pre-transform state", () => {
    const config = makeConfig();
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "shout me" }, config);
    editor = selectAll(editor, 8, config);
    editor = reduceEditor(editor, { type: "SET_TEXT_TRANSFORM", value: "uppercase" }, config);
    expect(firstTextItem(editor)?.attrs.textTransform).toBe("uppercase");

    editor = reduceEditor(editor, { type: "UNDO" }, config);
    expect(firstTextItem(editor)?.attrs.textTransform).toBeUndefined();

    editor = reduceEditor(editor, { type: "REDO" }, config);
    expect(firstTextItem(editor)?.attrs.textTransform).toBe("uppercase");
  });
});
