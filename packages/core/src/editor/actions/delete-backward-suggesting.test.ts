/**
 * Change-tracking slice 4c-i: DELETE_BACKWARD branches for suggesting mode.
 *
 * Behavior-level tests through the real reducer. In suggesting mode
 * (`EditorConfig.suggestingAuthor` non-null) a Backspace SOFT-deletes — it stamps
 * the in-range runs with a `deletionSuggestionId` (the text STAYS, struck-through)
 * via `markDeletion` instead of really removing it. The caret lands at the span
 * start (same as a real backward delete), which is correct for a soft delete too.
 *
 * Scope of slice 4c-i: the EXPANDED-selection and collapsed MID-BLOCK-char paths.
 *
 * Slice 4e-editor (folded in below) wires the block-start case: a Backspace at the
 * START of a PLAIN paragraph (with a non-empty prev paragraph sibling) marks a
 * suggested JOIN via `markBlockJoinSuggestion` — a zero-width
 * `block-join-suggestion` embed appended to the prev block N + a `deletion`
 * record, with the two blocks staying SEPARATE (no merge) and the caret unchanged.
 * The list-item-outdent / adjacent-atomic-leaf / section-merge branches keep their
 * current untracked behavior in suggesting mode (those-as-suggestions are explicit
 * follow-ups).
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

describe("handleDeleteBackward — suggesting mode (slice 4c-i)", () => {
  it("mid-block backspace: SOFT-deletes the prior char (tag, text intact, caret before it, one deletion record)", () => {
    const seeded = seed("abc");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 3); // caret after "abc"

    const next = reduceEditor(placed, { type: "DELETE_BACKWARD" }, suggestingConfig);

    // Text is UNCHANGED — soft delete keeps the struck char.
    expect(getTextOf(next.state, paraId)).toBe("abc");
    // The char before the caret ("c", index 2) carries the deletion id.
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");
    expect(deletionIdAt(next, paraId, 2)).toBe(nth(suggestions, 0, "suggestion").id);
    // "a"/"b" (indices 0/1) are untouched.
    expect(deletionIdAt(next, paraId, 0)).toBeUndefined();
    // The caret collapses to the position BEFORE the struck char (offset 2).
    expect(next.selection.anchor).toEqual(next.selection.focus);
    expect(next.selection.focus.blockId).toBe(paraId);
    expect(next.selection.focus.offset).toBe(2);
  });

  it("is undoable: UNDO reverts the soft-delete (no deletion id, no record)", () => {
    const seeded = seed("abc");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 3);
    const struck = reduceEditor(placed, { type: "DELETE_BACKWARD" }, suggestingConfig);

    expect(struck.history.canUndo()).toBe(true);

    const undone = reduceEditor(struck, { type: "UNDO" }, suggestingConfig);
    expect(getTextOf(undone.state, paraId)).toBe("abc");
    expect(deletionIdAt(undone, paraId, 2)).toBeUndefined();
    expect(getSuggestions(undone.state)).toHaveLength(0);
  });

  it("expanded selection: SOFT-deletes every run in the span (tagged, text intact, caret at span start)", () => {
    const seeded = seed("abcdef");
    const paraId = bodyParaId(seeded);
    const selected = select(seeded, paraId, 1, 4); // select "bcd"

    const next = reduceEditor(selected, { type: "DELETE_BACKWARD" }, suggestingConfig);

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
    // Caret collapses to the selection START (offset 1).
    expect(next.selection.anchor).toEqual(next.selection.focus);
    expect(next.selection.focus.blockId).toBe(paraId);
    expect(next.selection.focus.offset).toBe(1);
  });

  it("direct mode (regression): the SAME mid-block backspace REMOVES the char, no suggestion", () => {
    const seeded = seed("abc");
    const paraId = bodyParaId(seeded);
    const placed = reduceEditor(
      seeded,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(paraId, 3), createPosition(paraId, 3)),
      },
      directConfig,
    );

    const next = reduceEditor(placed, { type: "DELETE_BACKWARD" }, directConfig);

    // Direct delete: the char is REALLY removed (text shrinks), no deletion record.
    expect(getTextOf(next.state, paraId)).toBe("ab");
    expect(getSuggestions(next.state)).toHaveLength(0);
  });

  it("block-start backspace at a PLAIN paragraph boundary marks a suggested JOIN (blocks stay separate, embed on prev block N, deletion record, caret unchanged, undoable)", () => {
    const { editor, firstId, secondId } = twoParagraphs();
    const placed = caretAt(editor, secondId, 0); // caret at start of "def"

    const next = reduceEditor(placed, { type: "DELETE_BACKWARD" }, suggestingConfig);

    // Blocks stay SEPARATE — NO real merge happened.
    expect(getBlock(next.state, firstId)?.id).toBe(firstId);
    expect(getBlock(next.state, secondId)?.id).toBe(secondId);
    expect(getTextOf(next.state, firstId)).toBe("abc");
    expect(getTextOf(next.state, secondId)).toBe("def");

    // The prev block N ("abc") ends with the zero-width join-suggestion embed.
    expect(endsWithJoinEmbed(next, firstId)).toBe(true);

    // A `deletion` SuggestionRecord exists (attributed to alice).
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");

    // The caret stays at currentBlock:0 (no merge happened).
    expect(next.selection.anchor).toEqual(next.selection.focus);
    expect(next.selection.focus).toEqual(createPosition(secondId, 0));

    // Undoable: UNDO removes the embed + record, blocks unchanged.
    expect(next.history.canUndo()).toBe(true);
    const undone = reduceEditor(next, { type: "UNDO" }, suggestingConfig);
    expect(endsWithJoinEmbed(undone, firstId)).toBe(false);
    expect(getSuggestions(undone.state)).toHaveLength(0);
    expect(getTextOf(undone.state, firstId)).toBe("abc");
    expect(getTextOf(undone.state, secondId)).toBe("def");
  });

  it("direct mode (regression): the SAME block-start backspace really MERGES the two blocks", () => {
    const { editor, firstId, secondId } = twoParagraphs();
    const placed = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(secondId, 0), createPosition(secondId, 0)),
      },
      directConfig,
    );

    const next = reduceEditor(placed, { type: "DELETE_BACKWARD" }, directConfig);

    // Real merge: block N now holds "abcdef"; the second block is gone.
    expect(getTextOf(next.state, firstId)).toBe("abcdef");
    expect(getBlock(next.state, secondId)).toBeNull();
    // Caret lands at the merge seam (prevBlock:3).
    expect(next.selection.focus).toEqual(createPosition(firstId, 3));
    expect(getSuggestions(next.state)).toHaveLength(0);
  });

  it("backspacing over one's OWN suggested-insertion REMOVES it for real (no deletion record; the spent insertion record orphans)", () => {
    // Type "abc" in SUGGESTING mode → one insertion record covering "abc".
    let s = createInitialEditorState(suggestingConfig);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, suggestingConfig);
    const paraId = bodyParaId(s);
    const inserted = getSuggestions(s.state);
    expect(inserted).toHaveLength(1);
    expect(nth(inserted, 0, "suggestion").kind).toBe("insertion");
    expect(nth(inserted, 0, "suggestion").author).toBe("alice");
    const insId = nth(inserted, 0, "suggestion").id;

    // Backspace 3× — each char is THIS author's own un-accepted insertion, so it
    // is removed for REAL (not soft-deleted): deleting your own pending insertion
    // un-does it rather than stacking a contradictory deletion-on-insertion.
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, suggestingConfig);
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, suggestingConfig);
    s = reduceEditor(s, { type: "DELETE_BACKWARD" }, suggestingConfig);

    // Text is gone (real removal, NOT a struck-through soft delete).
    expect(getTextOf(s.state, paraId)).toBe("");
    // No deletion record was ever written (own-insertion removal short-circuits it).
    const after = getSuggestions(s.state);
    expect(after.filter((sg) => sg.kind === "deletion")).toHaveLength(0);
    // The spent insertion record survives in the map but tags no item → orphaned.
    const spent = after.find((sg) => sg.id === insId);
    expect(spent?.kind).toBe("insertion");
    expect(spent?.orphaned).toBe(true);
    expect(spent?.range).toBeNull();
  });

  it("block-start backspace in a LIST-ITEM still OUTDENTS/UNLISTS in suggesting mode (not a join — proves the gate reorder)", () => {
    // One paragraph "abc", made into a top-level unordered list item, caret at start.
    let s = createInitialEditorState(directConfig);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, directConfig);
    s = reduceEditor(s, { type: "TOGGLE_LIST", listType: "unordered" }, directConfig);
    const root = getBlock(s.state, s.state.rootId);
    const itemId = root?.firstChildId ?? null;
    if (itemId === null) throw new Error("expected a list item");
    expect(getBlock(s.state, itemId)?.type).toBe("list-item");
    const placed = caretAt(s, itemId, 0);

    const next = reduceEditor(placed, { type: "DELETE_BACKWARD" }, suggestingConfig);

    // A top-level list item unlists into a plain paragraph (NOT a join suggestion).
    expect(getBlock(next.state, itemId)?.type).toBe("paragraph");
    expect(endsWithJoinEmbed(next, itemId)).toBe(false);
    expect(getSuggestions(next.state)).toHaveLength(0);
  });
});
