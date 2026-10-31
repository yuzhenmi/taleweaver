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
import { finalSectionOf } from "../../test-utils/state-builders";
import { describe, it, expect, vi } from "vitest";
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
import { formattingSuggestionIds } from "../../state";

/** The first body paragraph id under the document root. */
function bodyParaId(editor: EditorState): BlockId {
  const root = getBlock(editor.document, finalSectionOf(editor.document));
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
    { ...editor, config: config },
    {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(paraId, start), createPosition(paraId, end)),
    },
  );
}

/** Build "abcdef" (direct), then select [0,6) under `config`. */
function seededSelection(config: EditorConfig): { editor: EditorState; paraId: BlockId } {
  const seeded = reduceEditor(
    createInitialEditorState(directConfig),
    { type: "INSERT_TEXT", text: "abcdef" },
  );
  const paraId = bodyParaId(seeded);
  return { editor: selectIn(seeded, paraId, 0, 6, config), paraId };
}

/** Every text item of `paraId`. */
function textItems(editor: EditorState, paraId: BlockId) {
  return (getBlock(editor.document, paraId)?.inlineContent?.items ?? []).filter(
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
    const next = reduceEditor(backward, { type: "TOGGLE_STYLE", style: "bold" });

    const runs = textItems(next, paraId);
    expect(runs.length).toBeGreaterThan(0);
    // Every selected run gains the provenance id; NONE gain live bold.
    for (const run of runs) {
      expect(formattingSuggestionIds(run.attrs)[0]).toBeDefined();
      expect(run.attrs.bold).toBeUndefined();
    }

    // Exactly one formatting record, by "alice", proposing bold:true.
    const suggestions = getSuggestions(next.document);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("formatting");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");
    expect(nth(suggestions, 0, "suggestion").proposedAttrs).toEqual({ bold: true });
    // The runs' id matches the record's id.
    expect(formattingSuggestionIds(nth(runs, 0, "run").attrs)[0]).toBe(nth(suggestions, 0, "suggestion").id);

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
    const suggested = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" });
    const id = nth(getSuggestions(suggested.document), 0, "suggestion").id;

    const accepted = acceptSuggestion(suggested.document, id);

    const runs = (getBlock(accepted.state, paraId)?.inlineContent?.items ?? []).filter(
      (it): it is Extract<typeof it, { kind: "text" }> => it.kind === "text",
    );
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.attrs.bold).toBe(true);
      expect(formattingSuggestionIds(run.attrs)[0]).toBeUndefined();
    }
    expect(getSuggestions(accepted.state)).toHaveLength(0);
  });

  it("reject: the formattingSuggestionId is stripped, NO live bold lands; the record is gone", () => {
    const { editor, paraId } = seededSelection(suggestingConfig);
    const suggested = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" });
    const id = nth(getSuggestions(suggested.document), 0, "suggestion").id;

    const rejected = rejectSuggestion(suggested.document, id);

    const runs = (getBlock(rejected.state, paraId)?.inlineContent?.items ?? []).filter(
      (it): it is Extract<typeof it, { kind: "text" }> => it.kind === "text",
    );
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.attrs.bold).toBeUndefined();
      expect(formattingSuggestionIds(run.attrs)[0]).toBeUndefined();
    }
    expect(getSuggestions(rejected.state)).toHaveLength(0);
  });

  it("toggle-OFF: an already-bold selection suggests REMOVING bold (proposedAttrs { bold: undefined }); live bold stays until accept", () => {
    // Seed "abcdef" + apply live bold directly, then turn on suggesting mode.
    const bolded = (() => {
      const seeded = reduceEditor(
        createInitialEditorState(directConfig),
        { type: "INSERT_TEXT", text: "abcdef" },
      );
      const paraId = bodyParaId(seeded);
      const selected = selectIn(seeded, paraId, 0, 6, directConfig);
      return {
        editor: reduceEditor(selected, { type: "TOGGLE_STYLE", style: "bold" }),
        paraId,
      };
    })();

    // Sanity: live bold present (direct mode).
    expect(nth(textItems(bolded.editor, bolded.paraId), 0, "run").attrs.bold).toBe(true);

    const selected = selectIn(bolded.editor, bolded.paraId, 0, 6, suggestingConfig);
    const next = reduceEditor(selected, { type: "TOGGLE_STYLE", style: "bold" });

    const suggestions = getSuggestions(next.document);
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
      expect(formattingSuggestionIds(run.attrs)[0]).toBeDefined();
    }

    // Accept the removal proposal → live bold is actually REMOVED. This locks the
    // full removal round-trip: the undefined-valued `proposedAttrs` survives Yjs
    // AND `acceptSuggestion` applies it (strips the live attr), not just records it.
    const accepted = acceptSuggestion(next.document, nth(suggestions, 0, "suggestion").id);
    const acceptedRuns = (getBlock(accepted.state, bolded.paraId)?.inlineContent?.items ?? []).filter(
      (it): it is Extract<typeof it, { kind: "text" }> => it.kind === "text",
    );
    expect(acceptedRuns.length).toBeGreaterThan(0);
    for (const run of acceptedRuns) {
      expect(run.attrs.bold).toBeUndefined();
      expect(formattingSuggestionIds(run.attrs)[0]).toBeUndefined();
    }
    expect(getSuggestions(accepted.state)).toHaveLength(0);
  });

  it("is undoable: UNDO reverts the mark + record (zero suggestions, no formattingSuggestionId)", () => {
    const { editor, paraId } = seededSelection(suggestingConfig);
    const suggested = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" });
    expect(getSuggestions(suggested.document)).toHaveLength(1);
    expect(suggested.history.canUndo()).toBe(true);

    const undone = reduceEditor(suggested, { type: "UNDO" });
    expect(getSuggestions(undone.document)).toHaveLength(0);
    for (const run of textItems(undone, paraId)) {
      expect(formattingSuggestionIds(run.attrs)[0]).toBeUndefined();
      expect(run.attrs.bold).toBeUndefined();
    }
  });

  it("direct mode (regression): live bold toggles on the runs, NO suggestion record", () => {
    const { editor, paraId } = seededSelection(directConfig);
    const next = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" });

    for (const run of textItems(next, paraId)) {
      expect(run.attrs.bold).toBe(true);
      expect(formattingSuggestionIds(run.attrs)[0]).toBeUndefined();
    }
    expect(getSuggestions(next.document)).toHaveLength(0);
  });
});

describe("handleToggleStyle — suggesting over another formatting suggestion", () => {
  it("a second user's suggestion over the first's text does NOT shrink it; both stay independently resolvable", () => {
    const { editor, paraId } = seededSelection(suggestingConfig);
    const bob: EditorConfig = { ...directConfig, suggestingAuthor: "bob", now: () => 2000 };
    const bold = reduceEditor(selectIn(editor, paraId, 0, 4, suggestingConfig), { type: "TOGGLE_STYLE", style: "bold" });
    const both = reduceEditor(selectIn(bold, paraId, 2, 6, bob), { type: "TOGGLE_STYLE", style: "italic" });
    const byAuthor = (e: EditorState, author: string) => getSuggestions(e.document).find((s) => s.author === author);
    const range = (e: EditorState, author: string) => {
      const r = byAuthor(e, author)?.range;
      return r === undefined || r === null ? null : [r.start.offset, r.end.offset];
    };
    expect(range(both, "alice")).toEqual([0, 4]);
    expect(range(both, "bob")).toEqual([2, 6]);

    const aliceId = byAuthor(both, "alice")?.id;
    const bobId = byAuthor(both, "bob")?.id;
    if (aliceId === undefined || bobId === undefined) throw new Error("expected both suggestions");
    // Reject alice's, accept bob's: only bob's italic lands, only on [2,6).
    const rejected = reduceEditor({ ...both, config: directConfig }, { type: "REJECT_SUGGESTION", id: aliceId });
    expect(range(rejected, "bob")).toEqual([2, 6]);
    const accepted = reduceEditor(rejected, { type: "ACCEPT_SUGGESTION", id: bobId });
    expect(textItems(accepted, paraId).map((r) => [r.text, r.attrs])).toEqual([
      ["ab", {}],
      ["cdef", { italic: true }],
    ]);
  });

  it("with a clock that repeats (same createdAt), the later suggestion still wins — whatever the ids' order", () => {
    for (const ids of [["0-first", "f-second"], ["f-first", "0-second"]]) {
      const { editor, paraId } = seededSelection(suggestingConfig);
      // The two suggestion ids are minted in the given order.
      const queue = [...ids];
      const real = crypto.randomUUID.bind(crypto);
      const spy = vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
        const next = queue.shift();
        return next === undefined ? real() : (next as ReturnType<typeof crypto.randomUUID>);
      });
      try {
        const bob: EditorConfig = { ...directConfig, suggestingAuthor: "bob", now: () => 1000 };
        const red = reduceEditor(selectIn(editor, paraId, 0, 6, suggestingConfig), { type: "SET_TEXT_COLOR", color: "red" });
        const blue = reduceEditor(selectIn(red, paraId, 2, 4, bob), { type: "SET_TEXT_COLOR", color: "blue" });
        expect(getSuggestions(blue.document).map((x) => x.id).sort()).toEqual([...ids].sort());
        const accepted = reduceEditor({ ...blue, config: directConfig }, { type: "ACCEPT_ALL_SUGGESTIONS" });
        expect(textItems(accepted, paraId).find((r) => r.text.includes("c"))?.attrs.color).toBe("blue");
      } finally {
        spy.mockRestore();
      }
    }
  });
});
