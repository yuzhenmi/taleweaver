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
 * JOIN via `markBlockJoinSuggestion` — a `deletionSuggestionId` tag on the NEXT
 * (right) block's registry entry + a `deletion` record, with the two blocks staying
 * SEPARATE (no merge) and the caret unchanged. A section boundary is a tracked
 * section join (`markSectionJoinSuggestion`).
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

describe("handleDeleteForward — suggesting mode (slice 4c-ii)", () => {
  it("mid-block Delete: SOFT-deletes the char at the caret (tag, text intact, caret AFTER it, one deletion record)", () => {
    const seeded = seed("abc");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 0); // caret before "abc"

    placed.dispatch({ type: "DELETE_FORWARD" });

    // Text is UNCHANGED — soft delete keeps the struck char.
    expect(getTextOf(placed.document, paraId)).toBe("abc");
    // The char at the caret ("a", index 0) carries the deletion id.
    const suggestions = getSuggestions(placed.document);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");
    expect(deletionIdAt(placed, paraId, 0)).toBe(nth(suggestions, 0, "suggestion").id);
    // "b"/"c" (indices 1/2) are untouched.
    expect(deletionIdAt(placed, paraId, 1)).toBeUndefined();
    // The caret advances to the position PAST the struck char (offset 1 = span END).
    expect(placed.selection.anchor).toEqual(placed.selection.focus);
    expect(placed.selection.focus.blockId).toBe(paraId);
    expect(placed.selection.focus.offset).toBe(1);
  });

  it("repeated Delete advances and strikes SUCCESSIVE chars (caret advanced past each strike)", () => {
    const seeded = seed("abc");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 0); // caret before "abc"

    placed.dispatch({ type: "DELETE_FORWARD" });
    placed.dispatch({ type: "DELETE_FORWARD" });

    // Text still intact; "a" (0) AND "b" (1) are both struck; "c" (2) is not.
    // If the caret had NOT advanced, the 2nd Delete would re-target the already-
    // struck char 0 (markDeletion coalesces → no-op) and char 1 would stay
    // UNSTRUCK — so char-1-is-struck IS the proof the caret advanced.
    expect(getTextOf(placed.document, paraId)).toBe("abc");
    const id0 = deletionIdAt(placed, paraId, 0);
    const id1 = deletionIdAt(placed, paraId, 1);
    expect(id0).toBeDefined();
    expect(id1).toBeDefined();
    expect(deletionIdAt(placed, paraId, 2)).toBeUndefined();
    // Two ADJACENT same-author deletions coalesce into ONE record (reused id), so
    // both struck chars carry the SAME deletion id.
    expect(id1).toBe(id0);
    const suggestions = getSuggestions(placed.document);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    // Caret advanced to offset 2 (past both strikes).
    expect(placed.selection.focus.offset).toBe(2);
  });

  it("is undoable: UNDO reverts the soft-delete (no deletion id, no record)", () => {
    const seeded = seed("abc");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 0);
    placed.dispatch({ type: "DELETE_FORWARD" });

    expect(placed.history.canUndo()).toBe(true);

    placed.dispatch({ type: "UNDO" });
    expect(getTextOf(placed.document, paraId)).toBe("abc");
    expect(deletionIdAt(placed, paraId, 0)).toBeUndefined();
    expect(getSuggestions(placed.document)).toHaveLength(0);
  });

  it("expanded selection: SOFT-deletes every run in the span (tagged, text intact, caret at span END)", () => {
    const seeded = seed("abcdef");
    const paraId = bodyParaId(seeded);
    const selected = select(seeded, paraId, 1, 4); // select "bcd"

    selected.dispatch({ type: "DELETE_FORWARD" });

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
    // Caret collapses to the selection END (offset 4 = span END).
    expect(selected.selection.anchor).toEqual(selected.selection.focus);
    expect(selected.selection.focus.blockId).toBe(paraId);
    expect(selected.selection.focus.offset).toBe(4);
  });

  it("direct mode (regression): the SAME mid-block Delete REMOVES the char, caret stays, no suggestion", () => {
    const seeded = seed("abc");
    const paraId = bodyParaId(seeded);
    seeded.dispatch({
        type: "SET_SELECTION",
        selection: createSpan(createPosition(paraId, 0), createPosition(paraId, 0)),
      });

    seeded.dispatch({ type: "DELETE_FORWARD" });

    // Direct delete: the char is REALLY removed (text shrinks), caret stays at pos.
    expect(getTextOf(seeded.document, paraId)).toBe("bc");
    expect(seeded.selection.focus.offset).toBe(0);
    expect(getSuggestions(seeded.document)).toHaveLength(0);
  });

  it("block-end Delete at a PLAIN paragraph boundary marks a suggested JOIN (blocks stay separate, join tag on the next block, deletion record, caret unchanged, undoable)", () => {
    const { editor, firstId, secondId } = twoParagraphs();
    const placed = caretAt(editor, firstId, 3); // caret at end of "abc"

    placed.dispatch({ type: "DELETE_FORWARD" });

    // Blocks stay SEPARATE — NO real merge happened.
    expect(getBlock(placed.document, firstId)?.id).toBe(firstId);
    expect(getBlock(placed.document, secondId)?.id).toBe(secondId);
    expect(getTextOf(placed.document, firstId)).toBe("abc");
    expect(getTextOf(placed.document, secondId)).toBe("def");

    // The NEXT block ("def") carries the join tag (the break AFTER currentBlock =
    // the boundary at nextBlock's start); the current block does not.
    // The key is on ¶first (the ¶ Delete at (first, len) deletes).
    expect(joinTagged(placed, firstId)).toBe(true);
    expect(joinTagged(placed, secondId)).toBe(false);

    // A `deletion` SuggestionRecord exists (attributed to alice).
    const suggestions = getSuggestions(placed.document);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");

    // The caret stays at currentBlock:currentLen (no merge happened).
    expect(placed.selection.anchor).toEqual(placed.selection.focus);
    expect(placed.selection.focus).toEqual(createPosition(firstId, 3));

    // Undoable: UNDO removes the tag + record, blocks unchanged.
    expect(placed.history.canUndo()).toBe(true);
    placed.dispatch({ type: "UNDO" });
    expect(joinTagged(placed, firstId)).toBe(false);
    expect(getSuggestions(placed.document)).toHaveLength(0);
    expect(getTextOf(placed.document, firstId)).toBe("abc");
    expect(getTextOf(placed.document, secondId)).toBe("def");
  });

  it("direct mode (regression): the SAME block-end Delete really MERGES the two blocks", () => {
    const { editor, firstId, secondId } = twoParagraphs();
    editor.dispatch({
        type: "SET_SELECTION",
        selection: createSpan(createPosition(firstId, 3), createPosition(firstId, 3)),
      });

    editor.dispatch({ type: "DELETE_FORWARD" });

    // Real merge: the second block (survivor R) holds "abcdef"; the first is gone.
    expect(getTextOf(editor.document, secondId)).toBe("abcdef");
    expect(getBlock(editor.document, firstId)).toBeNull();
    // Caret stays at currentBlock:currentLen (offset 3).
    expect(editor.selection.focus).toEqual(createPosition(secondId, 3));
    expect(getSuggestions(editor.document)).toHaveLength(0);
  });
});
