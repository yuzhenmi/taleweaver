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

describe("handleSetHighlight", () => {
  it("no-op on collapsed selection (no highlight can target a single cursor)", () => {
    const config = makeConfig();
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "hello" });
    let editor = initial;
    const before = editor;
    // Collapsed at end.
    editor.dispatch({ type: "SET_HIGHLIGHT", color: "#ffff00" });
    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(editor.document).toBe(before.document);
  });

  it("sets backgroundColor attr on every text item in the selection", () => {
    const config = makeConfig();
    let editor = createEditor(config);
    editor.dispatch({ type: "INSERT_TEXT", text: "mark me" });
    editor = selectAll(editor, 7);
    editor.dispatch({ type: "SET_HIGHLIGHT", color: "#ffff00" });

    const item = firstTextItem(editor);
    expect(item).not.toBeNull();
    if (item === null) return;
    expect(item.text).toBe("mark me");
    expect(item.attrs.backgroundColor).toBe("#ffff00");
  });

  it("clears backgroundColor attr when given null (highlight removed)", () => {
    const config = makeConfig();
    let editor = createEditor(config);
    editor.dispatch({ type: "INSERT_TEXT", text: "mark me" });
    editor = selectAll(editor, 7);
    editor.dispatch({ type: "SET_HIGHLIGHT", color: "#ffff00" });
    expect(firstTextItem(editor)?.attrs.backgroundColor).toBe("#ffff00");
    editor.dispatch({ type: "SET_HIGHLIGHT", color: null });
    expect(firstTextItem(editor)?.attrs.backgroundColor).toBeUndefined();
  });

  it("clears backgroundColor attr when given empty string (empty isn't a meaningful color)", () => {
    const config = makeConfig();
    let editor = createEditor(config);
    editor.dispatch({ type: "INSERT_TEXT", text: "mark me" });
    editor = selectAll(editor, 7);
    editor.dispatch({ type: "SET_HIGHLIGHT", color: "#ffff00" });
    expect(firstTextItem(editor)?.attrs.backgroundColor).toBe("#ffff00");
    editor.dispatch({ type: "SET_HIGHLIGHT", color: "" });
    expect(firstTextItem(editor)?.attrs.backgroundColor).toBeUndefined();
  });

  it("undo restores the pre-highlight state", () => {
    const config = makeConfig();
    let editor = createEditor(config);
    editor.dispatch({ type: "INSERT_TEXT", text: "mark me" });
    editor = selectAll(editor, 7);
    editor.dispatch({ type: "SET_HIGHLIGHT", color: "#ffff00" });
    expect(firstTextItem(editor)?.attrs.backgroundColor).toBe("#ffff00");

    editor.dispatch({ type: "UNDO" });
    expect(firstTextItem(editor)?.attrs.backgroundColor).toBeUndefined();

    editor.dispatch({ type: "REDO" });
    expect(firstTextItem(editor)?.attrs.backgroundColor).toBe("#ffff00");
  });
});
