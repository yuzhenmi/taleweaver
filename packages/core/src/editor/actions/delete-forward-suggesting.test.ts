/**
 * Change-tracking slice 4c-ii: DELETE_FORWARD branches for suggesting mode.
 *
 * Behavior-level tests through the real reducer. In suggesting mode
 * (`EditorConfig.suggestingAuthor` non-null) a forward Delete SOFT-deletes — it
 * stamps the in-range runs with a `deletionSuggestionId` (the text STAYS,
 * struck-through) via `markDeletion` instead of really removing it.
 *
 * The crux of this slice: unlike DELETE_BACKWARD (caret → span START), a forward
 * soft-delete leaves the caret at the span END (PAST the struck text). The struck
 * text stays in place, so a caret left at the span start would make the NEXT
 * Delete re-target the already-struck char (markDeletion coalesces → no-op);
 * advancing the caret past the strike lets repeated Delete strike successive
 * chars.
 *
 * Scope of slice 4c-ii: the EXPANDED-selection and collapsed MID-BLOCK-char paths.
 *
 * Slice 4e-editor (folded in below) wires the block-end case: a Delete at the END
 * of a PLAIN paragraph (with a non-empty next paragraph sibling) marks a suggested
 * JOIN via `markBlockJoinSuggestion` — a zero-width `block-join-suggestion` embed
 * appended to the END of the CURRENT block N + a `deletion` record, with the two
 * blocks staying SEPARATE (no merge) and the caret unchanged. The adjacent-atomic-
 * leaf / section-merge branches keep their current untracked behavior in suggesting
 * mode (those-as-suggestions are explicit follow-ups).
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
import {
  getBlock,
  getSuggestions,
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
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

/** Place a collapsed caret at `offset` of `paraId` (suggesting config). */
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

/** Select `[start, end)` of `paraId` (suggesting config). */
function select(
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

/** The `deletionSuggestionId` carried by the run at character index `idx`, or
 *  `undefined` if no text run covers it / the run carries no deletion id. */
function deletionIdAt(
  editor: EditorState,
  paraId: BlockId,
  idx: number,
): unknown {
  const items = getBlock(editor.state, paraId)?.inlineContent?.items ?? [];
  let offset = 0;
  for (const it of items) {
    if (it.kind !== "text") continue;
    if (idx >= offset && idx < offset + it.text.length) {
      return it.attrs.deletionSuggestionId;
    }
    offset += it.text.length;
  }
  return undefined;
}

/** True if `blockId`'s inlineContent ends with a `block-join-suggestion` embed. */
function endsWithJoinEmbed(editor: EditorState, blockId: BlockId): boolean {
  const items = getBlock(editor.state, blockId)?.inlineContent?.items ?? [];
  const last = items[items.length - 1];
  return (
    last !== undefined &&
    last.kind === "embed" &&
    last.embedType === BLOCK_JOIN_SUGGESTION_EMBED_TYPE
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

/** Build two plain paragraphs ("abc" then "def") in direct mode; returns the
 *  editor + both block ids. */
function twoParagraphs(): {
  editor: EditorState;
  firstId: BlockId;
  secondId: BlockId;
} {
  let s = createInitialEditorState(directConfig);
  s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, directConfig);
  s = reduceEditor(s, { type: "SPLIT_NODE" }, directConfig);
  s = reduceEditor(s, { type: "INSERT_TEXT", text: "def" }, directConfig);
  const root = getBlock(s.state, s.state.rootId);
  const firstId = root?.firstChildId ?? null;
  const secondId = root?.lastChildId ?? null;
  if (firstId === null || secondId === null || firstId === secondId) {
    throw new Error("expected two distinct paragraphs");
  }
  return { editor: s, firstId, secondId };
}

describe("handleDeleteForward — suggesting mode (slice 4c-ii)", () => {
  it("mid-block Delete: SOFT-deletes the char at the caret (tag, text intact, caret AFTER it, one deletion record)", () => {
    const seeded = seed("abc");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 0); // caret before "abc"

    const next = reduceEditor(placed, { type: "DELETE_FORWARD" }, suggestingConfig);

    // Text is UNCHANGED — soft delete keeps the struck char.
    expect(getTextOf(next.state, paraId)).toBe("abc");
    // The char at the caret ("a", index 0) carries the deletion id.
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");
    expect(deletionIdAt(next, paraId, 0)).toBe(nth(suggestions, 0, "suggestion").id);
    // "b"/"c" (indices 1/2) are untouched.
    expect(deletionIdAt(next, paraId, 1)).toBeUndefined();
    // The caret advances to the position PAST the struck char (offset 1 = span END).
    expect(next.selection.anchor).toEqual(next.selection.focus);
    expect(next.selection.focus.blockId).toBe(paraId);
    expect(next.selection.focus.offset).toBe(1);
  });

  it("repeated Delete advances and strikes SUCCESSIVE chars (caret advanced past each strike)", () => {
    const seeded = seed("abc");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 0); // caret before "abc"

    const once = reduceEditor(placed, { type: "DELETE_FORWARD" }, suggestingConfig);
    const twice = reduceEditor(once, { type: "DELETE_FORWARD" }, suggestingConfig);

    // Text still intact; "a" (0) AND "b" (1) are both struck; "c" (2) is not.
    // If the caret had NOT advanced, the 2nd Delete would re-target the already-
    // struck char 0 (markDeletion coalesces → no-op) and char 1 would stay
    // UNSTRUCK — so char-1-is-struck IS the proof the caret advanced.
    expect(getTextOf(twice.state, paraId)).toBe("abc");
    const id0 = deletionIdAt(twice, paraId, 0);
    const id1 = deletionIdAt(twice, paraId, 1);
    expect(id0).toBeDefined();
    expect(id1).toBeDefined();
    expect(deletionIdAt(twice, paraId, 2)).toBeUndefined();
    // Two ADJACENT same-author deletions coalesce into ONE record (reused id), so
    // both struck chars carry the SAME deletion id.
    expect(id1).toBe(id0);
    const suggestions = getSuggestions(twice.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    // Caret advanced to offset 2 (past both strikes).
    expect(twice.selection.focus.offset).toBe(2);
  });

  it("is undoable: UNDO reverts the soft-delete (no deletion id, no record)", () => {
    const seeded = seed("abc");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 0);
    const struck = reduceEditor(placed, { type: "DELETE_FORWARD" }, suggestingConfig);

    expect(struck.history.canUndo()).toBe(true);

    const undone = reduceEditor(struck, { type: "UNDO" }, suggestingConfig);
    expect(getTextOf(undone.state, paraId)).toBe("abc");
    expect(deletionIdAt(undone, paraId, 0)).toBeUndefined();
    expect(getSuggestions(undone.state)).toHaveLength(0);
  });

  it("expanded selection: SOFT-deletes every run in the span (tagged, text intact, caret at span END)", () => {
    const seeded = seed("abcdef");
    const paraId = bodyParaId(seeded);
    const selected = select(seeded, paraId, 1, 4); // select "bcd"

    const next = reduceEditor(selected, { type: "DELETE_FORWARD" }, suggestingConfig);

    // Text intact; "bcd" (indices 1..3) carry the deletion id; "a"/"e"/"f" do not.
    expect(getTextOf(next.state, paraId)).toBe("abcdef");
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");
    expect(deletionIdAt(next, paraId, 1)).toBe(nth(suggestions, 0, "suggestion").id);
    expect(deletionIdAt(next, paraId, 2)).toBe(nth(suggestions, 0, "suggestion").id);
    expect(deletionIdAt(next, paraId, 3)).toBe(nth(suggestions, 0, "suggestion").id);
    expect(deletionIdAt(next, paraId, 0)).toBeUndefined();
    expect(deletionIdAt(next, paraId, 4)).toBeUndefined();
    // Caret collapses to the selection END (offset 4 = span END).
    expect(next.selection.anchor).toEqual(next.selection.focus);
    expect(next.selection.focus.blockId).toBe(paraId);
    expect(next.selection.focus.offset).toBe(4);
  });

  it("direct mode (regression): the SAME mid-block Delete REMOVES the char, caret stays, no suggestion", () => {
    const seeded = seed("abc");
    const paraId = bodyParaId(seeded);
    const placed = reduceEditor(
      seeded,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(paraId, 0), createPosition(paraId, 0)),
      },
      directConfig,
    );

    const next = reduceEditor(placed, { type: "DELETE_FORWARD" }, directConfig);

    // Direct delete: the char is REALLY removed (text shrinks), caret stays at pos.
    expect(getTextOf(next.state, paraId)).toBe("bc");
    expect(next.selection.focus.offset).toBe(0);
    expect(getSuggestions(next.state)).toHaveLength(0);
  });

  it("block-end Delete at a PLAIN paragraph boundary marks a suggested JOIN (blocks stay separate, embed on current block N, deletion record, caret unchanged, undoable)", () => {
    const { editor, firstId, secondId } = twoParagraphs();
    const placed = caretAt(editor, firstId, 3); // caret at end of "abc"

    const next = reduceEditor(placed, { type: "DELETE_FORWARD" }, suggestingConfig);

    // Blocks stay SEPARATE — NO real merge happened.
    expect(getBlock(next.state, firstId)?.id).toBe(firstId);
    expect(getBlock(next.state, secondId)?.id).toBe(secondId);
    expect(getTextOf(next.state, firstId)).toBe("abc");
    expect(getTextOf(next.state, secondId)).toBe("def");

    // The CURRENT block N ("abc") ends with the zero-width join-suggestion embed
    // (the break AFTER currentBlock = before nextBlock lands at currentBlock's end).
    expect(endsWithJoinEmbed(next, firstId)).toBe(true);

    // A `deletion` SuggestionRecord exists (attributed to alice).
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");

    // The caret stays at currentBlock:currentLen (no merge happened).
    expect(next.selection.anchor).toEqual(next.selection.focus);
    expect(next.selection.focus).toEqual(createPosition(firstId, 3));

    // Undoable: UNDO removes the embed + record, blocks unchanged.
    expect(next.history.canUndo()).toBe(true);
    const undone = reduceEditor(next, { type: "UNDO" }, suggestingConfig);
    expect(endsWithJoinEmbed(undone, firstId)).toBe(false);
    expect(getSuggestions(undone.state)).toHaveLength(0);
    expect(getTextOf(undone.state, firstId)).toBe("abc");
    expect(getTextOf(undone.state, secondId)).toBe("def");
  });

  it("direct mode (regression): the SAME block-end Delete really MERGES the two blocks", () => {
    const { editor, firstId, secondId } = twoParagraphs();
    const placed = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(firstId, 3), createPosition(firstId, 3)),
      },
      directConfig,
    );

    const next = reduceEditor(placed, { type: "DELETE_FORWARD" }, directConfig);

    // Real merge: block N now holds "abcdef"; the second block is gone.
    expect(getTextOf(next.state, firstId)).toBe("abcdef");
    expect(getBlock(next.state, secondId)).toBeNull();
    // Caret stays at currentBlock:currentLen (offset 3).
    expect(next.selection.focus).toEqual(createPosition(firstId, 3));
    expect(getSuggestions(next.state)).toHaveLength(0);
  });
});
