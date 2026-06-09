/**
 * Change-tracking slice 4b: the suggesting-mode foundation wired into the FIRST
 * create-branch — `INSERT_TEXT` at a COLLAPSED caret in suggesting mode inserts a
 * tracked SUGGESTION (via `mintInsertion`) instead of plain text.
 *
 * Behavior-level tests through the real reducer. The host turns on suggesting
 * mode via `EditorConfig.suggestingAuthor` (a non-null author string); direct
 * editing is the default (`suggestingAuthor` unset). Tests assert via the
 * `getSuggestions` read surface (the inserted run carries the insertion id + its
 * record is attributed to the author) and via undo/redo + coalescing.
 *
 * Scope of this slice is the collapsed-caret path ONLY: `INSERT_TEXT` over an
 * EXPANDED selection in suggesting mode is a tracked interim NO-OP (the soft-
 * delete + insert composite lands in a later change-tracking slice).
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
import { getBlock, getSuggestions, type BlockId } from "../../state";

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
function caretAt(editor: EditorState, paraId: BlockId, offset: number): EditorState {
  return reduceEditor(
    editor,
    {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(paraId, offset), createPosition(paraId, offset)),
    },
    suggestingConfig,
  );
}

describe("handleInsertText — suggesting mode (slice 4b)", () => {
  it("collapsed caret: inserts the text AND mints ONE insertion suggestion by the author", () => {
    const initial = createInitialEditorState(suggestingConfig);
    const paraId = bodyParaId(initial);
    const next = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, suggestingConfig);

    // The text landed.
    expect(getTextOf(next.state, paraId)).toBe("hi");

    // Exactly one insertion suggestion, by "alice", covering the inserted run.
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].kind).toBe("insertion");
    expect(suggestions[0].author).toBe("alice");
    expect(suggestions[0].orphaned).toBe(false);

    // The run carries the insertion-suggestion provenance attr = the record id.
    const items = getBlock(next.state, paraId)?.inlineContent?.items ?? [];
    const textItem = items.find((it) => it.kind === "text");
    expect(textItem?.kind).toBe("text");
    if (textItem?.kind === "text") {
      expect(textItem.attrs.insertionSuggestionId).toBe(suggestions[0].id);
    }
  });

  it("is undoable: UNDO reverts both the inserted text and the suggestion record", () => {
    const initial = createInitialEditorState(suggestingConfig);
    const paraId = bodyParaId(initial);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, suggestingConfig);

    expect(typed.history.canUndo()).toBe(true);

    const undone = reduceEditor(typed, { type: "UNDO" }, suggestingConfig);
    expect(getTextOf(undone.state, paraId)).toBe("");
    expect(getSuggestions(undone.state)).toHaveLength(0);
  });

  it("coalesces consecutive adjacent inserts into ONE insertion suggestion", () => {
    const initial = createInitialEditorState(suggestingConfig);
    const paraId = bodyParaId(initial);
    const a = reduceEditor(initial, { type: "INSERT_TEXT", text: "a" }, suggestingConfig);
    // Caret is now after "a"; the next insert is immediately adjacent.
    const ab = reduceEditor(a, { type: "INSERT_TEXT", text: "b" }, suggestingConfig);

    expect(getTextOf(ab.state, paraId)).toBe("ab");
    const suggestions = getSuggestions(ab.state);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].kind).toBe("insertion");
    expect(suggestions[0].author).toBe("alice");
  });

  it("direct mode (suggestingAuthor unset): plain text, NO suggestion", () => {
    const initial = createInitialEditorState(directConfig);
    const paraId = bodyParaId(initial);
    const next = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, directConfig);

    expect(getTextOf(next.state, paraId)).toBe("hi");
    expect(getSuggestions(next.state)).toHaveLength(0);
  });

  it("expanded selection in suggesting mode: interim NO-OP (no crash, no suggestion, text intact)", () => {
    // Seed "abcdef" via direct edit, then turn on suggesting mode + expand a selection.
    const seeded = reduceEditor(
      createInitialEditorState(directConfig),
      { type: "INSERT_TEXT", text: "abcdef" },
      directConfig,
    );
    const paraId = bodyParaId(seeded);
    const selected = reduceEditor(
      seeded,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(paraId, 1), createPosition(paraId, 4)),
      },
      suggestingConfig,
    );

    const next = reduceEditor(selected, { type: "INSERT_TEXT", text: "X" }, suggestingConfig);

    // Tracked interim no-op: editor reference unchanged, selected text intact, no suggestion.
    expect(next).toBe(selected);
    expect(getTextOf(next.state, paraId)).toBe("abcdef");
    expect(getSuggestions(next.state)).toHaveLength(0);
  });

  it("collapsed insert at a non-start caret mints a suggestion covering only the new run", () => {
    const seeded = reduceEditor(
      createInitialEditorState(directConfig),
      { type: "INSERT_TEXT", text: "abcdef" },
      directConfig,
    );
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 3); // caret between "abc" and "def"
    const next = reduceEditor(placed, { type: "INSERT_TEXT", text: "Z" }, suggestingConfig);

    expect(getTextOf(next.state, paraId)).toBe("abcZdef");
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].author).toBe("alice");
  });
});
