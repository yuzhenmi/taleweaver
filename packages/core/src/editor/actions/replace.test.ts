import { describe, it, expect } from "vitest";
import { config } from "./test-helpers";
import {
  createInitialEditorState,
  reduceEditor,
  type EditorState,
} from "../editor-state";
import { getBlock, findMatches, type BlockId } from "../../state";

/** Build a single-paragraph editor with `text` typed in. */
function withText(text: string): EditorState {
  let s = createInitialEditorState(config);
  s = reduceEditor(s, { type: "INSERT_TEXT", text }, config);
  return s;
}

function firstParagraphId(editor: EditorState): BlockId {
  const root = getBlock(editor.state, editor.state.rootId);
  const id = root?.firstChildId;
  if (id === null || id === undefined) throw new Error("no first paragraph");
  return id;
}

function textOf(editor: EditorState, id: BlockId): string {
  const block = getBlock(editor.state, id);
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
      config,
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
      config,
    );
    expect(textOf(editor, p)).toBe("dog cat");

    // Undoing once restores the pre-replace text (the replace did NOT coalesce
    // into the typing entry — it is its own undo unit).
    editor = reduceEditor(editor, { type: "UNDO" }, config);
    expect(textOf(editor, p)).toBe("cat cat");

    // The SECOND undo backs out the typing, then the stack is empty — so the
    // replace + typing were exactly TWO entries.
    expect(editor.history.canUndo()).toBe(true);
    editor = reduceEditor(editor, { type: "UNDO" }, config);
    expect(textOf(editor, p)).toBe("");
    expect(editor.history.canUndo()).toBe(false);
  });
});

describe("REPLACE_ALL", () => {
  it("replaces ALL matches across N occurrences in ONE undo step", () => {
    const typed = withText("ab cd ab ef ab"); // one INSERT_TEXT undo step.
    const p = firstParagraphId(typed);

    const matches = findMatches(typed.state, "ab");
    expect(matches).toHaveLength(3);

    let editor = reduceEditor(typed, { type: "REPLACE_ALL", matches, replacement: "ZZ" }, config);
    expect(textOf(editor, p)).toBe("ZZ cd ZZ ef ZZ");

    // ONE undo restores the pre-replace text in a single step (the whole
    // replace-all is exactly ONE undo entry, not three).
    editor = reduceEditor(editor, { type: "UNDO" }, config);
    expect(textOf(editor, p)).toBe("ab cd ab ef ab");

    // The SECOND undo backs out the typing — then the stack is empty. So the
    // replace-all + typing were exactly TWO entries total (replace-all = 1).
    expect(editor.history.canUndo()).toBe(true);
    editor = reduceEditor(editor, { type: "UNDO" }, config);
    expect(textOf(editor, p)).toBe("");
    expect(editor.history.canUndo()).toBe(false);
  });

  it("undo of REPLACE_ALL restores ALL blocks in one step", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "foo bar" }, config);
    editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "bar baz" }, config);

    const root = getBlock(editor.state, editor.state.rootId);
    const p1 = root?.firstChildId;
    const p2 = root?.lastChildId;
    if (p1 === null || p1 === undefined || p2 === null || p2 === undefined) {
      throw new Error("missing paragraphs");
    }

    const matches = findMatches(editor.state, "bar");
    expect(matches).toHaveLength(2); // one in each paragraph

    const afterReplace = reduceEditor(editor, { type: "REPLACE_ALL", matches, replacement: "QUX" }, config);
    expect(textOf(afterReplace, p1)).toBe("foo QUX");
    expect(textOf(afterReplace, p2)).toBe("QUX baz");

    // ONE undo restores BOTH blocks.
    const undone = reduceEditor(afterReplace, { type: "UNDO" }, config);
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
    const result = reduceEditor(editor, { type: "REPLACE_ALL", matches: [], replacement: "x" }, config);
    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(result.state).toBe(editor.state);
  });
});
