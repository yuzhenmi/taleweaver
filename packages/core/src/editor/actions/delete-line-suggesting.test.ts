/**
 * Change-tracking slice 4c-iii: DELETE_LINE branches for suggesting mode.
 *
 * Behavior-level tests through the real reducer. DELETE_LINE is BACKWARD-only
 * (deletes from `lineStart` to the caret). In suggesting mode
 * (`EditorConfig.suggestingAuthor` non-null) it SOFT-deletes — it stamps the
 * in-range runs with a `deletionSuggestionId` (the text STAYS, struck-through)
 * via `markDeletion` (the shared `deleteRangeOrSuggest` helper) instead of really
 * removing it. Because delete-line is backward-only the caret stays at the span
 * START (`lineStart`) in BOTH modes — there is no directional caret rule.
 *
 * DELETE_LINE is structurally simple — a cross-block line delete is already a
 * NO-OP in BOTH modes (line boundaries stay inside one block), so there is no
 * structural gate.
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

describe("handleDeleteLine — suggesting mode (slice 4c-iii)", () => {
  it("line-delete: SOFT-deletes lineStart→caret (tagged, text intact, caret at line start, one deletion record)", () => {
    // "hello" fits on one line (mock measurer 8px/char, 200px container) so the
    // whole block is one line; lineStart = offset 0.
    const seeded = seed("hello");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 5); // caret at end

    const next = reduceEditor(placed, { type: "DELETE_LINE" }, suggestingConfig);

    // Text intact; the whole line "hello" (0..4) carries the deletion id.
    expect(getTextOf(next.state, paraId)).toBe("hello");
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].kind).toBe("deletion");
    expect(suggestions[0].author).toBe("alice");
    expect(deletionIdAt(next, paraId, 0)).toBe(suggestions[0].id);
    expect(deletionIdAt(next, paraId, 4)).toBe(suggestions[0].id);
    // Caret collapses to the line START (offset 0).
    expect(next.selection.anchor).toEqual(next.selection.focus);
    expect(next.selection.focus.blockId).toBe(paraId);
    expect(next.selection.focus.offset).toBe(0);
  });

  it("is undoable: UNDO reverts a suggesting line-delete (no deletion id, no record)", () => {
    const seeded = seed("hello");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 5);
    const struck = reduceEditor(placed, { type: "DELETE_LINE" }, suggestingConfig);

    expect(struck.history.canUndo()).toBe(true);

    const undone = reduceEditor(struck, { type: "UNDO" }, suggestingConfig);
    expect(getTextOf(undone.state, paraId)).toBe("hello");
    expect(deletionIdAt(undone, paraId, 0)).toBeUndefined();
    expect(getSuggestions(undone.state)).toHaveLength(0);
  });

  it("direct mode (regression): the SAME line-delete REMOVES the line text, caret at line start, no suggestion", () => {
    const seeded = seed("hello");
    const paraId = bodyParaId(seeded);
    const placed = reduceEditor(
      seeded,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(paraId, 5), createPosition(paraId, 5)),
      },
      directConfig,
    );

    const next = reduceEditor(placed, { type: "DELETE_LINE" }, directConfig);

    expect(getTextOf(next.state, paraId)).toBe("");
    expect(next.selection.focus.offset).toBe(0);
    expect(getSuggestions(next.state)).toHaveLength(0);
  });

  it("expanded-selection line-delete: SOFT-deletes the selection, caret at span start (text intact, struck)", () => {
    const seeded = seed("abcdef");
    const paraId = bodyParaId(seeded);
    const selected = select(seeded, paraId, 1, 4); // select "bcd"

    const next = reduceEditor(selected, { type: "DELETE_LINE" }, suggestingConfig);

    expect(getTextOf(next.state, paraId)).toBe("abcdef");
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].kind).toBe("deletion");
    expect(deletionIdAt(next, paraId, 1)).toBe(suggestions[0].id);
    expect(deletionIdAt(next, paraId, 3)).toBe(suggestions[0].id);
    expect(deletionIdAt(next, paraId, 0)).toBeUndefined();
    expect(deletionIdAt(next, paraId, 4)).toBeUndefined();
    // Caret at the selection START (offset 1 = span start).
    expect(next.selection.anchor).toEqual(next.selection.focus);
    expect(next.selection.focus.blockId).toBe(paraId);
    expect(next.selection.focus.offset).toBe(1);
  });
});
