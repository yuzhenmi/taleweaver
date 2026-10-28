/**
 * `INSERT_LINE_BREAK` — the soft line break (Shift+Enter). Word's
 * `\v` / Google Docs's `\u000b`: an INLINE `hard-break` embed inside the paragraph —
 * one offset, no new ¶, no new paragraph attrs. A suggesting Shift+Enter is an inline
 * insertion revision; copy gives "\n".
 */
import { describe, it, expect } from "vitest";
import { config, reduceEditor, createInitialEditorState, firstChildId, bodyBlockIds, createPosition, createSpan, type EditorState } from "./test-helpers";
import { getBlock, extractText, builtinEmbedSerializer, getSuggestions, HARD_BREAK_EMBED_TYPE, INSERTION_SUGGESTION_ATTR } from "../../state";
import type { BlockId } from "../../state";

function typed(text: string, offset: number): { editor: EditorState; p: BlockId } {
  let editor = createInitialEditorState(config);
  editor = reduceEditor(editor, { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 2 } }, config);
  editor = reduceEditor(editor, { type: "INSERT_TEXT", text }, config);
  const p = firstChildId(editor.state) as BlockId;
  const at = createPosition(p, offset);
  return { editor: reduceEditor(editor, { type: "SET_SELECTION", selection: createSpan(at, at) }, config), p };
}

describe("INSERT_LINE_BREAK", () => {
  it("inserts a hard-break embed at the caret: no new paragraph, attrs unchanged, caret after it", () => {
    const { editor, p } = typed("abcd", 2);
    const next = reduceEditor(editor, { type: "INSERT_LINE_BREAK" }, config);
    expect(bodyBlockIds(next.state)).toEqual([p]);
    const block = getBlock(next.state, p);
    expect(block?.type).toBe("heading");
    expect(block?.attrs).toEqual({ level: 2 });
    const items = block?.inlineContent?.items ?? [];
    expect(items.map((i) => (i.kind === "text" ? i.text : i.embedType))).toEqual(["ab", HARD_BREAK_EMBED_TYPE, "cd"]);
    expect(next.selection.focus).toEqual({ blockId: p, offset: 3 });
    // Copy gives "\n" for the break.
    expect(extractText(next.state, createSpan(createPosition(p, 0), createPosition(p, 5)), builtinEmbedSerializer)).toBe("ab\ncd");
  });

  it("replaces a selection (one undo step)", () => {
    const { editor, p } = typed("abcd", 1);
    const sel = reduceEditor(editor, { type: "SET_SELECTION", selection: createSpan(createPosition(p, 1), createPosition(p, 3)) }, config);
    const next = reduceEditor(sel, { type: "INSERT_LINE_BREAK" }, config);
    const items = getBlock(next.state, p)?.inlineContent?.items ?? [];
    expect(items.map((i) => (i.kind === "text" ? i.text : i.embedType))).toEqual(["a", HARD_BREAK_EMBED_TYPE, "d"]);
    expect(next.selection.focus).toEqual({ blockId: p, offset: 2 });
    const undone = reduceEditor(next, { type: "UNDO" }, config);
    expect(getBlock(undone.state, p)?.inlineContent?.items.map((i) => (i.kind === "text" ? i.text : "")).join("")).toBe("abcd");
  });

    it("in suggesting mode the break is an inline insertion revision (view, accept / reject, own Backspace)", () => {
    const suggesting = { ...config, suggestingAuthor: "alice" };
    const { editor, p } = typed("abcd", 2);
    const next = reduceEditor(editor, { type: "INSERT_LINE_BREAK" }, suggesting);
    expect(bodyBlockIds(next.state)).toEqual([p]);
    const brk = (getBlock(next.state, p)?.inlineContent?.items ?? []).find((i) => i.kind === "embed");
    const id = brk?.attrs[INSERTION_SUGGESTION_ATTR];
    expect(typeof id).toBe("string");
    expect(getSuggestions(next.state).some((s) => s.id === id && s.kind === "insertion" && s.author === "alice")).toBe(true);
    expect(next.selection.focus).toEqual({ blockId: p, offset: 3 });
    // "original" hides the break; reject drops it, accept keeps it untracked.
    expect(extractText(next.state, createSpan(createPosition(p, 0), createPosition(p, 5)), builtinEmbedSerializer, "original")).toBe("abcd");
    const kinds = (e: EditorState): string[] => (getBlock(e.state, firstChildId(e.state) as BlockId)?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : i.embedType));
    const rejected = reduceEditor(next, { type: "REJECT_ALL_SUGGESTIONS" }, suggesting);
    expect(kinds(rejected)).toEqual(["abcd"]);
    // (Each case on a fresh document: ops write the shared Y.Doc.)
    const again = reduceEditor(typed("abcd", 2).editor, { type: "INSERT_LINE_BREAK" }, suggesting);
    const accepted = reduceEditor(again, { type: "ACCEPT_ALL_SUGGESTIONS" }, suggesting);
    expect(kinds(accepted)).toEqual(["ab", HARD_BREAK_EMBED_TYPE, "cd"]);
    expect(getSuggestions(accepted.state)).toHaveLength(0);
    // Backspace over the author's own pending break removes it for real.
    const own = reduceEditor(reduceEditor(typed("abcd", 2).editor, { type: "INSERT_LINE_BREAK" }, suggesting), { type: "DELETE_BACKWARD" }, suggesting);
    expect(kinds(own)).toEqual(["abcd"]);
  });

  it("in suggesting mode over a selection: the break is inserted and the selection struck, one undo step", () => {
    const suggesting = { ...config, suggestingAuthor: "alice" };
    const { editor, p } = typed("abcd", 1);
    const sel = reduceEditor(editor, { type: "SET_SELECTION", selection: createSpan(createPosition(p, 1), createPosition(p, 3)) }, config);
    const next = reduceEditor(sel, { type: "INSERT_LINE_BREAK" }, suggesting);
    expect(getSuggestions(next.state).map((s) => s.kind).sort()).toEqual(["deletion", "insertion"]);
    expect(extractText(next.state, createSpan(createPosition(p, 0), createPosition(p, 5)), builtinEmbedSerializer, "final")).toBe("a\nd");
    expect(next.selection.focus).toEqual({ blockId: p, offset: 2 });
    const undone = reduceEditor(next, { type: "UNDO" }, suggesting);
    expect(getSuggestions(undone.state)).toHaveLength(0);
  });
});
