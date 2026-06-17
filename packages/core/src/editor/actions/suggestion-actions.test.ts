/**
 * Change-tracking slice 4a: the FOUR resolve editor actions
 * (ACCEPT_SUGGESTION / REJECT_SUGGESTION / ACCEPT_ALL_SUGGESTIONS /
 * REJECT_ALL_SUGGESTIONS) wired through `reduceEditor`.
 *
 * Behavior-level tests through the real reducer. Suggestions are seeded by
 * applying a CREATE op (`markFormatting`) to a `State`, then building the editor
 * from the seeded state. The resolve ops run a `SUGGESTION_RESOLVE_ORIGIN`
 * (non-undoable) transaction, so the key assertion (beyond resolution) is that
 * accept/reject add NO undo step (Ctrl+Z cannot revert them).
 */
import { describe, it, expect } from "vitest";
import {
  config,
  reduceEditor,
  createInitialEditorState,
  getTextOf,
} from "./test-helpers";

/** Throwing indexed access for tests: stronger than the old undefined-deref TypeError. */
function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}
import {
  createEditorStateFromState,
  type EditorConfig,
  type EditorState,
} from "../editor-state";
import {
  getBlock,
  getSuggestions,
  markFormatting,
  createPosition,
  createSpan,
  attrsAtOffset,
  type State,
  type BlockId,
  type Selection,
  type SuggestionId,
} from "../../state";
import { assertChainIntegrity } from "../../state/chain-integrity";

/** The first body paragraph id under the document root. */
function bodyParaId(state: State): BlockId {
  const root = getBlock(state, state.rootId);
  const id = root?.firstChildId;
  if (id === undefined || id === null) {
    throw new Error("document root has no first child paragraph");
  }
  return id;
}

/** Build a State with a single paragraph of `text`, return it + the para id. */
function stateWithText(text: string): { state: State; paraId: BlockId } {
  const initial = createInitialEditorState(config);
  const typed = reduceEditor(initial, { type: "INSERT_TEXT", text }, config);
  return { state: typed.state, paraId: bodyParaId(typed.state) };
}

/** A collapsed caret selection at the start of `paraId`. */
function caretAt(paraId: BlockId, offset: number): Selection {
  return createSpan(createPosition(paraId, offset), createPosition(paraId, offset));
}

/** Seed a formatting suggestion over `[from, to)` of `paraId` with the given id. */
function seedFormatting(
  state: State,
  paraId: BlockId,
  from: number,
  to: number,
  proposed: Record<string, unknown>,
  id: SuggestionId,
  author = "alice",
): State {
  const span = createSpan(createPosition(paraId, from), createPosition(paraId, to));
  return markFormatting(state, span, proposed, { id, author, createdAt: 1 }).state;
}

const SID = "s1" as SuggestionId;

describe("handleAcceptSuggestion — ACCEPT_SUGGESTION", () => {
  it("resolves the suggestion and applies the formatting proposal LIVE", () => {
    const { state, paraId } = stateWithText("abcdef");
    const seeded = seedFormatting(state, paraId, 1, 4, { bold: true }, SID);
    const editor = createEditorStateFromState(seeded, caretAt(paraId, 0), config);
    expect(getSuggestions(editor.state)).toHaveLength(1);

    const next = reduceEditor(editor, { type: "ACCEPT_SUGGESTION", id: SID }, config);

    expect(getSuggestions(next.state)).toHaveLength(0);
    // The proposal is now live on the formerly-suggested run ("bcd").
    const block = getBlock(next.state, paraId);
    if (block === null || block.inlineContent === null) {
      throw new Error("paragraph vanished");
    }
    expect(attrsAtOffset(block.inlineContent, 2).bold).toBe(true);
  });
});

describe("handleRejectSuggestion — REJECT_SUGGESTION", () => {
  it("resolves the suggestion and does NOT apply the proposal", () => {
    const { state, paraId } = stateWithText("abcdef");
    const seeded = seedFormatting(state, paraId, 1, 4, { bold: true }, SID);
    const editor = createEditorStateFromState(seeded, caretAt(paraId, 0), config);
    expect(getSuggestions(editor.state)).toHaveLength(1);

    const next = reduceEditor(editor, { type: "REJECT_SUGGESTION", id: SID }, config);

    expect(getSuggestions(next.state)).toHaveLength(0);
    const block = getBlock(next.state, paraId);
    if (block === null || block.inlineContent === null) {
      throw new Error("paragraph vanished");
    }
    expect(attrsAtOffset(block.inlineContent, 2).bold).toBeUndefined();
  });
});

describe("ACCEPT_ALL_SUGGESTIONS / REJECT_ALL_SUGGESTIONS", () => {
  /** Seed two distinct (non-adjacent) formatting suggestions in one paragraph. */
  function seedTwo(): EditorState {
    const { state, paraId } = stateWithText("abcdefgh");
    let s = seedFormatting(state, paraId, 0, 2, { bold: true }, "sA" as SuggestionId);
    s = seedFormatting(s, paraId, 5, 7, { italic: true }, "sB" as SuggestionId);
    return createEditorStateFromState(s, caretAt(paraId, 0), config);
  }

  it("ACCEPT_ALL resolves every suggestion", () => {
    const editor = seedTwo();
    expect(getSuggestions(editor.state)).toHaveLength(2);

    const next = reduceEditor(editor, { type: "ACCEPT_ALL_SUGGESTIONS" }, config);

    expect(getSuggestions(next.state)).toHaveLength(0);
  });

  it("REJECT_ALL resolves every suggestion", () => {
    const editor = seedTwo();
    expect(getSuggestions(editor.state)).toHaveLength(2);

    const next = reduceEditor(editor, { type: "REJECT_ALL_SUGGESTIONS" }, config);

    expect(getSuggestions(next.state)).toHaveLength(0);
  });
});

describe("resolve actions are NON-undoable", () => {
  it("ACCEPT_SUGGESTION adds no undo step; UNDO reverts the preceding typing", () => {
    // Two paragraphs: para A carries a seeded suggestion; para B receives typing.
    // The accept resolves only para A, so it never rewrites the typed para B.
    const initial = createInitialEditorState(config);
    let s = reduceEditor(initial, { type: "INSERT_TEXT", text: "first" }, config);
    s = reduceEditor(s, { type: "SPLIT_NODE" }, config);
    const root = getBlock(s.state, s.state.rootId);
    const paraA = root?.firstChildId;
    if (paraA === undefined || paraA === null) throw new Error("no para A");
    // Seed a suggestion in para A on the seeded State, then rebuild the editor.
    const seeded = seedFormatting(s.state, paraA, 0, 3, { bold: true }, SID);
    // Place the caret in para B (the second paragraph, currently empty).
    const paraB = getBlock(seeded, seeded.rootId)?.lastChildId;
    if (paraB === undefined || paraB === null) throw new Error("no para B");
    let editor = createEditorStateFromState(seeded, caretAt(paraB, 0), config);

    // A tracked edit in para B.
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "typed" }, config);
    expect(editor.history.canUndo()).toBe(true);

    // The non-undoable accept on para A's suggestion.
    editor = reduceEditor(editor, { type: "ACCEPT_SUGGESTION", id: SID }, config);
    expect(getSuggestions(editor.state)).toHaveLength(0);

    // UNDO reverts the typed text in para B (the accept added no undo step).
    const undone = reduceEditor(editor, { type: "UNDO" }, config);
    const blockB = getBlock(undone.state, paraB);
    expect(blockB?.inlineContent?.items.some((it) => it.kind === "text" && it.text.includes("typed"))).toBe(false);
    // The accept contributed no undo entry — after reverting the lone typing
    // step, there is nothing left to undo.
    expect(undone.history.canUndo()).toBe(false);
  });
});

describe("same-block resolve then undo (S1 — identity-preserving, #484)", () => {
  it("type-as-suggestion → accept → undo reverts the typing (StackItem survives the resolve)", () => {
    const suggesting: EditorConfig = { ...config, suggestingAuthor: "alice" };
    const initial = createInitialEditorState(config);
    const paraId = bodyParaId(initial.state);

    // Type "hi" in suggesting mode → one insertion suggestion in THIS block.
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "hi" }, suggesting);
    const sugg = getSuggestions(typed.state);
    expect(sugg).toHaveLength(1);

    // Accept it. The non-undoable resolve now applies a SURGICAL in-place attrs
    // strip (#484: applyResolveDecisionsInTx), preserving the run's Y.Text — and
    // therefore the preceding mint's undo StackItem stays VALID (it is no longer
    // detached by a full-replace rebuild).
    const accepted = reduceEditor(
      typed,
      { type: "ACCEPT_SUGGESTION", id: nth(sugg, 0, "suggestion").id },
      suggesting,
    );
    expect(getSuggestions(accepted.state)).toHaveLength(0);
    expect(getTextOf(accepted.state, paraId)).toBe("hi");

    // UNDO now REVERTS the typing for real (its StackItem survived the resolve) —
    // pre-#484 this was a silent no-op that left "hi" behind. The accept itself
    // contributed no undo step, so after this undo nothing reversible remains.
    const undone = reduceEditor(accepted, { type: "UNDO" }, suggesting);
    expect(getTextOf(undone.state, paraId)).toBe("");
    assertChainIntegrity(undone.state, "s1-regression");
    // A further undo is a safe no-op (nothing left) and must not throw.
    expect(() =>
      reduceEditor(undone, { type: "UNDO" }, suggesting),
    ).not.toThrow();
  });
});

describe("absent-id resolve is a safe no-op", () => {
  it("ACCEPT_SUGGESTION on an absent id leaves suggestions untouched and does not crash", () => {
    const { state, paraId } = stateWithText("abcdef");
    const seeded = seedFormatting(state, paraId, 1, 4, { bold: true }, SID);
    const editor = createEditorStateFromState(seeded, caretAt(paraId, 0), config);

    const next = reduceEditor(
      editor,
      { type: "ACCEPT_SUGGESTION", id: "nope" as SuggestionId },
      config,
    );

    // The one seeded suggestion is unchanged; the doc is intact.
    expect(getSuggestions(next.state)).toHaveLength(1);
    expect(next.state).toBe(editor.state);
  });
});
