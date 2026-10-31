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
 * suggested JOIN via `markBlockJoinSuggestion` — a `deletionSuggestionId` tag on
 * the current (right) block's registry entry + a `deletion` record, with the two
 * blocks staying SEPARATE (no merge) and the caret unchanged. The list-item-outdent
 * branch keeps its untracked behavior in suggesting mode; a section boundary is a
 * tracked section join (`markSectionJoinSuggestion`).
 */
import { finalSectionOf } from "../../test-utils/document-builders";
import { describe, it, expect } from "vitest";
import {
  config as directConfig,
  createPosition,
  createSpan,
  getTextOf,
  createEditor,
  type EditorConfig,
  type Editor,
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
  type BlockId,
} from "../../state";

/** The first body paragraph id under the document root. */
function bodyParaId(editor: Editor): BlockId {
  const root = getBlock(editor.document, finalSectionOf(editor.document));
  const id = root?.firstChildId;
  if (id === undefined || id === null) {
    throw new Error("document root has no first child paragraph");
  }
  return id;
}

/** A suggesting-mode config attributed to "alice" (direct config + author). */
const suggestingConfig: EditorConfig = { ...directConfig, suggestingAuthor: "alice" };

/** Place a collapsed caret at `offset` of `paraId` (suggesting config). */
function caretAt(editor: Editor, paraId: BlockId, offset: number): Editor {
  editor.config = suggestingConfig;
  editor.dispatch({
    type: "SET_SELECTION",
    selection: createSpan(createPosition(paraId, offset), createPosition(paraId, offset)),
  });
  return editor;
}

/** Select `[start, end)` of `paraId` (suggesting config). */
function select(
  editor: Editor,
  paraId: BlockId,
  start: number,
  end: number,
): Editor {
  editor.config = suggestingConfig;
  editor.dispatch({
    type: "SET_SELECTION",
    selection: createSpan(createPosition(paraId, start), createPosition(paraId, end)),
  });
  return editor;
}

/** The `deletionSuggestionId` carried by the run at character index `idx`, or
 *  `undefined` if no text run covers it / the run carries no deletion id. */
function deletionIdAt(
  editor: Editor,
  paraId: BlockId,
  idx: number,
): unknown {
  const items = getBlock(editor.document, paraId)?.inlineContent?.items ?? [];
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

/** True if `blockId` carries a paragraph-join tag (the boundary at its start). */
function joinTagged(editor: Editor, blockId: BlockId): boolean {
  return getBlock(editor.document, blockId)?.breakSuggestion?.deletionId !== undefined;
}

/** Seed a single paragraph with `text` typed in (direct mode), caret at end. */
function seed(text: string): Editor {
  const editor = createEditor(directConfig);
  editor.dispatch({ type: "INSERT_TEXT", text });
  return editor;
}

/** Build two plain paragraphs ("abc" then "def") in direct mode; returns the
 *  editor + both block ids. */
function twoParagraphs(): {
  editor: Editor;
  firstId: BlockId;
  secondId: BlockId;
} {
  let s = createEditor(directConfig);
  s.dispatch({ type: "INSERT_TEXT", text: "abc" });
  s.dispatch({ type: "SPLIT_NODE" });
  s.dispatch({ type: "INSERT_TEXT", text: "def" });
  const root = getBlock(s.document, finalSectionOf(s.document));
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

    placed.dispatch({ type: "DELETE_BACKWARD" });

    // Text is UNCHANGED — soft delete keeps the struck char.
    expect(getTextOf(placed.document, paraId)).toBe("abc");
    // The char before the caret ("c", index 2) carries the deletion id.
    const suggestions = getSuggestions(placed.document);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");
    expect(deletionIdAt(placed, paraId, 2)).toBe(nth(suggestions, 0, "suggestion").id);
    // "a"/"b" (indices 0/1) are untouched.
    expect(deletionIdAt(placed, paraId, 0)).toBeUndefined();
    // The caret collapses to the position BEFORE the struck char (offset 2).
    expect(placed.selection.anchor).toEqual(placed.selection.focus);
    expect(placed.selection.focus.blockId).toBe(paraId);
    expect(placed.selection.focus.offset).toBe(2);
  });

  it("is undoable: UNDO reverts the soft-delete (no deletion id, no record)", () => {
    const seeded = seed("abc");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 3);
    placed.dispatch({ type: "DELETE_BACKWARD" });

    expect(placed.history.canUndo()).toBe(true);

    placed.dispatch({ type: "UNDO" });
    expect(getTextOf(placed.document, paraId)).toBe("abc");
    expect(deletionIdAt(placed, paraId, 2)).toBeUndefined();
    expect(getSuggestions(placed.document)).toHaveLength(0);
  });

  it("expanded selection: SOFT-deletes every run in the span (tagged, text intact, caret at span start)", () => {
    const seeded = seed("abcdef");
    const paraId = bodyParaId(seeded);
    const selected = select(seeded, paraId, 1, 4); // select "bcd"

    selected.dispatch({ type: "DELETE_BACKWARD" });

    // Text intact; "bcd" (indices 1..3) carry the deletion id; "a"/"e"/"f" do not.
    expect(getTextOf(selected.document, paraId)).toBe("abcdef");
    const suggestions = getSuggestions(selected.document);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");
    expect(deletionIdAt(selected, paraId, 1)).toBe(nth(suggestions, 0, "suggestion").id);
    expect(deletionIdAt(selected, paraId, 2)).toBe(nth(suggestions, 0, "suggestion").id);
    expect(deletionIdAt(selected, paraId, 3)).toBe(nth(suggestions, 0, "suggestion").id);
    expect(deletionIdAt(selected, paraId, 0)).toBeUndefined();
    expect(deletionIdAt(selected, paraId, 4)).toBeUndefined();
    // Caret collapses to the selection START (offset 1).
    expect(selected.selection.anchor).toEqual(selected.selection.focus);
    expect(selected.selection.focus.blockId).toBe(paraId);
    expect(selected.selection.focus.offset).toBe(1);
  });

  it("direct mode (regression): the SAME mid-block backspace REMOVES the char, no suggestion", () => {
    const seeded = seed("abc");
    const paraId = bodyParaId(seeded);
    seeded.dispatch({
        type: "SET_SELECTION",
        selection: createSpan(createPosition(paraId, 3), createPosition(paraId, 3)),
      });

    seeded.dispatch({ type: "DELETE_BACKWARD" });

    // Direct delete: the char is REALLY removed (text shrinks), no deletion record.
    expect(getTextOf(seeded.document, paraId)).toBe("ab");
    expect(getSuggestions(seeded.document)).toHaveLength(0);
  });

  it("block-start backspace at a PLAIN paragraph boundary marks a suggested JOIN (blocks stay separate, join tag on the current block, deletion record, caret unchanged, undoable)", () => {
    const { editor, firstId, secondId } = twoParagraphs();
    const placed = caretAt(editor, secondId, 0); // caret at start of "def"

    placed.dispatch({ type: "DELETE_BACKWARD" });

    // Blocks stay SEPARATE — NO real merge happened.
    expect(getBlock(placed.document, firstId)?.id).toBe(firstId);
    expect(getBlock(placed.document, secondId)?.id).toBe(secondId);
    expect(getTextOf(placed.document, firstId)).toBe("abc");
    expect(getTextOf(placed.document, secondId)).toBe("def");

    // The current block ("def") carries the join tag; the prev block N does not.
    // The key is on ¶first (the ¶ Backspace at (second, 0) deletes).
    expect(joinTagged(placed, firstId)).toBe(true);
    expect(joinTagged(placed, secondId)).toBe(false);

    // A `deletion` SuggestionRecord exists (attributed to alice).
    const suggestions = getSuggestions(placed.document);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");

    // The caret stays at currentBlock:0 (no merge happened).
    expect(placed.selection.anchor).toEqual(placed.selection.focus);
    expect(placed.selection.focus).toEqual(createPosition(secondId, 0));

    // Undoable: UNDO removes the tag + record, blocks unchanged.
    expect(placed.history.canUndo()).toBe(true);
    placed.dispatch({ type: "UNDO" });
    expect(joinTagged(placed, firstId)).toBe(false);
    expect(getSuggestions(placed.document)).toHaveLength(0);
    expect(getTextOf(placed.document, firstId)).toBe("abc");
    expect(getTextOf(placed.document, secondId)).toBe("def");
  });

  it("direct mode (regression): the SAME block-start backspace really MERGES the two blocks", () => {
    const { editor, firstId, secondId } = twoParagraphs();
    editor.dispatch({
        type: "SET_SELECTION",
        selection: createSpan(createPosition(secondId, 0), createPosition(secondId, 0)),
      });

    editor.dispatch({ type: "DELETE_BACKWARD" });

    // Real merge: block N now holds "abcdef"; the second block is gone.
    // Survivor R: the second paragraph holds the joined text.
    expect(getTextOf(editor.document, secondId)).toBe("abcdef");
    expect(getBlock(editor.document, firstId)).toBeNull();
    // Caret lands at the merge seam (prevBlock:3).
    expect(editor.selection.focus).toEqual(createPosition(secondId, 3));
    expect(getSuggestions(editor.document)).toHaveLength(0);
  });

  it("backspacing over one's OWN suggested-insertion REMOVES it for real (no deletion record; the spent insertion record orphans)", () => {
    // Type "abc" in SUGGESTING mode → one insertion record covering "abc".
    let s = createEditor(suggestingConfig);
    s.dispatch({ type: "INSERT_TEXT", text: "abc" });
    const paraId = bodyParaId(s);
    const inserted = getSuggestions(s.document);
    expect(inserted).toHaveLength(1);
    expect(nth(inserted, 0, "suggestion").kind).toBe("insertion");
    expect(nth(inserted, 0, "suggestion").author).toBe("alice");
    const insId = nth(inserted, 0, "suggestion").id;

    // Backspace 3× — each char is THIS author's own un-accepted insertion, so it
    // is removed for REAL (not soft-deleted): deleting your own pending insertion
    // un-does it rather than stacking a contradictory deletion-on-insertion.
    s.dispatch({ type: "DELETE_BACKWARD" });
    s.dispatch({ type: "DELETE_BACKWARD" });
    s.dispatch({ type: "DELETE_BACKWARD" });

    // Text is gone (real removal, NOT a struck-through soft delete).
    expect(getTextOf(s.document, paraId)).toBe("");
    // No deletion record was ever written (own-insertion removal short-circuits it).
    const after = getSuggestions(s.document);
    expect(after.filter((sg) => sg.kind === "deletion")).toHaveLength(0);
    // The spent insertion record tags no item → never surfaced.
    expect(after.find((sg) => sg.id === insId)).toBeUndefined();
  });

  it("block-start backspace in a LIST-ITEM still OUTDENTS/UNLISTS in suggesting mode (not a join — proves the gate reorder)", () => {
    // One paragraph "abc", made into a top-level unordered list item, caret at start.
    let s = createEditor(directConfig);
    s.dispatch({ type: "INSERT_TEXT", text: "abc" });
    s.dispatch({ type: "TOGGLE_LIST", listType: "unordered" });
    const root = getBlock(s.document, finalSectionOf(s.document));
    const itemId = root?.firstChildId ?? null;
    if (itemId === null) throw new Error("expected a list item");
    expect(getBlock(s.document, itemId)?.type).toBe("list-item");
    const placed = caretAt(s, itemId, 0);

    placed.dispatch({ type: "DELETE_BACKWARD" });

    // A top-level list item unlists into a plain paragraph (NOT a join suggestion).
    expect(getBlock(placed.document, itemId)?.type).toBe("paragraph");
    expect(joinTagged(placed, itemId)).toBe(false);
    expect(getSuggestions(placed.document)).toHaveLength(0);
  });
});

describe("caret-only outcomes (already struck runs / steps): nothing written, caret moves, no undo entry", () => {
  const bob: EditorConfig = { ...directConfig, suggestingAuthor: "bob" };

  it("Backspace / Delete over a run struck by ANOTHER author writes nothing and moves the caret", () => {
    const seeded = seed("abc");
    const p = bodyParaId(seeded);
    // alice strikes "b".
    const struck = caretAt(seeded, p, 2);
    struck.dispatch({ type: "DELETE_BACKWARD" });
    const aliceId = deletionIdAt(struck, p, 1);
    expect(typeof aliceId).toBe("string");
    // bob backspaces over the struck "b": untouched, caret before it.
    struck.config = bob;
    struck.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(p, 2), createPosition(p, 2)) });
    const before = { ...struck };
    struck.dispatch({ type: "DELETE_BACKWARD" });
    expect(struck.document).toBe(before.document);
    expect(deletionIdAt(struck, p, 1)).toBe(aliceId);
    expect(getSuggestions(struck.document)).toHaveLength(1);
    expect(struck.selection.focus).toEqual(createPosition(p, 1));
    // Delete forward from before "b": same, caret after it.
    struck.config = bob;
    struck.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(p, 1), createPosition(p, 1)) });
    const before2 = { ...struck };
    struck.dispatch({ type: "DELETE_FORWARD" });
    expect(struck.document).toBe(before2.document);
    expect(struck.selection.focus).toEqual(createPosition(p, 2));
  });

  it("Backspace / Delete on a ¶ that carries a live deletion writes nothing, moves across the ¶, and adds NO undo entry", () => {
    const { editor, firstId, secondId } = twoParagraphs();
    const joined = caretAt(editor, secondId, 0);
    joined.dispatch({ type: "DELETE_BACKWARD" });
    expect(joinTagged(joined, firstId)).toBe(true);
    // Second Backspace (another author): caret to (first, len), state unchanged.
    joined.config = bob;
    joined.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(secondId, 0), createPosition(secondId, 0)) });
    const before = { ...joined };
    joined.dispatch({ type: "DELETE_BACKWARD" });
    expect(joined.document).toBe(before.document);
    expect(joined.selection.focus).toEqual(createPosition(firstId, 3));
    // Delete at (first, len) over the joined step: caret to (second, 0).
    joined.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(firstId, 3), createPosition(firstId, 3)) });
    const before2 = { ...joined };
    joined.dispatch({ type: "DELETE_FORWARD" });
    expect(joined.document).toBe(before2.document);
    expect(joined.selection.focus).toEqual(createPosition(secondId, 0));
    // The following undo reverts the PREVIOUS edit (the join), not a no-op entry.
    joined.dispatch({ type: "UNDO" });
    expect(joinTagged(joined, firstId)).toBe(false);
  });
});
