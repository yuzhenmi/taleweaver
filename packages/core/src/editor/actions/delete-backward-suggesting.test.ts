/**
 * Change-tracking slice 4c-i: DELETE_BACKWARD branches for suggesting mode.
 *
 * Behavior-level tests through the real reducer. In suggesting mode
 * (`EditorConfig.suggestingAuthor` non-null) a Backspace SOFT-deletes — it stamps
 * the in-range runs with a `deletionSuggestionId` (the text STAYS, struck-through)
 * via `markDeletion` instead of really removing it. The caret lands at the span
 * start (same as a real backward delete), which is correct for a soft delete too.
 *
 * Scope of this slice: the EXPANDED-selection and collapsed MID-BLOCK-char paths.
 * A Backspace at the START of a block (cross-block merge / list-outdent / atomic-
 * leaf delete) is a structural change not yet representable as a tracked
 * suggestion, so in suggesting mode it is a safe NO-OP (the suggested block-join
 * break-embed is a later change-tracking slice).
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
    expect(suggestions[0].kind).toBe("deletion");
    expect(suggestions[0].author).toBe("alice");
    expect(deletionIdAt(next, paraId, 2)).toBe(suggestions[0].id);
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
    expect(suggestions[0].kind).toBe("deletion");
    expect(suggestions[0].author).toBe("alice");
    expect(deletionIdAt(next, paraId, 1)).toBe(suggestions[0].id);
    expect(deletionIdAt(next, paraId, 2)).toBe(suggestions[0].id);
    expect(deletionIdAt(next, paraId, 3)).toBe(suggestions[0].id);
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

  it("block-start backspace in suggesting mode is a NO-OP (blocks not merged, no suggestion)", () => {
    // Two paragraphs: "abc" then "def"; caret at offset 0 of the 2nd.
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
    const placed = caretAt(s, secondId, 0);

    const next = reduceEditor(placed, { type: "DELETE_BACKWARD" }, suggestingConfig);

    // NO-OP: editor reference unchanged, both blocks still present, no suggestion.
    expect(next).toBe(placed);
    expect(getBlock(next.state, firstId)?.id).toBe(firstId);
    expect(getBlock(next.state, secondId)?.id).toBe(secondId);
    expect(getTextOf(next.state, firstId)).toBe("abc");
    expect(getTextOf(next.state, secondId)).toBe("def");
    expect(getSuggestions(next.state)).toHaveLength(0);
  });
});
