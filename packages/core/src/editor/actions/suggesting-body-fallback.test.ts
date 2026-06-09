/**
 * Change-tracking state-audit Finding 3a: suggesting-mode edits whose target is
 * OUTSIDE the MAIN body (footnote / header / footer / template bodies) fall back
 * to DIRECT (untracked) editing.
 *
 * Change-tracking tracks suggestions in the MAIN body only (the resolve scan walks
 * the main block tree). Before this fix the suggesting-mode branches gated only on
 * `config.suggestingAuthor`, so a caret in a footnote/header body created a body
 * suggestion the main-tree resolve scan could never see — accept/reject-all then
 * deleted the record but left the tagged runs / break embeds as un-resolvable
 * zombies (silent state corruption).
 *
 * The gate: a block is in the main body iff `selectionContextOf(state, blockId)
 * === state.rootId`. A non-main-body target now takes the existing DIRECT branch
 * (the edit still happens, untracked, creating no un-resolvable suggestion).
 *
 * These behavior-level tests drive `reduceEditor` in suggesting mode with the
 * caret/selection inside a FOOTNOTE body, asserting the edit lands directly with
 * ZERO suggestions; the regression block proves the SAME actions in the MAIN body
 * still create suggestions (the gate only diverts body edits).
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
  resolveBlock,
  selectionContextOf,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  type BlockId,
} from "../../state";

/** A suggesting-mode config attributed to "alice". */
const suggestingConfig: EditorConfig = { ...directConfig, suggestingAuthor: "alice" };

/** The first body paragraph id under the document root (MAIN tree). */
function bodyParaId(editor: EditorState): BlockId {
  const root = getBlock(editor.state, editor.state.rootId);
  const id = root?.firstChildId;
  if (id === undefined || id === null) {
    throw new Error("document root has no first child paragraph");
  }
  return id;
}

/** The text of a block resolved via `resolveBlock` (works for any tree). */
function textOfResolved(editor: EditorState, blockId: BlockId): string {
  const block = resolveBlock(editor.state, blockId)?.block ?? null;
  return (block?.inlineContent?.items ?? [])
    .map((it) => (it.kind === "text" ? it.text : ""))
    .join("");
}

/** Whether ANY text run in `blockId` carries the named suggestion-provenance attr. */
function anyRunHasAttr(
  editor: EditorState,
  blockId: BlockId,
  attr: "insertionSuggestionId" | "deletionSuggestionId" | "formattingSuggestionId",
): boolean {
  const block = resolveBlock(editor.state, blockId)?.block ?? null;
  for (const it of block?.inlineContent?.items ?? []) {
    if (it.kind === "text" && it.attrs[attr] !== undefined) return true;
  }
  return false;
}

/** True iff `blockId`'s inlineContent ends with a `block-split-suggestion` embed
 *  (the suggesting-mode soft-split marker). Resolves via `resolveBlock` so it
 *  works for a non-main-body block. */
function endsWithSplitEmbed(editor: EditorState, blockId: BlockId): boolean {
  const items = resolveBlock(editor.state, blockId)?.block?.inlineContent?.items ?? [];
  const last = items[items.length - 1];
  return (
    last !== undefined &&
    last.kind === "embed" &&
    last.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE
  );
}

/**
 * Build an editor whose caret is inside a FOOTNOTE body paragraph that already
 * contains "abc" (typed DIRECTLY so no suggestions exist yet). Returns the editor
 * and the body paragraph id. Direct-config typing is used for the seed so the
 * fixture starts with ZERO suggestions.
 */
function footnoteBodyFixture(): { editor: EditorState; bodyParaId: BlockId } {
  // Seed the main body, then insert a footnote (caret lands in the new body).
  const initial = createInitialEditorState(directConfig);
  const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "x" }, directConfig);
  const withFn = reduceEditor(typed, { type: "INSERT_FOOTNOTE" }, directConfig);
  const bodyPara = withFn.selection.focus.blockId;
  // Seed body text DIRECTLY (direct config) so the fixture has no suggestions.
  const seeded = reduceEditor(withFn, { type: "INSERT_TEXT", text: "abc" }, directConfig);
  expect(getSuggestions(seeded.state)).toHaveLength(0);
  expect(textOfResolved(seeded, bodyPara)).toBe("abc");
  // Self-guard: the body paragraph must be OUTSIDE the main body (a real
  // footnote-body block in embedContents), else these tests would silently
  // exercise the main-body path and prove nothing about the fallback gate.
  expect(selectionContextOf(seeded.state, bodyPara)).not.toBe(seeded.state.rootId);
  return { editor: seeded, bodyParaId: bodyPara };
}

/** Place a collapsed caret at `offset` of `blockId` (suggesting config). */
function caretAt(editor: EditorState, blockId: BlockId, offset: number): EditorState {
  return reduceEditor(
    editor,
    {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(blockId, offset), createPosition(blockId, offset)),
    },
    suggestingConfig,
  );
}

/** Select `[start, end)` of `blockId` (suggesting config). */
function selectIn(editor: EditorState, blockId: BlockId, start: number, end: number): EditorState {
  return reduceEditor(
    editor,
    {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(blockId, start), createPosition(blockId, end)),
    },
    suggestingConfig,
  );
}

describe("suggesting mode in a footnote BODY falls back to DIRECT editing (Finding 3a)", () => {
  it("INSERT_TEXT (collapsed) inserts directly, no suggestion, no insertionSuggestionId on the body run", () => {
    const { editor, bodyParaId } = footnoteBodyFixture();
    const placed = caretAt(editor, bodyParaId, 3); // end of "abc"
    const next = reduceEditor(placed, { type: "INSERT_TEXT", text: "Z" }, suggestingConfig);

    // The text landed in the body (direct edit).
    expect(textOfResolved(next, bodyParaId)).toBe("abcZ");
    // No suggestion record, no provenance attr.
    expect(getSuggestions(next.state)).toHaveLength(0);
    expect(anyRunHasAttr(next, bodyParaId, "insertionSuggestionId")).toBe(false);
  });

  it("DELETE_BACKWARD (mid-block char) deletes directly, no suggestion, no deletionSuggestionId", () => {
    const { editor, bodyParaId } = footnoteBodyFixture();
    const placed = caretAt(editor, bodyParaId, 3); // caret after "abc"
    const next = reduceEditor(placed, { type: "DELETE_BACKWARD" }, suggestingConfig);

    // The "c" is really gone (direct delete).
    expect(textOfResolved(next, bodyParaId)).toBe("ab");
    expect(getSuggestions(next.state)).toHaveLength(0);
    expect(anyRunHasAttr(next, bodyParaId, "deletionSuggestionId")).toBe(false);
  });

  it("TOGGLE_STYLE (bold) over a body selection applies the live attr directly, no suggestion", () => {
    const { editor, bodyParaId } = footnoteBodyFixture();
    const selected = selectIn(editor, bodyParaId, 0, 3); // select "abc"
    const next = reduceEditor(selected, { type: "TOGGLE_STYLE", style: "bold" }, suggestingConfig);

    // The live bold attr changed directly (no formatting suggestion).
    const block = resolveBlock(next.state, bodyParaId)?.block ?? null;
    const firstText = (block?.inlineContent?.items ?? []).find((it) => it.kind === "text");
    expect(firstText?.kind).toBe("text");
    if (firstText?.kind === "text") {
      expect(firstText.attrs.bold).toBe(true);
    }
    expect(getSuggestions(next.state)).toHaveLength(0);
    expect(anyRunHasAttr(next, bodyParaId, "formattingSuggestionId")).toBe(false);
  });

  it("SPLIT_NODE (Enter) in the body really splits, no suggestion, body block ends with NO split embed", () => {
    const { editor, bodyParaId } = footnoteBodyFixture();
    const placed = caretAt(editor, bodyParaId, 1); // caret after "a" → split "a" | "bc"
    const next = reduceEditor(placed, { type: "SPLIT_NODE" }, suggestingConfig);

    // A real direct split: the original body block keeps "a", the caret moved to a
    // brand-new block holding "bc".
    expect(textOfResolved(next, bodyParaId)).toBe("a");
    const newBlockId = next.selection.focus.blockId;
    expect(newBlockId).not.toBe(bodyParaId);
    expect(next.selection.focus.offset).toBe(0);
    expect(textOfResolved(next, newBlockId)).toBe("bc");
    // No suggestion record, and the body block did NOT get a block-split-suggestion
    // embed appended (that's the suggesting-mode soft-split this fallback avoids).
    expect(getSuggestions(next.state)).toHaveLength(0);
    expect(endsWithSplitEmbed(next, bodyParaId)).toBe(false);
  });

  it("DELETE_FORWARD (collapsed mid-char) in the body really deletes; caret stays at the delete point (Finding A lock)", () => {
    const { editor, bodyParaId } = footnoteBodyFixture();
    const placed = caretAt(editor, bodyParaId, 1); // caret between "a" and "b"
    const next = reduceEditor(placed, { type: "DELETE_FORWARD" }, suggestingConfig);

    // The "b" is really removed (direct delete; body text shrank "abc" → "ac").
    expect(textOfResolved(next, bodyParaId)).toBe("ac");
    expect(getSuggestions(next.state)).toHaveLength(0);
    expect(anyRunHasAttr(next, bodyParaId, "deletionSuggestionId")).toBe(false);
    // Finding A: a body DELETE_FORWARD falls back to a real delete, so the caret
    // stays at the span START (offset 1, the delete point) — it must NOT advance
    // to the span end (offset 2) as the soft-delete caret rule would. This FAILS
    // against the pre-fix `(config.suggestingAuthor ?? null) !== null` flag.
    expect(next.selection.focus.blockId).toBe(bodyParaId);
    expect(next.selection.focus.offset).toBe(1);
  });

  it("DELETE_WORD (forward) in the body really deletes; caret stays at the delete point (Finding A lock, delete-word path)", () => {
    const { editor, bodyParaId } = footnoteBodyFixture();
    const placed = caretAt(editor, bodyParaId, 0); // caret before the word "abc"
    const next = reduceEditor(
      placed,
      { type: "DELETE_WORD", direction: "forward" },
      suggestingConfig,
    );

    // The word "abc" is really removed (direct delete; body text → "").
    expect(textOfResolved(next, bodyParaId)).toBe("");
    expect(getSuggestions(next.state)).toHaveLength(0);
    expect(anyRunHasAttr(next, bodyParaId, "deletionSuggestionId")).toBe(false);
    // Finding A (delete-word path): a body forward word-delete falls back to a real
    // delete, so the caret stays at the span START (offset 0, the delete point) — it
    // must NOT advance to the word boundary (offset 3) as the soft-delete caret rule
    // would. This FAILS against the pre-fix `config.suggestingAuthor` flag.
    expect(next.selection.focus.blockId).toBe(bodyParaId);
    expect(next.selection.focus.offset).toBe(0);
  });
});

describe("regression: the SAME actions in the MAIN body still create suggestions", () => {
  it("INSERT_TEXT (collapsed) in the main body mints an insertion suggestion + stamps the run", () => {
    const initial = createInitialEditorState(directConfig);
    const para = bodyParaId(initial);
    const placed = caretAt(initial, para, 0);
    const next = reduceEditor(placed, { type: "INSERT_TEXT", text: "Z" }, suggestingConfig);

    expect(getTextOf(next.state, para)).toBe("Z");
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].kind).toBe("insertion");
    expect(anyRunHasAttr(next, para, "insertionSuggestionId")).toBe(true);
  });

  it("DELETE_BACKWARD in the main body soft-deletes (deletion suggestion + run stamped)", () => {
    const seeded = reduceEditor(
      createInitialEditorState(directConfig),
      { type: "INSERT_TEXT", text: "abc" },
      directConfig,
    );
    const para = bodyParaId(seeded);
    const placed = caretAt(seeded, para, 3);
    const next = reduceEditor(placed, { type: "DELETE_BACKWARD" }, suggestingConfig);

    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].kind).toBe("deletion");
    expect(anyRunHasAttr(next, para, "deletionSuggestionId")).toBe(true);
  });

  it("TOGGLE_STYLE in the main body mints a formatting suggestion + stamps the run", () => {
    const seeded = reduceEditor(
      createInitialEditorState(directConfig),
      { type: "INSERT_TEXT", text: "abc" },
      directConfig,
    );
    const para = bodyParaId(seeded);
    const selected = selectIn(seeded, para, 0, 3);
    const next = reduceEditor(selected, { type: "TOGGLE_STYLE", style: "bold" }, suggestingConfig);

    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].kind).toBe("formatting");
    expect(anyRunHasAttr(next, para, "formattingSuggestionId")).toBe(true);
  });
});
