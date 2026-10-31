import { finalSectionOf } from "../../test-utils/document-builders";
import { describe, it, expect } from "vitest";
import {
  createEditor,
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
function firstTextItem(editor: ReturnType<typeof createEditor>): TextItem | null {
  const root = getBlock(editor.document, finalSectionOf(editor.document)); // the root holds sections
  if (root === null) return null;
  const pId = root.firstChildId;
  if (pId === null) return null;
  const p = getBlock(editor.document, pId);
  if (p === null || p.inlineContent === null) return null;
  const first = p.inlineContent.items[0];
  if (first === undefined || first.kind !== "text") return null;
  return first;
}

function selectAll(
  editor: ReturnType<typeof createEditor>,
  length: number,
): ReturnType<typeof createEditor> {
  const pId = (() => {
    const root = getBlock(editor.document, finalSectionOf(editor.document)); // the root holds sections
    if (root === null || root.firstChildId === null) throw new Error("no para");
    return root.firstChildId;
  })();
  editor.dispatch({
      type: "SET_SELECTION",
      selection: createSpan(createPosition(pId, 0), createPosition(pId, length)),
    });
    return editor;
}

describe("handleSetFontSize", () => {
  it("no-op on collapsed selection (no font size can target a single cursor)", () => {
    const config = makeConfig();
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "hello" });
    let editor = initial;
    const before = { ...editor };
    // Collapsed at end.
    editor.dispatch({ type: "SET_FONT_SIZE", size: 32 });
    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(editor.document).toBe(before.document);
  });

  it("sets fontSize attr on every text item in the selection", () => {
    const config = makeConfig();
    let editor = createEditor(config);
    editor.dispatch({ type: "INSERT_TEXT", text: "size me" });
    editor = selectAll(editor, 7);
    editor.dispatch({ type: "SET_FONT_SIZE", size: 32 });

    const item = firstTextItem(editor);
    expect(item).not.toBeNull();
    if (item === null) return;
    expect(item.text).toBe("size me");
    expect(item.attrs.fontSize).toBe(32);
  });

  it("clears fontSize attr when given null (size removed → inherit default)", () => {
    const config = makeConfig();
    let editor = createEditor(config);
    editor.dispatch({ type: "INSERT_TEXT", text: "size me" });
    editor = selectAll(editor, 7);
    editor.dispatch({ type: "SET_FONT_SIZE", size: 32 });
    expect(firstTextItem(editor)?.attrs.fontSize).toBe(32);
    editor.dispatch({ type: "SET_FONT_SIZE", size: null });
    expect(firstTextItem(editor)?.attrs.fontSize).toBeUndefined();
  });

  it("clears fontSize attr when given 0 (non-positive isn't a meaningful size)", () => {
    const config = makeConfig();
    let editor = createEditor(config);
    editor.dispatch({ type: "INSERT_TEXT", text: "size me" });
    editor = selectAll(editor, 7);
    editor.dispatch({ type: "SET_FONT_SIZE", size: 32 });
    expect(firstTextItem(editor)?.attrs.fontSize).toBe(32);
    editor.dispatch({ type: "SET_FONT_SIZE", size: 0 });
    expect(firstTextItem(editor)?.attrs.fontSize).toBeUndefined();
  });

  it("clears fontSize attr when given a negative size (non-positive isn't meaningful)", () => {
    const config = makeConfig();
    let editor = createEditor(config);
    editor.dispatch({ type: "INSERT_TEXT", text: "size me" });
    editor = selectAll(editor, 7);
    editor.dispatch({ type: "SET_FONT_SIZE", size: 32 });
    expect(firstTextItem(editor)?.attrs.fontSize).toBe(32);
    editor.dispatch({ type: "SET_FONT_SIZE", size: -10 });
    expect(firstTextItem(editor)?.attrs.fontSize).toBeUndefined();
  });

  it("undo restores the pre-size state", () => {
    const config = makeConfig();
    let editor = createEditor(config);
    editor.dispatch({ type: "INSERT_TEXT", text: "size me" });
    editor = selectAll(editor, 7);
    editor.dispatch({ type: "SET_FONT_SIZE", size: 32 });
    expect(firstTextItem(editor)?.attrs.fontSize).toBe(32);

    editor.dispatch({ type: "UNDO" });
    expect(firstTextItem(editor)?.attrs.fontSize).toBeUndefined();

    editor.dispatch({ type: "REDO" });
    expect(firstTextItem(editor)?.attrs.fontSize).toBe(32);
  });
});
