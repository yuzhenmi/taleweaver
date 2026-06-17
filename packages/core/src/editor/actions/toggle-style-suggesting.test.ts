/**
 * Change-tracking slice 4d-format: TOGGLE_STYLE in suggesting mode is a tracked
 * FORMATTING SUGGESTION instead of a live style toggle. The handler routes the
 * attr delta through `applyAttrsOrSuggest` → `markFormatting`: the selected runs
 * gain a `formattingSuggestionId` provenance attr + ONE `formatting` record
 * carrying the delta the toggle WOULD have applied (`proposedAttrs`); the runs'
 * LIVE `bold` attr stays UNCHANGED until the suggestion is ACCEPTED.
 *
 * Representative full cycle (accept / reject / toggle-off / undo / direct-mode
 * regression). The other seven inline-format handlers are covered leanly in
 * `format-suggesting.test.ts` — they share the same helper, so this file proves
 * the cycle once on the canonical handler.
 */
import { describe, it, expect } from "vitest";
import {
  config as directConfig,
  reduceEditor,
  createInitialEditorState,
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
  acceptSuggestion,
  rejectSuggestion,
  createPosition,
  createSpan,
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

/** A suggesting-mode config attributed to "alice" with a fixed clock. */
const suggestingConfig: EditorConfig = {
  ...directConfig,
  suggestingAuthor: "alice",
  now: () => 1000,
};

/** Select `[start, end)` of `paraId` (under `config`). */
function selectIn(
  editor: EditorState,
  paraId: BlockId,
  start: number,
  end: number,
  config: EditorConfig,
): EditorState {
  return reduceEditor(
    editor,
    {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(paraId, start), createPosition(paraId, end)),
    },
    config,
  );
}

/** Build "abcdef" (direct), then select [0,6) under `config`. */
function seededSelection(config: EditorConfig): { editor: EditorState; paraId: BlockId } {
  const seeded = reduceEditor(
    createInitialEditorState(directConfig),
    { type: "INSERT_TEXT", text: "abcdef" },
    directConfig,
  );
  const paraId = bodyParaId(seeded);
  return { editor: selectIn(seeded, paraId, 0, 6, config), paraId };
}

/** Every text item of `paraId`. */
function textItems(editor: EditorState, paraId: BlockId) {
  return (getBlock(editor.state, paraId)?.inlineContent?.items ?? []).filter(
    (it): it is Extract<typeof it, { kind: "text" }> => it.kind === "text",
  );
}

describe("handleToggleStyle — suggesting mode (slice 4d-format)", () => {
  it("toggle bold over a selection: every run carries a formattingSuggestionId; ONE formatting record; LIVE bold unchanged; selection preserved", () => {
    const { editor, paraId } = seededSelection(suggestingConfig);
    // Re-select BACKWARD (anchor at the later offset, focus at the earlier) so
    // the assertion below verifies the suggesting-mode path preserves selection
    // DIRECTION — not merely the endpoint set. An attr-only edit shifts no
    // offsets, so the selection is returned UNCHANGED (direction included).
    const backward = selectIn(editor, paraId, 6, 0, suggestingConfig);
    const next = reduceEditor(backward, { type: "TOGGLE_STYLE", style: "bold" }, suggestingConfig);

    const runs = textItems(next, paraId);
    expect(runs.length).toBeGreaterThan(0);
    // Every selected run gains the provenance id; NONE gain live bold.
    for (const run of runs) {
      expect(run.attrs.formattingSuggestionId).toBeDefined();
      expect(run.attrs.bold).toBeUndefined();
    }

    // Exactly one formatting record, by "alice", proposing bold:true.
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("formatting");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");
    expect(nth(suggestions, 0, "suggestion").proposedAttrs).toEqual({ bold: true });
    // The runs' id matches the record's id.
    expect(nth(runs, 0, "run").attrs.formattingSuggestionId).toBe(nth(suggestions, 0, "suggestion").id);

    // Attr-only change → selection preserved UNCHANGED, backward DIRECTION
    // included (anchor stays at 6, focus at 0). The old code normalized to a
    // forward span (anchor 0, focus 6), so this pins the direction-preserving fix.
    expect(next.selection.anchor.blockId).toBe(paraId);
    expect(next.selection.focus.blockId).toBe(paraId);
    expect(next.selection.anchor.offset).toBe(6);
    expect(next.selection.focus.offset).toBe(0);
  });

  it("accept: the proposal lands as live bold AND the formattingSuggestionId is stripped; the record is gone", () => {
    const { editor, paraId } = seededSelection(suggestingConfig);
    const suggested = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" }, suggestingConfig);
    const id = nth(getSuggestions(suggested.state), 0, "suggestion").id;

    const accepted = acceptSuggestion(suggested.state, id);

    const runs = (getBlock(accepted.state, paraId)?.inlineContent?.items ?? []).filter(
      (it): it is Extract<typeof it, { kind: "text" }> => it.kind === "text",
    );
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.attrs.bold).toBe(true);
      expect(run.attrs.formattingSuggestionId).toBeUndefined();
    }
    expect(getSuggestions(accepted.state)).toHaveLength(0);
  });

  it("reject: the formattingSuggestionId is stripped, NO live bold lands; the record is gone", () => {
    const { editor, paraId } = seededSelection(suggestingConfig);
    const suggested = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" }, suggestingConfig);
    const id = nth(getSuggestions(suggested.state), 0, "suggestion").id;

    const rejected = rejectSuggestion(suggested.state, id);

    const runs = (getBlock(rejected.state, paraId)?.inlineContent?.items ?? []).filter(
      (it): it is Extract<typeof it, { kind: "text" }> => it.kind === "text",
    );
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.attrs.bold).toBeUndefined();
      expect(run.attrs.formattingSuggestionId).toBeUndefined();
    }
    expect(getSuggestions(rejected.state)).toHaveLength(0);
  });

  it("toggle-OFF: an already-bold selection suggests REMOVING bold (proposedAttrs { bold: undefined }); live bold stays until accept", () => {
    // Seed "abcdef" + apply live bold directly, then turn on suggesting mode.
    const bolded = (() => {
      const seeded = reduceEditor(
        createInitialEditorState(directConfig),
        { type: "INSERT_TEXT", text: "abcdef" },
        directConfig,
      );
      const paraId = bodyParaId(seeded);
      const selected = selectIn(seeded, paraId, 0, 6, directConfig);
      return {
        editor: reduceEditor(selected, { type: "TOGGLE_STYLE", style: "bold" }, directConfig),
        paraId,
      };
    })();

    // Sanity: live bold present (direct mode).
    expect(nth(textItems(bolded.editor, bolded.paraId), 0, "run").attrs.bold).toBe(true);

    const selected = selectIn(bolded.editor, bolded.paraId, 0, 6, suggestingConfig);
    const next = reduceEditor(selected, { type: "TOGGLE_STYLE", style: "bold" }, suggestingConfig);

    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("formatting");
    // The proposal is to REMOVE bold — `{ bold: undefined }` is a valid delta.
    // `toEqual` treats `{ bold: undefined }` as `{}`, so assert the key is
    // actually PRESENT — a dropped-key Yjs round-trip would otherwise pass.
    const proposed = nth(suggestions, 0, "suggestion").proposedAttrs ?? {};
    expect(Object.prototype.hasOwnProperty.call(proposed, "bold")).toBe(true);
    expect(proposed.bold).toBeUndefined();

    // Live bold still present (the removal lands only on accept).
    for (const run of textItems(next, bolded.paraId)) {
      expect(run.attrs.bold).toBe(true);
      expect(run.attrs.formattingSuggestionId).toBeDefined();
    }

    // Accept the removal proposal → live bold is actually REMOVED. This locks the
    // full removal round-trip: the undefined-valued `proposedAttrs` survives Yjs
    // AND `acceptSuggestion` applies it (strips the live attr), not just records it.
    const accepted = acceptSuggestion(next.state, nth(suggestions, 0, "suggestion").id);
    const acceptedRuns = (getBlock(accepted.state, bolded.paraId)?.inlineContent?.items ?? []).filter(
      (it): it is Extract<typeof it, { kind: "text" }> => it.kind === "text",
    );
    expect(acceptedRuns.length).toBeGreaterThan(0);
    for (const run of acceptedRuns) {
      expect(run.attrs.bold).toBeUndefined();
      expect(run.attrs.formattingSuggestionId).toBeUndefined();
    }
    expect(getSuggestions(accepted.state)).toHaveLength(0);
  });

  it("is undoable: UNDO reverts the mark + record (zero suggestions, no formattingSuggestionId)", () => {
    const { editor, paraId } = seededSelection(suggestingConfig);
    const suggested = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" }, suggestingConfig);
    expect(getSuggestions(suggested.state)).toHaveLength(1);
    expect(suggested.history.canUndo()).toBe(true);

    const undone = reduceEditor(suggested, { type: "UNDO" }, suggestingConfig);
    expect(getSuggestions(undone.state)).toHaveLength(0);
    for (const run of textItems(undone, paraId)) {
      expect(run.attrs.formattingSuggestionId).toBeUndefined();
      expect(run.attrs.bold).toBeUndefined();
    }
  });

  it("direct mode (regression): live bold toggles on the runs, NO suggestion record", () => {
    const { editor, paraId } = seededSelection(directConfig);
    const next = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" }, directConfig);

    for (const run of textItems(next, paraId)) {
      expect(run.attrs.bold).toBe(true);
      expect(run.attrs.formattingSuggestionId).toBeUndefined();
    }
    expect(getSuggestions(next.state)).toHaveLength(0);
  });
});
