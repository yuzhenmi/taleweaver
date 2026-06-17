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
 * Slice 4d-editor extends this to the EXPANDED-selection path: typing over a
 * selection in suggesting mode routes through `replaceWithSuggestion` (the
 * suggestion analog of `replaceRange`) — it soft-deletes the selection AND inserts
 * `text` as a tracked insertion at the selection start, in ONE undoable op. The
 * inserted run carries `insertionSuggestionId` and sits BEFORE the struck selection
 * (which carries `deletionSuggestionId`); the caret lands at `start.offset +
 * text.length`. Direct mode (suggestingAuthor unset) keeps the destructive
 * `replaceRange`.
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

/** Throwing indexed access for tests: stronger than the old undefined-deref TypeError. */
function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}
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
    expect(nth(suggestions, 0, "suggestion").kind).toBe("insertion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");
    expect(nth(suggestions, 0, "suggestion").orphaned).toBe(false);

    // The run carries the insertion-suggestion provenance attr = the record id.
    const items = getBlock(next.state, paraId)?.inlineContent?.items ?? [];
    const textItem = items.find((it) => it.kind === "text");
    expect(textItem?.kind).toBe("text");
    if (textItem?.kind === "text") {
      expect(textItem.attrs.insertionSuggestionId).toBe(nth(suggestions, 0, "suggestion").id);
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
    expect(nth(suggestions, 0, "suggestion").kind).toBe("insertion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");
  });

  it("direct mode (suggestingAuthor unset): plain text, NO suggestion", () => {
    const initial = createInitialEditorState(directConfig);
    const paraId = bodyParaId(initial);
    const next = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, directConfig);

    expect(getTextOf(next.state, paraId)).toBe("hi");
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
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");
  });
});

/** Select `[start, end)` of `paraId` (suggesting config). */
function selectIn(
  editor: EditorState,
  paraId: BlockId,
  start: number,
  end: number,
): EditorState {
  return reduceEditor(
    editor,
    {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(paraId, start), createPosition(paraId, end)),
    },
    suggestingConfig,
  );
}

/** The `insertionSuggestionId` / `deletionSuggestionId` carried by the text run at
 *  character index `idx` of `paraId`, or `undefined` if no text run covers it / the
 *  run carries no such id. */
function suggestionIdAt(
  editor: EditorState,
  paraId: BlockId,
  idx: number,
  attr: "insertionSuggestionId" | "deletionSuggestionId",
): unknown {
  const items = getBlock(editor.state, paraId)?.inlineContent?.items ?? [];
  let offset = 0;
  for (const it of items) {
    if (it.kind !== "text") continue;
    if (idx >= offset && idx < offset + it.text.length) {
      return it.attrs[attr];
    }
    offset += it.text.length;
  }
  return undefined;
}

describe("handleInsertText — type over a selection, suggesting mode (slice 4d-editor)", () => {
  it("soft-deletes the selection AND inserts the text as a tracked insertion at its start", () => {
    // Seed "abcdef" direct, then turn on suggesting mode + select "bcd" ([1,4)).
    const seeded = reduceEditor(
      createInitialEditorState(directConfig),
      { type: "INSERT_TEXT", text: "abcdef" },
      directConfig,
    );
    const paraId = bodyParaId(seeded);
    const selected = selectIn(seeded, paraId, 1, 4);

    const next = reduceEditor(selected, { type: "INSERT_TEXT", text: "X" }, suggestingConfig);

    // The struck "bcd" STAYS — "X" lands BEFORE it → content text "aXbcdef".
    expect(getTextOf(next.state, paraId)).toBe("aXbcdef");

    // Exactly two records: one insertion + one deletion, both by "alice".
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(2);
    const insertion = suggestions.find((s) => s.kind === "insertion");
    const deletion = suggestions.find((s) => s.kind === "deletion");
    expect(insertion?.author).toBe("alice");
    expect(deletion?.author).toBe("alice");
    // Both records SHARE one createdAt — the render-layer "this was ONE replace"
    // grouping signal (a regression minting two timestamps would pass every other
    // assertion here).
    expect(insertion?.createdAt).toBe(deletion?.createdAt);

    // "X" (index 1) carries the insertion id; the struck "bcd" (indices 2..4)
    // carries the deletion id; "a"/"e"/"f" carry neither.
    expect(suggestionIdAt(next, paraId, 1, "insertionSuggestionId")).toBe(insertion?.id);
    expect(suggestionIdAt(next, paraId, 2, "deletionSuggestionId")).toBe(deletion?.id);
    expect(suggestionIdAt(next, paraId, 4, "deletionSuggestionId")).toBe(deletion?.id);
    expect(suggestionIdAt(next, paraId, 0, "insertionSuggestionId")).toBeUndefined();
    expect(suggestionIdAt(next, paraId, 0, "deletionSuggestionId")).toBeUndefined();
    expect(suggestionIdAt(next, paraId, 5, "deletionSuggestionId")).toBeUndefined();

    // Caret collapses to start.offset (1) + text.length (1) = offset 2.
    expect(next.selection.anchor).toEqual(next.selection.focus);
    expect(next.selection.focus.blockId).toBe(paraId);
    expect(next.selection.focus.offset).toBe(2);
  });

  it("is ONE undo unit: UNDO reverts the whole composite (text restored, zero suggestions)", () => {
    const seeded = reduceEditor(
      createInitialEditorState(directConfig),
      { type: "INSERT_TEXT", text: "abcdef" },
      directConfig,
    );
    const paraId = bodyParaId(seeded);
    const selected = selectIn(seeded, paraId, 1, 4);
    const typed = reduceEditor(selected, { type: "INSERT_TEXT", text: "X" }, suggestingConfig);

    expect(typed.history.canUndo()).toBe(true);

    // A SINGLE undo undoes both the strike and the insert (atomic composite).
    const undone = reduceEditor(typed, { type: "UNDO" }, suggestingConfig);
    expect(getTextOf(undone.state, paraId)).toBe("abcdef");
    expect(getSuggestions(undone.state)).toHaveLength(0);
  });

  it("direct mode (regression): the SAME type-over REMOVES the selection (replaceRange), no suggestion", () => {
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
      directConfig,
    );

    const next = reduceEditor(selected, { type: "INSERT_TEXT", text: "X" }, directConfig);

    // Destructive replace: "bcd" is GONE, "X" inserted → "aXef"; no suggestion.
    expect(getTextOf(next.state, paraId)).toBe("aXef");
    expect(getSuggestions(next.state)).toHaveLength(0);
    // Caret at start.offset (1) + text.length (1) = offset 2.
    expect(next.selection.anchor).toEqual(next.selection.focus);
    expect(next.selection.focus.offset).toBe(2);
  });

  it("multi-block type-over: strikes the p1 tail + p2 head, inserts X at p1, one insertion + one deletion", () => {
    // Build two paragraphs: "abc" | "def" (split between them).
    let s = createInitialEditorState(directConfig);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, directConfig);
    s = reduceEditor(s, { type: "SPLIT_NODE" }, directConfig);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "def" }, directConfig);

    const root = getBlock(s.state, s.state.rootId);
    const p1 = root?.firstChildId ?? null;
    const p2 = root?.lastChildId ?? null;
    if (p1 === null || p2 === null || p1 === p2) {
      throw new Error("expected two distinct paragraphs");
    }

    // Select from offset 1 of p1 ("a|bc") through offset 2 of p2 ("de|f").
    const selected = reduceEditor(
      s,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(p1, 1), createPosition(p2, 2)),
      },
      suggestingConfig,
    );

    const next = reduceEditor(selected, { type: "INSERT_TEXT", text: "X" }, suggestingConfig);

    // Soft delete keeps the struck text: p1 = "a" + "X"(insertion) + struck "bc";
    // p2 = struck "de" + "f". The inserted run lands at the selection START (p1).
    expect(getTextOf(next.state, p1)).toBe("aXbc");
    expect(getTextOf(next.state, p2)).toBe("def");

    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(2);
    const insertion = suggestions.find((sg) => sg.kind === "insertion");
    const deletion = suggestions.find((sg) => sg.kind === "deletion");
    expect(insertion?.author).toBe("alice");
    expect(deletion?.author).toBe("alice");

    // "X" (p1 index 1) carries the insertion id; struck "bc" (p1 indices 2..3) and
    // struck "de" (p2 indices 0..1) carry the deletion id; "a" and "f" carry neither.
    expect(suggestionIdAt(next, p1, 1, "insertionSuggestionId")).toBe(insertion?.id);
    expect(suggestionIdAt(next, p1, 2, "deletionSuggestionId")).toBe(deletion?.id);
    expect(suggestionIdAt(next, p1, 3, "deletionSuggestionId")).toBe(deletion?.id);
    expect(suggestionIdAt(next, p2, 0, "deletionSuggestionId")).toBe(deletion?.id);
    expect(suggestionIdAt(next, p2, 1, "deletionSuggestionId")).toBe(deletion?.id);
    expect(suggestionIdAt(next, p1, 0, "deletionSuggestionId")).toBeUndefined();
    expect(suggestionIdAt(next, p2, 2, "deletionSuggestionId")).toBeUndefined();

    // Caret collapses to p1 start.offset (1) + text.length (1) = offset 2.
    expect(next.selection.anchor).toEqual(next.selection.focus);
    expect(next.selection.focus.blockId).toBe(p1);
    expect(next.selection.focus.offset).toBe(2);
  });
});
