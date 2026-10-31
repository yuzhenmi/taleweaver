/**
 * `INSERT_LINE_BREAK` — the soft line break (Shift+Enter). Word's
 * `\v` / Google Docs's `\u000b`: an INLINE `hard-break` embed inside the paragraph —
 * one offset, no new ¶, no new paragraph attrs. A suggesting Shift+Enter is an inline
 * insertion revision; copy gives "\n".
 */
import { describe, it, expect } from "vitest";
import { config, createEditor, firstChildId, bodyBlockIds, createPosition, createSpan, type Editor } from "./test-helpers";
import { getBlock, extractText, builtinEmbedSerializer, getSuggestions, HARD_BREAK_EMBED_TYPE, INSERTION_SUGGESTION_ATTR } from "../../state";
import type { BlockId } from "../../state";

function typed(text: string, offset: number): { editor: Editor; p: BlockId } {
  let editor = createEditor(config);
  editor.dispatch({ type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 2 } });
  editor.dispatch({ type: "INSERT_TEXT", text });
  const p = firstChildId(editor.document) as BlockId;
  const at = createPosition(p, offset);
  editor.dispatch({ type: "SET_SELECTION", selection: createSpan(at, at) });
  return { editor, p };
}

describe("INSERT_LINE_BREAK", () => {
  it("inserts a hard-break embed at the caret: no new paragraph, attrs unchanged, caret after it", () => {
    const { editor, p } = typed("abcd", 2);
    editor.dispatch({ type: "INSERT_LINE_BREAK" });
    expect(bodyBlockIds(editor.document)).toEqual([p]);
    const block = getBlock(editor.document, p);
    expect(block?.type).toBe("heading");
    expect(block?.attrs).toEqual({ level: 2 });
    const items = block?.inlineContent?.items ?? [];
    expect(items.map((i) => (i.kind === "text" ? i.text : i.embedType))).toEqual(["ab", HARD_BREAK_EMBED_TYPE, "cd"]);
    expect(editor.selection.focus).toEqual({ blockId: p, offset: 3 });
    // Copy gives "\n" for the break.
    expect(extractText(editor.document, createSpan(createPosition(p, 0), createPosition(p, 5)), builtinEmbedSerializer)).toBe("ab\ncd");
  });

  it("replaces a selection (one undo step)", () => {
    const { editor, p } = typed("abcd", 1);
    editor.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(p, 1), createPosition(p, 3)) });
    editor.dispatch({ type: "INSERT_LINE_BREAK" });
    const items = getBlock(editor.document, p)?.inlineContent?.items ?? [];
    expect(items.map((i) => (i.kind === "text" ? i.text : i.embedType))).toEqual(["a", HARD_BREAK_EMBED_TYPE, "d"]);
    expect(editor.selection.focus).toEqual({ blockId: p, offset: 2 });
    editor.dispatch({ type: "UNDO" });
    expect(getBlock(editor.document, p)?.inlineContent?.items.map((i) => (i.kind === "text" ? i.text : "")).join("")).toBe("abcd");
  });

    it("in suggesting mode the break is an inline insertion revision (view, accept / reject, own Backspace)", () => {
    const suggesting = { ...config, suggestingAuthor: "alice" };
    const { editor, p } = typed("abcd", 2);
    editor.config = suggesting;
    editor.dispatch({ type: "INSERT_LINE_BREAK" });
    expect(bodyBlockIds(editor.document)).toEqual([p]);
    const brk = (getBlock(editor.document, p)?.inlineContent?.items ?? []).find((i) => i.kind === "embed");
    const id = brk?.attrs[INSERTION_SUGGESTION_ATTR];
    expect(typeof id).toBe("string");
    expect(getSuggestions(editor.document).some((s) => s.id === id && s.kind === "insertion" && s.author === "alice")).toBe(true);
    expect(editor.selection.focus).toEqual({ blockId: p, offset: 3 });
    // "original" hides the break; reject drops it, accept keeps it untracked.
    expect(extractText(editor.document, createSpan(createPosition(p, 0), createPosition(p, 5)), builtinEmbedSerializer, "original")).toBe("abcd");
    const kinds = (e: Editor): string[] => (getBlock(e.document, firstChildId(e.document) as BlockId)?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : i.embedType));
    editor.dispatch({ type: "REJECT_ALL_SUGGESTIONS" });
    expect(kinds(editor)).toEqual(["abcd"]);
    // (Each case on a fresh document: ops write the shared Y.Doc.)
    const again = typed("abcd", 2).editor;
    again.config = suggesting;
    again.dispatch({ type: "INSERT_LINE_BREAK" });
    again.dispatch({ type: "ACCEPT_ALL_SUGGESTIONS" });
    expect(kinds(again)).toEqual(["ab", HARD_BREAK_EMBED_TYPE, "cd"]);
    expect(getSuggestions(again.document)).toHaveLength(0);
    // Backspace over the author's own pending break removes it for real.
    const own = typed("abcd", 2).editor;
    own.config = suggesting;
    own.dispatch({ type: "INSERT_LINE_BREAK" });
    own.dispatch({ type: "DELETE_BACKWARD" });
    expect(kinds(own)).toEqual(["abcd"]);
  });

  it("in suggesting mode over a selection: the break is inserted and the selection struck, one undo step", () => {
    const suggesting = { ...config, suggestingAuthor: "alice" };
    const { editor, p } = typed("abcd", 1);
    editor.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(p, 1), createPosition(p, 3)) });
    editor.config = suggesting;
    editor.dispatch({ type: "INSERT_LINE_BREAK" });
    expect(getSuggestions(editor.document).map((s) => s.kind).sort()).toEqual(["deletion", "insertion"]);
    expect(extractText(editor.document, createSpan(createPosition(p, 0), createPosition(p, 5)), builtinEmbedSerializer, "final")).toBe("a\nd");
    expect(editor.selection.focus).toEqual({ blockId: p, offset: 2 });
    editor.dispatch({ type: "UNDO" });
    expect(getSuggestions(editor.document)).toHaveLength(0);
  });
});
