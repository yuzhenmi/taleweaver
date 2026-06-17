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

/** Seed a single paragraph with `text` typed in (direct mode), caret at end. */
function seed(text: string): EditorState {
  return reduceEditor(
    createInitialEditorState(directConfig),
    { type: "INSERT_TEXT", text },
    directConfig,
  );
}

describe("handleDeleteWord — suggesting mode (slice 4c-iii)", () => {
  it("backward word-delete: SOFT-deletes the word before the caret (tagged, text intact, caret at word start)", () => {
    // "hello world": word boundary before offset 11 is "world" start = 6.
    const seeded = seed("hello world");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 11); // caret at end

    const next = reduceEditor(
      placed,
      { type: "DELETE_WORD", direction: "backward" },
      suggestingConfig,
    );

    // Text intact; "world" (indices 6..10) carries the deletion id.
    expect(getTextOf(next.state, paraId)).toBe("hello world");
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");
    expect(deletionIdAt(next, paraId, 6)).toBe(nth(suggestions, 0, "suggestion").id);
    expect(deletionIdAt(next, paraId, 10)).toBe(nth(suggestions, 0, "suggestion").id);
    // "hello " (indices 0..5) untouched.
    expect(deletionIdAt(next, paraId, 5)).toBeUndefined();
    // Caret collapses to the word START (offset 6 = `target`).
    expect(next.selection.anchor).toEqual(next.selection.focus);
    expect(next.selection.focus.blockId).toBe(paraId);
    expect(next.selection.focus.offset).toBe(6);
  });

  it("forward word-delete: strikes the word after the caret AND advances past it (repeated delete strikes the NEXT word)", () => {
    // "hello world": forward boundary from 0 = end of "hello" = 5.
    const seeded = seed("hello world");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 0); // caret before "hello"

    const once = reduceEditor(
      placed,
      { type: "DELETE_WORD", direction: "forward" },
      suggestingConfig,
    );

    // "hello" (0..4) struck, text intact; caret advanced to the word END (5).
    expect(getTextOf(once.state, paraId)).toBe("hello world");
    expect(deletionIdAt(once, paraId, 0)).toBeDefined();
    expect(deletionIdAt(once, paraId, 4)).toBeDefined();
    expect(deletionIdAt(once, paraId, 5)).toBeUndefined();
    expect(once.selection.focus.offset).toBe(5);

    // A SECOND forward word-delete from offset 5 strikes the NEXT word (" world",
    // 5..10). If the caret had NOT advanced (stayed at 0), markDeletion would
    // re-target the already-struck "hello" and coalesce/no-op, leaving " world"
    // unstruck — so " world"-is-struck IS the proof the caret advanced.
    const twice = reduceEditor(
      once,
      { type: "DELETE_WORD", direction: "forward" },
      suggestingConfig,
    );
    expect(getTextOf(twice.state, paraId)).toBe("hello world");
    expect(deletionIdAt(twice, paraId, 6)).toBeDefined();
    expect(deletionIdAt(twice, paraId, 10)).toBeDefined();
    // Two ADJACENT same-author deletions coalesce into ONE record (reused id).
    expect(deletionIdAt(twice, paraId, 6)).toBe(deletionIdAt(twice, paraId, 0));
    const suggestions = getSuggestions(twice.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    // Caret advanced to the end of "world" (offset 11).
    expect(twice.selection.focus.offset).toBe(11);
  });

  it("is undoable: UNDO reverts a suggesting word-delete (no deletion id, no record)", () => {
    const seeded = seed("hello world");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 11);
    const struck = reduceEditor(
      placed,
      { type: "DELETE_WORD", direction: "backward" },
      suggestingConfig,
    );

    expect(struck.history.canUndo()).toBe(true);

    const undone = reduceEditor(struck, { type: "UNDO" }, suggestingConfig);
    expect(getTextOf(undone.state, paraId)).toBe("hello world");
    expect(deletionIdAt(undone, paraId, 6)).toBeUndefined();
    expect(getSuggestions(undone.state)).toHaveLength(0);
  });

  it("direct mode (regression): the SAME word-delete REMOVES the word, caret per the existing rule, no suggestion", () => {
    // Backward direct delete: removes "world", caret at the word start (target = 6).
    {
      const seeded = seed("hello world");
      const paraId = bodyParaId(seeded);
      const placed = reduceEditor(
        seeded,
        {
          type: "SET_SELECTION",
          selection: createSpan(createPosition(paraId, 11), createPosition(paraId, 11)),
        },
        directConfig,
      );
      const next = reduceEditor(
        placed,
        { type: "DELETE_WORD", direction: "backward" },
        directConfig,
      );
      expect(getTextOf(next.state, paraId)).toBe("hello ");
      expect(next.selection.focus.offset).toBe(6);
      expect(getSuggestions(next.state)).toHaveLength(0);
    }

    // Forward direct delete: removes "hello", caret STAYS at pos (0).
    {
      const seeded = seed("hello world");
      const paraId = bodyParaId(seeded);
      const placed = reduceEditor(
        seeded,
        {
          type: "SET_SELECTION",
          selection: createSpan(createPosition(paraId, 0), createPosition(paraId, 0)),
        },
        directConfig,
      );
      const next = reduceEditor(
        placed,
        { type: "DELETE_WORD", direction: "forward" },
        directConfig,
      );
      expect(getTextOf(next.state, paraId)).toBe(" world");
      expect(next.selection.focus.offset).toBe(0);
      expect(getSuggestions(next.state)).toHaveLength(0);
    }
  });

  it("expanded-selection word-delete: forward → caret at span END, backward → caret at span START (text intact, struck)", () => {
    // Forward over a selection.
    {
      const seeded = seed("abcdef");
      const paraId = bodyParaId(seeded);
      const selected = select(seeded, paraId, 1, 4); // select "bcd"
      const next = reduceEditor(
        selected,
        { type: "DELETE_WORD", direction: "forward" },
        suggestingConfig,
      );
      expect(getTextOf(next.state, paraId)).toBe("abcdef");
      const suggestions = getSuggestions(next.state);
      expect(suggestions).toHaveLength(1);
      expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
      expect(deletionIdAt(next, paraId, 1)).toBe(nth(suggestions, 0, "suggestion").id);
      expect(deletionIdAt(next, paraId, 3)).toBe(nth(suggestions, 0, "suggestion").id);
      expect(deletionIdAt(next, paraId, 0)).toBeUndefined();
      expect(deletionIdAt(next, paraId, 4)).toBeUndefined();
      // Caret at the selection END (offset 4 = span END).
      expect(next.selection.focus.offset).toBe(4);
    }

    // Backward over a selection.
    {
      const seeded = seed("abcdef");
      const paraId = bodyParaId(seeded);
      const selected = select(seeded, paraId, 1, 4); // select "bcd"
      const next = reduceEditor(
        selected,
        { type: "DELETE_WORD", direction: "backward" },
        suggestingConfig,
      );
      expect(getTextOf(next.state, paraId)).toBe("abcdef");
      expect(deletionIdAt(next, paraId, 1)).toBeDefined();
      expect(deletionIdAt(next, paraId, 3)).toBeDefined();
      // Caret at the selection START (offset 1 = span start).
      expect(next.selection.focus.offset).toBe(1);
    }
  });

  it("cross-block word-delete is a NO-OP in BOTH modes (no suggestion in suggesting mode)", () => {
    // Two paragraphs "abc" / "def"; caret at the START of the 2nd (offset 0).
    let s = createInitialEditorState(directConfig);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "abc" }, directConfig);
    s = reduceEditor(s, { type: "SPLIT_NODE" }, directConfig);
    s = reduceEditor(s, { type: "INSERT_TEXT", text: "def" }, directConfig);

    const root = getBlock(s.state, s.state.rootId);
    const secondId = root?.lastChildId ?? null;
    if (secondId === null) {
      throw new Error("expected a second paragraph");
    }

    // Direct mode: backward word-delete at block start = NO-OP.
    const placedDirect = reduceEditor(
      s,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(secondId, 0), createPosition(secondId, 0)),
      },
      directConfig,
    );
    const directNext = reduceEditor(
      placedDirect,
      { type: "DELETE_WORD", direction: "backward" },
      directConfig,
    );
    expect(directNext).toBe(placedDirect);

    // Suggesting mode: same NO-OP, no suggestion record minted.
    const placedSuggest = caretAt(s, secondId, 0);
    const suggestNext = reduceEditor(
      placedSuggest,
      { type: "DELETE_WORD", direction: "backward" },
      suggestingConfig,
    );
    expect(suggestNext).toBe(placedSuggest);
    expect(getSuggestions(suggestNext.state)).toHaveLength(0);
  });
});
