/**
 * Change-tracking slice 4d-format: lean coverage that the OTHER seven inline-
 * format handlers (SET_TEXT_COLOR, SET_HIGHLIGHT, SET_FONT_SIZE,
 * SET_FONT_FAMILY, SET_LINK, SET_TEXT_TRANSFORM, CLEAR_FORMATTING) become
 * tracked FORMATTING SUGGESTIONS in suggesting mode via the shared
 * `applyAttrsOrSuggest` helper — the full accept/reject/undo cycle is proven
 * once on TOGGLE_STYLE in `toggle-style-suggesting.test.ts`.
 *
 * For each handler we assert, in suggesting mode: (a) the selected runs carry a
 * `formattingSuggestionId`, (b) ONE `formatting` record whose `proposedAttrs`
 * equals the delta the action applies in DIRECT mode, (c) the LIVE target attr
 * is unchanged; and in DIRECT mode the same action applies live with no
 * suggestion.
 *
 * Plus a guard-lock: CLEAR_FORMATTING in DIRECT mode must NOT strip a
 * suggestion-provenance id (`INLINE_FORMAT_ATTR_KEYS` is a curated allow-list).
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
  createPosition,
  createSpan,
  type BlockId,
} from "../../state";
import type { EditorAction } from "../editor-action";
import { INLINE_FORMAT_ATTR_KEYS } from "../inline-format-keys";

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
  now: () => 2000,
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

/** The clear-all delta CLEAR_FORMATTING applies: every inline-format key removed. */
const CLEAR_ALL_DELTA: Record<string, undefined> = Object.fromEntries(
  INLINE_FORMAT_ATTR_KEYS.map((k) => [k, undefined]),
);

interface Case {
  readonly name: string;
  readonly action: EditorAction;
  /** The delta the action applies in direct mode (= the suggested proposedAttrs). */
  readonly proposed: Readonly<Record<string, unknown>>;
  /** A single live attr key this action targets, asserted unchanged in suggesting mode. */
  readonly liveKey: string;
}

const CASES: readonly Case[] = [
  {
    name: "SET_TEXT_COLOR",
    action: { type: "SET_TEXT_COLOR", color: "#ff0000" },
    proposed: { color: "#ff0000" },
    liveKey: "color",
  },
  {
    name: "SET_HIGHLIGHT",
    action: { type: "SET_HIGHLIGHT", color: "#ffff00" },
    proposed: { backgroundColor: "#ffff00" },
    liveKey: "backgroundColor",
  },
  {
    name: "SET_FONT_SIZE",
    action: { type: "SET_FONT_SIZE", size: 24 },
    proposed: { fontSize: 24 },
    liveKey: "fontSize",
  },
  {
    name: "SET_FONT_FAMILY",
    action: { type: "SET_FONT_FAMILY", family: "Serif" },
    proposed: { fontFamily: "Serif" },
    liveKey: "fontFamily",
  },
  {
    name: "SET_LINK",
    action: { type: "SET_LINK", url: "https://example.com" },
    proposed: { link: "https://example.com" },
    liveKey: "link",
  },
  {
    name: "SET_TEXT_TRANSFORM",
    action: { type: "SET_TEXT_TRANSFORM", value: "uppercase" },
    proposed: { textTransform: "uppercase" },
    liveKey: "textTransform",
  },
  {
    name: "CLEAR_FORMATTING",
    action: { type: "CLEAR_FORMATTING" },
    proposed: CLEAR_ALL_DELTA,
    liveKey: "bold",
  },
];

describe("inline-format handlers — suggesting mode (slice 4d-format)", () => {
  for (const c of CASES) {
    it(`${c.name}: suggesting mode stamps a formatting record with the action's delta; LIVE attr unchanged`, () => {
      const { editor, paraId } = seededSelection(suggestingConfig);
      const next = reduceEditor(editor, c.action, suggestingConfig);

      const runs = textItems(next, paraId);
      expect(runs.length).toBeGreaterThan(0);
      // (a) every selected run carries the provenance id; (c) live attr unchanged.
      for (const run of runs) {
        expect(run.attrs.formattingSuggestionId).toBeDefined();
        expect(run.attrs[c.liveKey]).toBeUndefined();
      }

      // (b) one formatting record, by "alice", proposing the action's delta.
      const suggestions = getSuggestions(next.state);
      expect(suggestions).toHaveLength(1);
      expect(nth(suggestions, 0, "suggestion").kind).toBe("formatting");
      expect(nth(suggestions, 0, "suggestion").author).toBe("alice");
      expect(nth(suggestions, 0, "suggestion").proposedAttrs).toEqual(c.proposed);
      // Non-vacuous key check: `toEqual` treats undefined-valued keys as absent,
      // so the all-undefined CLEAR_FORMATTING delta would pass even if every key
      // were dropped on the Yjs round-trip. Assert the proposed key SET survives.
      expect(Object.keys(nth(suggestions, 0, "suggestion").proposedAttrs ?? {}).sort()).toEqual(
        Object.keys(c.proposed).sort(),
      );
      expect(nth(runs, 0, "run").attrs.formattingSuggestionId).toBe(nth(suggestions, 0, "suggestion").id);
    });

    it(`${c.name}: direct mode applies the delta live with NO suggestion`, () => {
      const { editor, paraId } = seededSelection(directConfig);
      const next = reduceEditor(editor, c.action, directConfig);

      expect(getSuggestions(next.state)).toHaveLength(0);
      // The single non-CLEAR cases set their key live; assert that key landed.
      // CLEAR_FORMATTING on already-clean text is a state no-op (nothing to
      // clear), so we only check it produced no suggestion above.
      if (c.name !== "CLEAR_FORMATTING") {
        const proposedEntry = Object.entries(c.proposed)[0];
        if (proposedEntry === undefined) throw new Error("expected a proposed attr entry");
        for (const run of textItems(next, paraId)) {
          expect(run.attrs[proposedEntry[0]]).toEqual(proposedEntry[1]);
          expect(run.attrs.formattingSuggestionId).toBeUndefined();
        }
      }
    });
  }

  it("guard: CLEAR_FORMATTING in DIRECT mode preserves a suggestion-provenance id (INLINE_FORMAT_ATTR_KEYS is an allow-list, never strips suggestion ids)", () => {
    // Seed a run carrying a formattingSuggestionId by running a suggesting-mode
    // toggle first (stamps the id without changing live attrs), then dispatch a
    // direct-mode CLEAR_FORMATTING over the same selection.
    const { editor, paraId } = seededSelection(suggestingConfig);
    const suggested = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" }, suggestingConfig);
    const provenanceId = nth(textItems(suggested, paraId), 0, "run").attrs.formattingSuggestionId;
    expect(provenanceId).toBeDefined();

    const cleared = reduceEditor(
      selectIn(suggested, paraId, 0, 6, directConfig),
      { type: "CLEAR_FORMATTING" },
      directConfig,
    );

    // The provenance id SURVIVES the clear — it is not an inline-format key.
    for (const run of textItems(cleared, paraId)) {
      expect(run.attrs.formattingSuggestionId).toBe(provenanceId);
    }
  });

  it("guard cross-check: accepting the surviving suggestion after a direct CLEAR_FORMATTING still lands the proposal", () => {
    // The id survived the clear (previous test) — prove it is still a LIVE,
    // resolvable suggestion, not a dangling attr.
    const { editor, paraId } = seededSelection(suggestingConfig);
    const suggested = reduceEditor(editor, { type: "TOGGLE_STYLE", style: "bold" }, suggestingConfig);
    const cleared = reduceEditor(
      selectIn(suggested, paraId, 0, 6, directConfig),
      { type: "CLEAR_FORMATTING" },
      directConfig,
    );

    const id = nth(getSuggestions(cleared.state), 0, "suggestion").id;
    const accepted = acceptSuggestion(cleared.state, id);
    const runs = (getBlock(accepted.state, paraId)?.inlineContent?.items ?? []).filter(
      (it): it is Extract<typeof it, { kind: "text" }> => it.kind === "text",
    );
    for (const run of runs) {
      expect(run.attrs.bold).toBe(true);
      expect(run.attrs.formattingSuggestionId).toBeUndefined();
    }
    expect(getSuggestions(accepted.state)).toHaveLength(0);
  });
});
