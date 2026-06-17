/**
 * Change-tracking MT-4: suggesting-mode edits whose target is inside a
 * footnote / header / footer / template BODY (the embedContents / templateContents
 * trees) are now TRACKED as suggestions — exactly like main-body edits — and
 * RESOLVE cleanly (accept/reject leave no zombie).
 *
 * Before MT-4 the suggesting-mode seams gated on `selectionContextOf(state,
 * blockId) === state.rootId` (main-body only): a body edit fell back to DIRECT
 * (untracked) editing, because the resolve scan walked only the main tree and a
 * body suggestion would have been an un-resolvable zombie. MT-2 + MT-3 made the
 * range index + accept/reject resolve scan walk all three trees (each write
 * tree-`kind`-dispatched), so MT-4 relaxes the gate to `selectionContextOf(...)
 * === null` — track in EVERY editing context, fall back only for a block that
 * resolves to no context at all.
 *
 * These behavior-level tests drive `reduceEditor` in suggesting mode with the
 * caret/selection inside a FOOTNOTE body, asserting (1) the edit is TRACKED (a
 * suggestion is created + the run/embed is stamped), and (2) ACCEPT_ALL /
 * REJECT_ALL resolve it to the right outcome with ZERO suggestions and no
 * stranded provenance attr — the MT round-trip that proves no zombie. The final
 * regression block confirms the SAME actions in the MAIN body still track.
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
import {
  getBlock,
  getSuggestions,
  resolveBlock,
  selectionContextOf,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  type BlockId,
} from "../../state";

/** A suggesting-mode config attributed to "alice". */
const suggestingConfig: EditorConfig = { ...directConfig, suggestingAuthor: "alice" };

/** The first body paragraph id under the document root (MAIN tree). */
function bodyParaId(editor: EditorState): BlockId {
  const root = getBlock(editor.state, editor.state.rootId);
  const id = root?.firstChildId;
  if (id === undefined || id === null) {
    throw new Error("document root has no first child paragraph");
  }
  return id;
}

/** The text of a block resolved via `resolveBlock` (works for any tree). */
function textOfResolved(editor: EditorState, blockId: BlockId): string {
  const block = resolveBlock(editor.state, blockId)?.block ?? null;
  return (block?.inlineContent?.items ?? [])
    .map((it) => (it.kind === "text" ? it.text : ""))
    .join("");
}

/** Whether ANY text run in `blockId` carries the named suggestion-provenance attr. */
function anyRunHasAttr(
  editor: EditorState,
  blockId: BlockId,
  attr: "insertionSuggestionId" | "deletionSuggestionId" | "formattingSuggestionId",
): boolean {
  const block = resolveBlock(editor.state, blockId)?.block ?? null;
  for (const it of block?.inlineContent?.items ?? []) {
    if (it.kind === "text" && it.attrs[attr] !== undefined) return true;
  }
  return false;
}

/** True iff `blockId`'s inlineContent ends with a `block-split-suggestion` embed
 *  (the suggesting-mode split marker). Resolves via `resolveBlock` so it works
 *  for a non-main-body block. */
function endsWithSplitEmbed(editor: EditorState, blockId: BlockId): boolean {
  const items = resolveBlock(editor.state, blockId)?.block?.inlineContent?.items ?? [];
  const last = items[items.length - 1];
  return (
    last !== undefined &&
    last.kind === "embed" &&
    last.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE
  );
}

/**
 * Build an editor whose caret is inside a FOOTNOTE body paragraph that already
 * contains "abc" (typed DIRECTLY so no suggestions exist yet). Returns the editor
 * and the body paragraph id.
 */
function footnoteBodyFixture(): { editor: EditorState; bodyParaId: BlockId } {
  const initial = createInitialEditorState(directConfig);
  const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "x" }, directConfig);
  const withFn = reduceEditor(typed, { type: "INSERT_FOOTNOTE" }, directConfig);
  const bodyPara = withFn.selection.focus.blockId;
  const seeded = reduceEditor(withFn, { type: "INSERT_TEXT", text: "abc" }, directConfig);
  expect(getSuggestions(seeded.state)).toHaveLength(0);
  expect(textOfResolved(seeded, bodyPara)).toBe("abc");
  // Self-guard: the body paragraph must be OUTSIDE the main body (a real
  // footnote-body block in embedContents), else these tests would silently
  // exercise the main-body path and prove nothing about the relaxed gate.
  expect(selectionContextOf(seeded.state, bodyPara)).not.toBe(seeded.state.rootId);
  expect(selectionContextOf(seeded.state, bodyPara)).not.toBeNull();
  return { editor: seeded, bodyParaId: bodyPara };
}

/** Place a collapsed caret at `offset` of `blockId` (suggesting config). */
function caretAt(editor: EditorState, blockId: BlockId, offset: number): EditorState {
  return reduceEditor(
    editor,
    {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(blockId, offset), createPosition(blockId, offset)),
    },
    suggestingConfig,
  );
}

/** Select `[start, end)` of `blockId` (suggesting config). */
function selectIn(editor: EditorState, blockId: BlockId, start: number, end: number): EditorState {
  return reduceEditor(
    editor,
    {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(blockId, start), createPosition(blockId, end)),
    },
    suggestingConfig,
  );
}

describe("suggesting mode in a footnote BODY now TRACKS (MT-4)", () => {
  it("INSERT_TEXT (collapsed) mints an insertion suggestion + stamps the body run", () => {
    const { editor, bodyParaId } = footnoteBodyFixture();
    const placed = caretAt(editor, bodyParaId, 3); // end of "abc"
    const next = reduceEditor(placed, { type: "INSERT_TEXT", text: "Z" }, suggestingConfig);

    expect(textOfResolved(next, bodyParaId)).toBe("abcZ");
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("insertion");
    expect(anyRunHasAttr(next, bodyParaId, "insertionSuggestionId")).toBe(true);
  });

  it("DELETE_BACKWARD (mid-block char) SOFT-deletes: deletion suggestion, text KEPT", () => {
    const { editor, bodyParaId } = footnoteBodyFixture();
    const placed = caretAt(editor, bodyParaId, 3); // caret after "abc"
    const next = reduceEditor(placed, { type: "DELETE_BACKWARD" }, suggestingConfig);

    // Soft delete: "c" is kept (struck), not removed.
    expect(textOfResolved(next, bodyParaId)).toBe("abc");
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(anyRunHasAttr(next, bodyParaId, "deletionSuggestionId")).toBe(true);
  });

  it("TOGGLE_STYLE (bold) over a body selection mints a formatting suggestion, live attr UNCHANGED", () => {
    const { editor, bodyParaId } = footnoteBodyFixture();
    const selected = selectIn(editor, bodyParaId, 0, 3); // select "abc"
    const next = reduceEditor(selected, { type: "TOGGLE_STYLE", style: "bold" }, suggestingConfig);

    // The live bold attr is NOT applied (it lands only on accept); only the
    // formatting-provenance attr is stamped.
    const block = resolveBlock(next.state, bodyParaId)?.block ?? null;
    const firstText = (block?.inlineContent?.items ?? []).find((it) => it.kind === "text");
    if (firstText?.kind === "text") {
      expect(firstText.attrs.bold).toBeUndefined();
    }
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("formatting");
    expect(anyRunHasAttr(next, bodyParaId, "formattingSuggestionId")).toBe(true);
  });

  it("SPLIT_NODE (Enter) does a real split PLUS a block-split-suggestion embed on the body block", () => {
    const { editor, bodyParaId } = footnoteBodyFixture();
    const placed = caretAt(editor, bodyParaId, 1); // caret after "a" → split "a" | "bc"
    const next = reduceEditor(placed, { type: "SPLIT_NODE" }, suggestingConfig);

    // Real structural split: original body block keeps "a" + a split embed; the
    // caret moved to a brand-new body block holding "bc".
    expect(textOfResolved(next, bodyParaId)).toBe("a");
    const newBlockId = next.selection.focus.blockId;
    expect(newBlockId).not.toBe(bodyParaId);
    expect(next.selection.focus.offset).toBe(0);
    expect(textOfResolved(next, newBlockId)).toBe("bc");
    // It's TRACKED: an insertion record + the split embed on the body block.
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("insertion");
    expect(endsWithSplitEmbed(next, bodyParaId)).toBe(true);
  });

  it("DELETE_FORWARD (collapsed mid-char) SOFT-deletes; caret ADVANCES to span end (soft-delete rule)", () => {
    const { editor, bodyParaId } = footnoteBodyFixture();
    const placed = caretAt(editor, bodyParaId, 1); // caret between "a" and "b"
    const next = reduceEditor(placed, { type: "DELETE_FORWARD" }, suggestingConfig);

    // Soft delete: "b" is kept (struck); body text length unchanged.
    expect(textOfResolved(next, bodyParaId)).toBe("abc");
    expect(getSuggestions(next.state)).toHaveLength(1);
    expect(anyRunHasAttr(next, bodyParaId, "deletionSuggestionId")).toBe(true);
    // The forward soft-delete caret rule advances to the span END (offset 2),
    // so a repeated Delete strikes the next char — NOT staying at offset 1 as a
    // direct delete would. This is the inversion of the old body-fallback rule.
    expect(next.selection.focus.blockId).toBe(bodyParaId);
    expect(next.selection.focus.offset).toBe(2);
  });
});

describe("body suggestions RESOLVE cleanly via accept/reject-all — the MT payoff (no zombie)", () => {
  it("body INSERT_TEXT → ACCEPT_ALL keeps the text, zero suggestions, no provenance attr", () => {
    const { editor, bodyParaId } = footnoteBodyFixture();
    const placed = caretAt(editor, bodyParaId, 3);
    const typed = reduceEditor(placed, { type: "INSERT_TEXT", text: "Z" }, suggestingConfig);
    const resolved = reduceEditor(typed, { type: "ACCEPT_ALL_SUGGESTIONS" }, suggestingConfig);

    expect(textOfResolved(resolved, bodyParaId)).toBe("abcZ");
    expect(getSuggestions(resolved.state)).toHaveLength(0);
    expect(anyRunHasAttr(resolved, bodyParaId, "insertionSuggestionId")).toBe(false);
  });

  it("body INSERT_TEXT → REJECT_ALL removes the inserted text, zero suggestions", () => {
    const { editor, bodyParaId } = footnoteBodyFixture();
    const placed = caretAt(editor, bodyParaId, 3);
    const typed = reduceEditor(placed, { type: "INSERT_TEXT", text: "Z" }, suggestingConfig);
    const resolved = reduceEditor(typed, { type: "REJECT_ALL_SUGGESTIONS" }, suggestingConfig);

    expect(textOfResolved(resolved, bodyParaId)).toBe("abc");
    expect(getSuggestions(resolved.state)).toHaveLength(0);
    expect(anyRunHasAttr(resolved, bodyParaId, "insertionSuggestionId")).toBe(false);
  });

  it("body DELETE_BACKWARD → ACCEPT_ALL really removes the text, zero suggestions", () => {
    const { editor, bodyParaId } = footnoteBodyFixture();
    const placed = caretAt(editor, bodyParaId, 3);
    const soft = reduceEditor(placed, { type: "DELETE_BACKWARD" }, suggestingConfig);
    const resolved = reduceEditor(soft, { type: "ACCEPT_ALL_SUGGESTIONS" }, suggestingConfig);

    expect(textOfResolved(resolved, bodyParaId)).toBe("ab");
    expect(getSuggestions(resolved.state)).toHaveLength(0);
    expect(anyRunHasAttr(resolved, bodyParaId, "deletionSuggestionId")).toBe(false);
  });

  it("body DELETE_BACKWARD → REJECT_ALL restores the text, zero suggestions", () => {
    const { editor, bodyParaId } = footnoteBodyFixture();
    const placed = caretAt(editor, bodyParaId, 3);
    const soft = reduceEditor(placed, { type: "DELETE_BACKWARD" }, suggestingConfig);
    const resolved = reduceEditor(soft, { type: "REJECT_ALL_SUGGESTIONS" }, suggestingConfig);

    expect(textOfResolved(resolved, bodyParaId)).toBe("abc");
    expect(getSuggestions(resolved.state)).toHaveLength(0);
    expect(anyRunHasAttr(resolved, bodyParaId, "deletionSuggestionId")).toBe(false);
  });

  it("body SPLIT_NODE → ACCEPT_ALL keeps the split (two blocks), drops the embed, zero suggestions", () => {
    const { editor, bodyParaId } = footnoteBodyFixture();
    const placed = caretAt(editor, bodyParaId, 1);
    const split = reduceEditor(placed, { type: "SPLIT_NODE" }, suggestingConfig);
    const newBlockId = split.selection.focus.blockId;
    const resolved = reduceEditor(split, { type: "ACCEPT_ALL_SUGGESTIONS" }, suggestingConfig);

    // Split kept: "a" | "bc" in two body blocks; the split embed is gone.
    expect(textOfResolved(resolved, bodyParaId)).toBe("a");
    expect(textOfResolved(resolved, newBlockId)).toBe("bc");
    expect(endsWithSplitEmbed(resolved, bodyParaId)).toBe(false);
    expect(getSuggestions(resolved.state)).toHaveLength(0);
  });

  it("body SPLIT_NODE → REJECT_ALL undoes the split (one block), zero suggestions", () => {
    const { editor, bodyParaId } = footnoteBodyFixture();
    const placed = caretAt(editor, bodyParaId, 1);
    const split = reduceEditor(placed, { type: "SPLIT_NODE" }, suggestingConfig);
    const resolved = reduceEditor(split, { type: "REJECT_ALL_SUGGESTIONS" }, suggestingConfig);

    // Split undone: the body block is back to a single "abc" with no embed.
    expect(textOfResolved(resolved, bodyParaId)).toBe("abc");
    expect(endsWithSplitEmbed(resolved, bodyParaId)).toBe(false);
    expect(getSuggestions(resolved.state)).toHaveLength(0);
  });
});

describe("regression: the SAME actions in the MAIN body still create suggestions", () => {
  it("INSERT_TEXT (collapsed) in the main body mints an insertion suggestion + stamps the run", () => {
    const initial = createInitialEditorState(directConfig);
    const para = bodyParaId(initial);
    const placed = caretAt(initial, para, 0);
    const next = reduceEditor(placed, { type: "INSERT_TEXT", text: "Z" }, suggestingConfig);

    expect(getTextOf(next.state, para)).toBe("Z");
    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("insertion");
    expect(anyRunHasAttr(next, para, "insertionSuggestionId")).toBe(true);
  });

  it("DELETE_BACKWARD in the main body soft-deletes (deletion suggestion + run stamped)", () => {
    const seeded = reduceEditor(
      createInitialEditorState(directConfig),
      { type: "INSERT_TEXT", text: "abc" },
      directConfig,
    );
    const para = bodyParaId(seeded);
    const placed = caretAt(seeded, para, 3);
    const next = reduceEditor(placed, { type: "DELETE_BACKWARD" }, suggestingConfig);

    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(anyRunHasAttr(next, para, "deletionSuggestionId")).toBe(true);
  });

  it("TOGGLE_STYLE in the main body mints a formatting suggestion + stamps the run", () => {
    const seeded = reduceEditor(
      createInitialEditorState(directConfig),
      { type: "INSERT_TEXT", text: "abc" },
      directConfig,
    );
    const para = bodyParaId(seeded);
    const selected = selectIn(seeded, para, 0, 3);
    const next = reduceEditor(selected, { type: "TOGGLE_STYLE", style: "bold" }, suggestingConfig);

    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("formatting");
    expect(anyRunHasAttr(next, para, "formattingSuggestionId")).toBe(true);
  });
});
