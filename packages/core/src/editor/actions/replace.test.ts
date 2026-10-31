import { finalSectionOf } from "../../test-utils/document-builders";
import { describe, it, expect } from "vitest";
import { config } from "./test-helpers";
import { createEditorStateFromDocument, createInitialEditorState, type EditorState } from "../editor-state";
import { reduceEditor } from "../reduce-editor";
import { getBlock, findMatches, createPosition, createSpan, type BlockId } from "../../state";
import { createDefaultAttrRegistry } from "../../cascade/attr-registry";
import { buildBlock, buildDocument, inlineContent, text } from "../../test-utils/document-builders";

/** Build a single-paragraph editor with `text` typed in. */
function withText(text: string): EditorState {
  let s = createInitialEditorState(config);
  s = reduceEditor(s, { type: "INSERT_TEXT", text });
  return s;
}

function firstParagraphId(editor: EditorState): BlockId {
  const root = getBlock(editor.document, finalSectionOf(editor.document)); // the root holds sections
  const id = root?.firstChildId;
  if (id === null || id === undefined) throw new Error("no first paragraph");
  return id;
}

function textOf(editor: EditorState, id: BlockId): string {
  const block = getBlock(editor.document, id);
  return (block?.inlineContent?.items ?? [])
    .map((it) => (it.kind === "text" ? it.text : "￼"))
    .join("");
}

describe("REPLACE_MATCH", () => {
  it("replaces one match and places the cursor at the seam", () => {
    let editor = withText("hello world hello");
    const p = firstParagraphId(editor);
    // Replace the FIRST "hello" [0,5) with "goodbye".
    editor = reduceEditor(
      editor,
      { type: "REPLACE_MATCH", match: { blockId: p, start: 0, end: 5 }, replacement: "goodbye" },
    );
    expect(textOf(editor, p)).toBe("goodbye world hello");
    // Cursor lands at start + replacement.length = 0 + 7.
    expect(editor.selection.anchor).toEqual({ blockId: p, offset: 7 });
    expect(editor.selection.focus).toEqual({ blockId: p, offset: 7 });
  });

  it("is ONE undo step that does not coalesce with prior typing", () => {
    const typed = withText("cat cat"); // one INSERT_TEXT undo step.
    const p = firstParagraphId(typed);

    let editor = reduceEditor(
      typed,
      { type: "REPLACE_MATCH", match: { blockId: p, start: 0, end: 3 }, replacement: "dog" },
    );
    expect(textOf(editor, p)).toBe("dog cat");

    // Undoing once restores the pre-replace text (the replace did NOT coalesce
    // into the typing entry — it is its own undo unit).
    editor = reduceEditor(editor, { type: "UNDO" });
    expect(textOf(editor, p)).toBe("cat cat");

    // The SECOND undo backs out the typing, then the stack is empty — so the
    // replace + typing were exactly TWO entries.
    expect(editor.history.canUndo()).toBe(true);
    editor = reduceEditor(editor, { type: "UNDO" });
    expect(textOf(editor, p)).toBe("");
    expect(editor.history.canUndo()).toBe(false);
  });
});

describe("REPLACE_ALL", () => {
  it("replaces ALL matches across N occurrences in ONE undo step", () => {
    const typed = withText("ab cd ab ef ab"); // one INSERT_TEXT undo step.
    const p = firstParagraphId(typed);

    const matches = findMatches(typed.document, "ab");
    expect(matches).toHaveLength(3);

    let editor = reduceEditor(typed, { type: "REPLACE_ALL", matches, replacement: "ZZ" });
    expect(textOf(editor, p)).toBe("ZZ cd ZZ ef ZZ");

    // ONE undo restores the pre-replace text in a single step (the whole
    // replace-all is exactly ONE undo entry, not three).
    editor = reduceEditor(editor, { type: "UNDO" });
    expect(textOf(editor, p)).toBe("ab cd ab ef ab");

    // The SECOND undo backs out the typing — then the stack is empty. So the
    // replace-all + typing were exactly TWO entries total (replace-all = 1).
    expect(editor.history.canUndo()).toBe(true);
    editor = reduceEditor(editor, { type: "UNDO" });
    expect(textOf(editor, p)).toBe("");
    expect(editor.history.canUndo()).toBe(false);
  });

  it("undo of REPLACE_ALL restores ALL blocks in one step", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "foo bar" });
    editor = reduceEditor(editor, { type: "SPLIT_NODE" });
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "bar baz" });

    const root = getBlock(editor.document, finalSectionOf(editor.document)); // the root holds sections
    const p1 = root?.firstChildId;
    const p2 = root?.lastChildId;
    if (p1 === null || p1 === undefined || p2 === null || p2 === undefined) {
      throw new Error("missing paragraphs");
    }

    const matches = findMatches(editor.document, "bar");
    expect(matches).toHaveLength(2); // one in each paragraph

    const afterReplace = reduceEditor(editor, { type: "REPLACE_ALL", matches, replacement: "QUX" });
    expect(textOf(afterReplace, p1)).toBe("foo QUX");
    expect(textOf(afterReplace, p2)).toBe("QUX baz");

    // ONE undo restores BOTH blocks.
    const undone = reduceEditor(afterReplace, { type: "UNDO" });
    expect(textOf(undone, p1)).toBe("foo bar");
    expect(textOf(undone, p2)).toBe("bar baz");

    // The cursor after REPLACE_ALL collapsed into the first affected block, at
    // the START offset of that block's first match. The first match in p1 is
    // "bar" in "foo bar" at offset 4 → the seam is offset 4 (handler contract:
    // collapse to first affected block's first replacement).
    expect(afterReplace.selection.anchor.blockId).toBe(p1);
    expect(afterReplace.selection.anchor.offset).toBe(4);
    expect(afterReplace.selection.anchor).toEqual(afterReplace.selection.focus);
  });

  it("empty matches → no-op (same state reference)", () => {
    const editor = withText("hello");
    const result = reduceEditor(editor, { type: "REPLACE_ALL", matches: [], replacement: "x" });
    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(result.document).toBe(editor.document);
  });
});

describe("REPLACE_ALL — canonical storage through the editor's attr registry", () => {
  it("writes the replacement with a registry-equal neighbour's stored value", () => {
    const attrRegistry = createDefaultAttrRegistry();
    attrRegistry.register({
      attrKey: "tag",
      toStyle: () => ({}),
      equals: (a, b) => typeof a === "object" && a !== null && typeof b === "object" && b !== null && "id" in a && "id" in b && a.id === b.id,
    });
    const cfg = { ...config, attrRegistry };
    // Registry-equal but deep-unequal neighbours (e.g. left by concurrent peers).
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("ab", { tag: { id: "t", v: 1 } }), text("X", { tag: { id: "t", v: 2 } })]),
        }),
      ],
    });
    const p = "p" as BlockId;
    let editor = createEditorStateFromDocument(document, createSpan(createPosition(p, 0), createPosition(p, 0)), cfg);
    editor = reduceEditor(editor, { type: "REPLACE_ALL", matches: findMatches(editor.document, "X"), replacement: "Y" });
    expect(getBlock(editor.document, p)?.inlineContent?.items).toEqual([text("abY", { tag: { id: "t", v: 1 } })]);
  });
});
