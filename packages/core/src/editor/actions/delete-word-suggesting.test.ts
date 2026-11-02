/**
 * Change-tracking slice 4c-iii: DELETE_WORD branches for suggesting mode.
 *
 * Behavior-level tests through the real reducer. In suggesting mode
 * (`EditorConfig.suggestingAuthor` non-null) a word delete SOFT-deletes — it
 * stamps the in-range runs with a `deletionSuggestionId` (the text STAYS,
 * struck-through) via `markDeletion` (the shared `deleteRangeOrSuggest` helper)
 * instead of really removing it.
 *
 * Directional caret rule (mirrors 4c-i/4c-ii): a soft-delete leaves the caret on
 * the FAR edge of the struck span in the deletion direction. BACKWARD → span
 * START (the word-boundary before the caret = `target`); FORWARD → span END (the
 * word-boundary past the caret = `target`) so a repeated forward word-delete
 * strikes the NEXT word rather than re-targeting the already-struck text
 * (markDeletion coalesces → no-op). Direct (non-suggesting) deletes keep the
 * existing caret (content shrank): backward → `target`, forward → `pos`.
 *
 * DELETE_WORD is structurally simple — a cross-block word delete is already a
 * NO-OP in BOTH modes (no merge path), so there is no structural gate.
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
import { getBlock, getSuggestions, type BlockId } from "../../state";

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
  editor.setConfig(suggestingConfig);
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
  editor.setConfig(suggestingConfig);
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

/** Seed a single paragraph with `text` typed in (direct mode), caret at end. */
function seed(text: string): Editor {
  const editor = createEditor(directConfig);
  editor.dispatch({ type: "INSERT_TEXT", text });
  return editor;
}

describe("handleDeleteWord — suggesting mode (slice 4c-iii)", () => {
  it("backward word-delete: SOFT-deletes the word before the caret (tagged, text intact, caret at word start)", () => {
    // "hello world": word boundary before offset 11 is "world" start = 6.
    const seeded = seed("hello world");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 11); // caret at end

    placed.dispatch({ type: "DELETE_WORD", direction: "backward" });

    // Text intact; "world" (indices 6..10) carries the deletion id.
    expect(getTextOf(placed.document, paraId)).toBe("hello world");
    const suggestions = getSuggestions(placed.document);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");
    expect(deletionIdAt(placed, paraId, 6)).toBe(nth(suggestions, 0, "suggestion").id);
    expect(deletionIdAt(placed, paraId, 10)).toBe(nth(suggestions, 0, "suggestion").id);
    // "hello " (indices 0..5) untouched.
    expect(deletionIdAt(placed, paraId, 5)).toBeUndefined();
    // Caret collapses to the word START (offset 6 = `target`).
    expect(placed.selection.anchor).toEqual(placed.selection.focus);
    expect(placed.selection.focus.blockId).toBe(paraId);
    expect(placed.selection.focus.offset).toBe(6);
  });

  it("forward word-delete: strikes the word after the caret AND advances past it (repeated delete strikes the NEXT word)", () => {
    // "hello world": forward boundary from 0 = end of "hello" = 5.
    const seeded = seed("hello world");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 0); // caret before "hello"

    placed.dispatch({ type: "DELETE_WORD", direction: "forward" });

    // "hello" (0..4) struck, text intact; caret advanced to the word END (5).
    expect(getTextOf(placed.document, paraId)).toBe("hello world");
    expect(deletionIdAt(placed, paraId, 0)).toBeDefined();
    expect(deletionIdAt(placed, paraId, 4)).toBeDefined();
    expect(deletionIdAt(placed, paraId, 5)).toBeUndefined();
    expect(placed.selection.focus.offset).toBe(5);

    // A SECOND forward word-delete from offset 5 strikes the NEXT word (" world",
    // 5..10). If the caret had NOT advanced (stayed at 0), markDeletion would
    // re-target the already-struck "hello" and coalesce/no-op, leaving " world"
    // unstruck — so " world"-is-struck IS the proof the caret advanced.
    placed.dispatch({ type: "DELETE_WORD", direction: "forward" });
    expect(getTextOf(placed.document, paraId)).toBe("hello world");
    expect(deletionIdAt(placed, paraId, 6)).toBeDefined();
    expect(deletionIdAt(placed, paraId, 10)).toBeDefined();
    // Two ADJACENT same-author deletions coalesce into ONE record (reused id).
    expect(deletionIdAt(placed, paraId, 6)).toBe(deletionIdAt(placed, paraId, 0));
    const suggestions = getSuggestions(placed.document);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    // Caret advanced to the end of "world" (offset 11).
    expect(placed.selection.focus.offset).toBe(11);
  });

  it("is undoable: UNDO reverts a suggesting word-delete (no deletion id, no record)", () => {
    const seeded = seed("hello world");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 11);
    placed.dispatch({ type: "DELETE_WORD", direction: "backward" });

    expect(placed.history.canUndo()).toBe(true);

    placed.dispatch({ type: "UNDO" });
    expect(getTextOf(placed.document, paraId)).toBe("hello world");
    expect(deletionIdAt(placed, paraId, 6)).toBeUndefined();
    expect(getSuggestions(placed.document)).toHaveLength(0);
  });

  it("direct mode (regression): the SAME word-delete REMOVES the word, caret per the existing rule, no suggestion", () => {
    // Backward direct delete: removes "world", caret at the word start (target = 6).
    {
      const seeded = seed("hello world");
      const paraId = bodyParaId(seeded);
      seeded.dispatch({
          type: "SET_SELECTION",
          selection: createSpan(createPosition(paraId, 11), createPosition(paraId, 11)),
        });
      seeded.dispatch({ type: "DELETE_WORD", direction: "backward" });
      expect(getTextOf(seeded.document, paraId)).toBe("hello ");
      expect(seeded.selection.focus.offset).toBe(6);
      expect(getSuggestions(seeded.document)).toHaveLength(0);
    }

    // Forward direct delete: removes "hello", caret STAYS at pos (0).
    {
      const seeded = seed("hello world");
      const paraId = bodyParaId(seeded);
      seeded.dispatch({
          type: "SET_SELECTION",
          selection: createSpan(createPosition(paraId, 0), createPosition(paraId, 0)),
        });
      seeded.dispatch({ type: "DELETE_WORD", direction: "forward" });
      expect(getTextOf(seeded.document, paraId)).toBe(" world");
      expect(seeded.selection.focus.offset).toBe(0);
      expect(getSuggestions(seeded.document)).toHaveLength(0);
    }
  });

  it("expanded-selection word-delete: forward → caret at span END, backward → caret at span START (text intact, struck)", () => {
    // Forward over a selection.
    {
      const seeded = seed("abcdef");
      const paraId = bodyParaId(seeded);
      const selected = select(seeded, paraId, 1, 4); // select "bcd"
      selected.dispatch({ type: "DELETE_WORD", direction: "forward" });
      expect(getTextOf(selected.document, paraId)).toBe("abcdef");
      const suggestions = getSuggestions(selected.document);
      expect(suggestions).toHaveLength(1);
      expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
      expect(deletionIdAt(selected, paraId, 1)).toBe(nth(suggestions, 0, "suggestion").id);
      expect(deletionIdAt(selected, paraId, 3)).toBe(nth(suggestions, 0, "suggestion").id);
      expect(deletionIdAt(selected, paraId, 0)).toBeUndefined();
      expect(deletionIdAt(selected, paraId, 4)).toBeUndefined();
      // Caret at the selection END (offset 4 = span END).
      expect(selected.selection.focus.offset).toBe(4);
    }

    // Backward over a selection.
    {
      const seeded = seed("abcdef");
      const paraId = bodyParaId(seeded);
      const selected = select(seeded, paraId, 1, 4); // select "bcd"
      selected.dispatch({ type: "DELETE_WORD", direction: "backward" });
      expect(getTextOf(selected.document, paraId)).toBe("abcdef");
      expect(deletionIdAt(selected, paraId, 1)).toBeDefined();
      expect(deletionIdAt(selected, paraId, 3)).toBeDefined();
      // Caret at the selection START (offset 1 = span start).
      expect(selected.selection.focus.offset).toBe(1);
    }
  });

  it("cross-block word-delete is a NO-OP in BOTH modes (no suggestion in suggesting mode)", () => {
    // Two paragraphs "abc" / "def"; caret at the START of the 2nd (offset 0).
    let s = createEditor(directConfig);
    s.dispatch({ type: "INSERT_TEXT", text: "abc" });
    s.dispatch({ type: "SPLIT_NODE" });
    s.dispatch({ type: "INSERT_TEXT", text: "def" });

    const root = getBlock(s.document, finalSectionOf(s.document));
    const secondId = root?.lastChildId ?? null;
    if (secondId === null) {
      throw new Error("expected a second paragraph");
    }

    // Direct mode: backward word-delete at block start = NO-OP.
    s.dispatch({
        type: "SET_SELECTION",
        selection: createSpan(createPosition(secondId, 0), createPosition(secondId, 0)),
      });
    const before = s.snapshot();
    s.dispatch({ type: "DELETE_WORD", direction: "backward" });
    expect(s.document).toBe(before.document);
    expect(s.selection).toBe(before.selection);

    // Suggesting mode: same NO-OP, no suggestion record minted.
    const placedSuggest = caretAt(s, secondId, 0);
    const before2 = placedSuggest.snapshot();
    placedSuggest.dispatch({ type: "DELETE_WORD", direction: "backward" });
    expect(placedSuggest.document).toBe(before2.document);
    expect(placedSuggest.selection).toBe(before2.selection);
    expect(getSuggestions(placedSuggest.document)).toHaveLength(0);
  });
});
