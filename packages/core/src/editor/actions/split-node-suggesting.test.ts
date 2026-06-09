/**
 * Change-tracking slice 4e-editor: SPLIT_NODE (Enter) branches for suggesting mode.
 *
 * Behavior-level tests through the real reducer. In suggesting mode
 * (`EditorConfig.suggestingAuthor` non-null) a COLLAPSED Enter routes through
 * `splitWithSuggestion`: a REAL structural split (two separate blocks, siblings
 * rewired, cursor → newBlock:0 exactly as in direct mode) PLUS a zero-width
 * `block-split-suggestion` embed appended to the END of block N + an `insertion`
 * SuggestionRecord — one undoable transaction.
 *
 * Scope of THIS slice: the COLLAPSED cases. A NON-collapsed (type-over) Enter in
 * suggesting mode is an interim NO-OP (the soft-delete-then-suggested-split
 * composite is the next slice, 4e-editor-composite) — never run the untracked
 * deleteRange, which would silently bypass change-tracking.
 */
import { describe, it, expect } from "vitest";
import {
  config as directConfig,
  reduceEditor,
  createInitialEditorState,
  createPosition,
  createSpan,
  getTextOf,
  type EditorConfig,
  type EditorState,
} from "./test-helpers";
import {
  getBlock,
  getSuggestions,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  type BlockId,
} from "../../state";

/** The first body paragraph id under the document root. */
function bodyParaId(editor: EditorState): BlockId {
  const root = getBlock(editor.state, editor.state.rootId);
  const id = root?.firstChildId;
  if (id === undefined || id === null) {
    throw new Error("document root has no first child paragraph");
  }
  return id;
}

/** A suggesting-mode config attributed to "alice" (direct config + author). */
const suggestingConfig: EditorConfig = { ...directConfig, suggestingAuthor: "alice" };

/** Place a collapsed caret at `offset` of `paraId`. */
function caretAt(
  editor: EditorState,
  paraId: BlockId,
  offset: number,
  cfg: EditorConfig,
): EditorState {
  return reduceEditor(
    editor,
    {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(paraId, offset), createPosition(paraId, offset)),
    },
    cfg,
  );
}

/** Select `[start, end)` of `paraId`. */
function select(
  editor: EditorState,
  paraId: BlockId,
  start: number,
  end: number,
  cfg: EditorConfig,
): EditorState {
  return reduceEditor(
    editor,
    {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(paraId, start), createPosition(paraId, end)),
    },
    cfg,
  );
}

/** True if `blockId`'s inlineContent ends with a `block-split-suggestion` embed. */
function endsWithSplitEmbed(editor: EditorState, blockId: BlockId): boolean {
  const items = getBlock(editor.state, blockId)?.inlineContent?.items ?? [];
  const last = items[items.length - 1];
  return (
    last !== undefined &&
    last.kind === "embed" &&
    last.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE
  );
}

/** Seed a single paragraph with `text` typed in (direct mode), caret at end. */
function seed(text: string): EditorState {
  return reduceEditor(
    createInitialEditorState(directConfig),
    { type: "INSERT_TEXT", text },
    directConfig,
  );
}

describe("handleSplitNode — suggesting mode (slice 4e-editor)", () => {
  it("collapsed Enter MID-paragraph: REAL split into TWO blocks, N ends with split embed, one insertion record, caret → newBlock:0, undoable", () => {
    const seeded = seed("abcdef");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 3, suggestingConfig); // caret after "abc"

    const next = reduceEditor(placed, { type: "SPLIT_NODE" }, suggestingConfig);

    // TWO real separate blocks: block N keeps "abc", block N+1 gets "def".
    const blockN = getBlock(next.state, paraId);
    const newId = blockN?.nextSiblingId ?? null;
    expect(newId).not.toBeNull();
    if (newId === null) throw new Error("expected a new sibling block");
    expect(getTextOf(next.state, paraId)).toBe("abc");
    expect(getTextOf(next.state, newId)).toBe("def");

    // Block N ends with the zero-width split-suggestion embed; the embed carries
    // the owning suggestion id.
    expect(endsWithSplitEmbed(next, paraId)).toBe(true);

    // An `insertion` SuggestionRecord exists (attributed to alice).
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].kind).toBe("insertion");
    expect(suggestions[0].author).toBe("alice");

    // Caret lands at the start of the new block (identical to direct split).
    expect(next.selection.anchor).toEqual(next.selection.focus);
    expect(next.selection.focus).toEqual(createPosition(newId, 0));

    // Undoable as ONE entry: undo removes both the new block and the embed/record.
    expect(next.history.canUndo()).toBe(true);
    const undone = reduceEditor(next, { type: "UNDO" }, suggestingConfig);
    expect(getTextOf(undone.state, paraId)).toBe("abcdef");
    expect(getBlock(undone.state, paraId)?.nextSiblingId).toBeNull();
    expect(endsWithSplitEmbed(undone, paraId)).toBe(false);
    expect(getSuggestions(undone.state)).toHaveLength(0);
  });

  it("collapsed Enter at START (offset 0): N becomes empty + carries the split embed, N+1 holds all text, caret → newBlock:0", () => {
    const seeded = seed("abcdef");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 0, suggestingConfig); // caret at the very start

    const next = reduceEditor(placed, { type: "SPLIT_NODE" }, suggestingConfig);

    // Block N becomes EMPTY (its only content is the zero-width split embed),
    // block N+1 carries all the original text.
    const blockN = getBlock(next.state, paraId);
    const newId = blockN?.nextSiblingId ?? null;
    expect(newId).not.toBeNull();
    if (newId === null) throw new Error("expected a new sibling block");
    expect(getTextOf(next.state, paraId)).toBe("");
    expect(getTextOf(next.state, newId)).toBe("abcdef");

    // The split embed still lands on N (the now-empty leading block).
    expect(endsWithSplitEmbed(next, paraId)).toBe(true);
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].kind).toBe("insertion");

    // Caret at the start of the new (content-carrying) block.
    expect(next.selection.focus).toEqual(createPosition(newId, 0));
  });

  it("collapsed Enter at END of a heading: follow-on type applies AND the split embed lands on N", () => {
    // Build a heading "Title" with caret at end, in direct mode, then switch to
    // suggesting mode for the Enter.
    let editor = createInitialEditorState(directConfig);
    const headingId = bodyParaId(editor);
    editor = reduceEditor(
      editor,
      { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } },
      directConfig,
    );
    for (const ch of "Title") {
      editor = reduceEditor(editor, { type: "INSERT_TEXT", text: ch }, directConfig);
    }
    // Caret is at the end (offset 5).
    const placed = caretAt(editor, headingId, 5, suggestingConfig);

    const next = reduceEditor(placed, { type: "SPLIT_NODE" }, suggestingConfig);

    const original = getBlock(next.state, headingId);
    expect(original?.type).toBe("heading");
    expect(original?.attrs).toEqual({ level: 1 });

    // The follow-on (newBlockInit) is threaded into splitWithSuggestion: the new
    // block is a plain paragraph with fresh attrs.
    const newId = original?.nextSiblingId ?? null;
    expect(newId).not.toBeNull();
    if (newId === null) throw new Error("expected a new sibling block");
    const created = getBlock(next.state, newId);
    expect(created?.type).toBe("paragraph");
    expect(created?.attrs).toEqual({});

    // The split-suggestion embed lands on N (the heading), not the new paragraph.
    expect(endsWithSplitEmbed(next, headingId)).toBe(true);
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].kind).toBe("insertion");
  });

  it("direct mode (regression): collapsed Enter does a plain untracked split (no embed, no record)", () => {
    const seeded = seed("abcdef");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 3, directConfig);

    const next = reduceEditor(placed, { type: "SPLIT_NODE" }, directConfig);

    const blockN = getBlock(next.state, paraId);
    const newId = blockN?.nextSiblingId ?? null;
    expect(newId).not.toBeNull();
    if (newId === null) throw new Error("expected a new sibling block");
    expect(getTextOf(next.state, paraId)).toBe("abc");
    expect(getTextOf(next.state, newId)).toBe("def");
    // No tracking: no embed, no suggestion record.
    expect(endsWithSplitEmbed(next, paraId)).toBe(false);
    expect(getSuggestions(next.state)).toHaveLength(0);
  });

  it("non-collapsed Enter in suggesting mode is an interim NO-OP (editor + state + selection unchanged)", () => {
    const seeded = seed("abcdef");
    const paraId = bodyParaId(seeded);
    const selected = select(seeded, paraId, 1, 4, suggestingConfig); // select "bcd"

    const next = reduceEditor(selected, { type: "SPLIT_NODE" }, suggestingConfig);

    // NO-OP: editor reference unchanged, no split, no soft-delete, no suggestion.
    expect(next).toBe(selected);
    expect(getTextOf(next.state, paraId)).toBe("abcdef");
    expect(getBlock(next.state, paraId)?.nextSiblingId).toBeNull();
    expect(getSuggestions(next.state)).toHaveLength(0);
  });

  it("direct mode (regression): non-collapsed Enter deletes the selection THEN splits", () => {
    const seeded = seed("abcdef");
    const paraId = bodyParaId(seeded);
    const selected = select(seeded, paraId, 1, 4, directConfig); // select "bcd"

    const next = reduceEditor(selected, { type: "SPLIT_NODE" }, directConfig);

    // "bcd" deleted, then split at offset 1: block N = "a", block N+1 = "ef".
    const blockN = getBlock(next.state, paraId);
    const newId = blockN?.nextSiblingId ?? null;
    expect(newId).not.toBeNull();
    if (newId === null) throw new Error("expected a new sibling block");
    expect(getTextOf(next.state, paraId)).toBe("a");
    expect(getTextOf(next.state, newId)).toBe("ef");
    expect(getSuggestions(next.state)).toHaveLength(0);
  });
});
