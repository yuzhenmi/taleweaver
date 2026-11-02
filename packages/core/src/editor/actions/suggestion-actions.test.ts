/**
 * Change-tracking slice 4a: the FOUR resolve editor actions
 * (ACCEPT_SUGGESTION / REJECT_SUGGESTION / ACCEPT_ALL_SUGGESTIONS /
 * REJECT_ALL_SUGGESTIONS) wired through `reduceEditor`.
 *
 * Behavior-level tests through the real reducer. Suggestions are seeded by
 * applying a CREATE op (`markFormatting`) to a `Document`, then building the editor
 * from the seeded state. The resolve ops run a `SUGGESTION_RESOLVE_ORIGIN`
 * (non-undoable) transaction, so the key assertion (beyond resolution) is that
 * accept/reject add NO undo step (Ctrl+Z cannot revert them).
 */
import { finalSectionOf } from "../../test-utils/document-builders";
import { describe, it, expect } from "vitest";
import {
  config, getTextOf } from "./test-helpers";

/** Throwing indexed access for tests: stronger than the old undefined-deref TypeError. */
function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}
import { createEditor, type Editor } from "../editor";
import { type EditorConfig } from "../editor-config";
import {
  getBlock,
  getSuggestions,
  markFormatting,
  createPosition,
  createSpan,
  attrsAtOffset,
  type Document,
  type BlockId,
  type Selection,
  type SuggestionId,
} from "../../state";

/** The first body paragraph id under the document root. */
function bodyParaId(document: Document): BlockId {
  const root = getBlock(document, finalSectionOf(document));
  const id = root?.firstChildId;
  if (id === undefined || id === null) {
    throw new Error("document root has no first child paragraph");
  }
  return id;
}

/** Build a Document with a single paragraph of `text`, return it + the para id. */
function stateWithText(text: string): { document: Document; paraId: BlockId } {
  const initial = createEditor(config);
  initial.dispatch({ type: "INSERT_TEXT", text });
  return { document: initial.document, paraId: bodyParaId(initial.document) };
}

/** A collapsed caret selection at the start of `paraId`. */
function caretAt(paraId: BlockId, offset: number): Selection {
  return createSpan(createPosition(paraId, offset), createPosition(paraId, offset));
}

/** Seed a formatting suggestion over `[from, to)` of `paraId` with the given id. */
function seedFormatting(
  document: Document,
  paraId: BlockId,
  from: number,
  to: number,
  proposed: Record<string, unknown>,
  id: SuggestionId,
  author = "alice",
): Document {
  const span = createSpan(createPosition(paraId, from), createPosition(paraId, to));
  return markFormatting(document, span, proposed, { id, author, createdAt: 1 }).document;
}

const SID = "s1" as SuggestionId;

describe("handleAcceptSuggestion — ACCEPT_SUGGESTION", () => {
  it("resolves the suggestion and applies the formatting proposal LIVE", () => {
    const { document, paraId } = stateWithText("abcdef");
    const seeded = seedFormatting(document, paraId, 1, 4, { bold: true }, SID);
    const editor = createEditor(config, { document: seeded, selection: caretAt(paraId, 0) });
    expect(getSuggestions(editor.document)).toHaveLength(1);

    editor.dispatch({ type: "ACCEPT_SUGGESTION", id: SID });

    expect(getSuggestions(editor.document)).toHaveLength(0);
    // The proposal is now live on the formerly-suggested run ("bcd").
    const block = getBlock(editor.document, paraId);
    if (block === null || block.inlineContent === null) {
      throw new Error("paragraph vanished");
    }
    expect(attrsAtOffset(block.inlineContent, 2).bold).toBe(true);
  });
});

describe("handleRejectSuggestion — REJECT_SUGGESTION", () => {
  it("resolves the suggestion and does NOT apply the proposal", () => {
    const { document, paraId } = stateWithText("abcdef");
    const seeded = seedFormatting(document, paraId, 1, 4, { bold: true }, SID);
    const editor = createEditor(config, { document: seeded, selection: caretAt(paraId, 0) });
    expect(getSuggestions(editor.document)).toHaveLength(1);

    editor.dispatch({ type: "REJECT_SUGGESTION", id: SID });

    expect(getSuggestions(editor.document)).toHaveLength(0);
    const block = getBlock(editor.document, paraId);
    if (block === null || block.inlineContent === null) {
      throw new Error("paragraph vanished");
    }
    expect(attrsAtOffset(block.inlineContent, 2).bold).toBeUndefined();
  });
});

describe("ACCEPT_ALL_SUGGESTIONS / REJECT_ALL_SUGGESTIONS", () => {
  /** Seed two distinct (non-adjacent) formatting suggestions in one paragraph. */
  function seedTwo(): Editor {
    const { document, paraId } = stateWithText("abcdefgh");
    let s = seedFormatting(document, paraId, 0, 2, { bold: true }, "sA" as SuggestionId);
    s = seedFormatting(s, paraId, 5, 7, { italic: true }, "sB" as SuggestionId);
    return createEditor(config, { document: s, selection: caretAt(paraId, 0) });
  }

  it("ACCEPT_ALL resolves every suggestion", () => {
    const editor = seedTwo();
    expect(getSuggestions(editor.document)).toHaveLength(2);

    editor.dispatch({ type: "ACCEPT_ALL_SUGGESTIONS" });

    expect(getSuggestions(editor.document)).toHaveLength(0);
  });

  it("REJECT_ALL resolves every suggestion", () => {
    const editor = seedTwo();
    expect(getSuggestions(editor.document)).toHaveLength(2);

    editor.dispatch({ type: "REJECT_ALL_SUGGESTIONS" });

    expect(getSuggestions(editor.document)).toHaveLength(0);
  });
});

describe("resolve actions are UNDOABLE (one history entry each)", () => {
  it("ACCEPT_SUGGESTION is its own undo step: UNDO restores the suggestion exactly, a second UNDO reverts the typing", () => {
    // Two paragraphs: para A carries a seeded suggestion; para B receives typing.
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "first" });
    let s = initial;
    s.dispatch({ type: "SPLIT_NODE" });
    const root = getBlock(s.document, finalSectionOf(s.document));
    const paraA = root?.firstChildId;
    if (paraA === undefined || paraA === null) throw new Error("no para A");
    const seeded = seedFormatting(s.document, paraA, 0, 3, { bold: true }, SID);
    const paraB = getBlock(seeded, finalSectionOf(seeded))?.lastChildId;
    if (paraB === undefined || paraB === null) throw new Error("no para B");
    let editor = createEditor(config, { document: seeded, selection: caretAt(paraB, 0) });
    editor.dispatch({ type: "INSERT_TEXT", text: "typed" });
    const beforeAccept = getBlock(editor.document, paraA)?.inlineContent?.items;

    editor.dispatch({ type: "ACCEPT_SUGGESTION", id: SID });
    expect(getSuggestions(editor.document)).toHaveLength(0);

    // UNDO restores the suggestion: record + the tagged run, exactly.
    editor.dispatch({ type: "UNDO" });
    expect(getSuggestions(editor.document).map((x) => x.id)).toEqual([SID]);
    expect(getBlock(editor.document, paraA)?.inlineContent?.items).toEqual(beforeAccept);
    // The typing is still there; a second UNDO reverts it.
    const blockB = (st: typeof editor) => getBlock(st.document, paraB)?.inlineContent?.items ?? [];
    expect(blockB(editor).some((it) => it.kind === "text" && it.text.includes("typed"))).toBe(true);
    editor.dispatch({ type: "UNDO" });
    expect(blockB(editor).some((it) => it.kind === "text" && it.text.includes("typed"))).toBe(false);
    // REDO twice re-applies the typing and the accept.
    editor.dispatch({ type: "REDO" });
    editor.dispatch({ type: "REDO" });
    expect(getSuggestions(editor.document)).toHaveLength(0);
  });
});

describe("same-block resolve then undo (S1 — identity-preserving, #484)", () => {
  it("type-as-suggestion → accept → undo restores the suggestion → undo reverts the typing", () => {
    const suggesting: EditorConfig = { ...config, suggestingAuthor: "alice" };
    const initial = createEditor(config);
    const paraId = bodyParaId(initial.document);

    // Type "hi" in suggesting mode → one insertion suggestion in THIS block.
    initial.setConfig(suggesting);
    initial.dispatch({ type: "INSERT_TEXT", text: "hi" });
    const sugg = getSuggestions(initial.document);
    expect(sugg).toHaveLength(1);

    // Accept it (surgical in-place strip, #484) — one undoable entry.
    initial.dispatch({ type: "ACCEPT_SUGGESTION", id: nth(sugg, 0, "suggestion").id });
    expect(getSuggestions(initial.document)).toHaveLength(0);
    expect(getTextOf(initial.document, paraId)).toBe("hi");

    // UNDO restores the pending insertion; a second UNDO reverts the typing (its
    // StackItem survived the identity-preserving resolve).
    initial.dispatch({ type: "UNDO" });
    expect(getSuggestions(initial.document)).toHaveLength(1);
    expect(getTextOf(initial.document, paraId)).toBe("hi");
    initial.dispatch({ type: "UNDO" });
    expect(getTextOf(initial.document, paraId)).toBe("");
    expect(() => { initial.dispatch({ type: "UNDO" }); return initial; }).not.toThrow();
  });
});

describe("absent-id resolve is a safe no-op", () => {
  it("ACCEPT_SUGGESTION on an absent id leaves suggestions untouched and does not crash", () => {
    const { document, paraId } = stateWithText("abcdef");
    const seeded = seedFormatting(document, paraId, 1, 4, { bold: true }, SID);
    const editor = createEditor(config, { document: seeded, selection: caretAt(paraId, 0) });

    const before = editor.snapshot();
    editor.dispatch({ type: "ACCEPT_SUGGESTION", id: "nope" as SuggestionId });

    // The one seeded suggestion is unchanged; the doc is intact.
    expect(getSuggestions(editor.document)).toHaveLength(1);
    expect(editor.document).toBe(before.document);
  });
});
