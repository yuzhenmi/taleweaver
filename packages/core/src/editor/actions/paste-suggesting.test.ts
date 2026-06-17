/**
 * Change-tracking PF-3: PASTE in suggesting mode inserts the pasted fragment as ONE
 * tracked insertion (via `replaceWithSuggestedFragment`) instead of mutating the
 * document destructively. A multi-line paste's inter-line breaks become
 * `block-split-suggestion` embeds; a paste OVER a selection soft-deletes the
 * selection (cross-block: with a `block-join-suggestion` per crossed boundary) and
 * inserts the fragment in ONE undoable op. Accept-all lands the paste for real;
 * reject-all restores the original document. Tracking is ALL-CONTEXT (main body AND
 * footnote / header / footer bodies) via the MT-4 `replaceSuggestionInputForBlock`
 * gate. Direct mode (no `suggestingAuthor`) keeps the destructive paste UNCHANGED.
 *
 * Behavior-level tests through the real reducer (`PASTE` action).
 */
import { describe, it, expect } from "vitest";
import {
  config as directConfig,
  reduceEditor,
  createInitialEditorState,
  stateWithTwoParagraphs,
  createPosition,
  createSpan,
  getTextOf,
  firstChildId,
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
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  type BlockId,
} from "../../state";

const suggestingConfig: EditorConfig = { ...directConfig, suggestingAuthor: "alice" };

/** The first body paragraph id under the document root. */
function bodyParaId(editor: EditorState): BlockId {
  const id = firstChildId(editor.state);
  if (id === null) throw new Error("document root has no first child paragraph");
  return id;
}

/** Doc-order block ids under the MAIN document root. */
function blockSeq(editor: EditorState): BlockId[] {
  const out: BlockId[] = [];
  let id = getBlock(editor.state, editor.state.rootId)?.firstChildId ?? null;
  while (id) {
    out.push(id);
    id = getBlock(editor.state, id)?.nextSiblingId ?? null;
  }
  return out;
}

const textOfResolved = (editor: EditorState, id: BlockId): string =>
  (resolveBlock(editor.state, id)?.block?.inlineContent?.items ?? [])
    .map((it) => (it.kind === "text" ? it.text : ""))
    .join("");

const hasSplitEmbed = (editor: EditorState, id: BlockId): boolean =>
  (resolveBlock(editor.state, id)?.block?.inlineContent?.items ?? []).some(
    (it) => it.kind === "embed" && it.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  );
const hasJoinEmbed = (editor: EditorState, id: BlockId): boolean =>
  (resolveBlock(editor.state, id)?.block?.inlineContent?.items ?? []).some(
    (it) => it.kind === "embed" && it.embedType === BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  );

const paste = (e: EditorState, text: string, cfg: EditorConfig): EditorState =>
  reduceEditor(e, { type: "PASTE", text }, cfg);
const caretAt = (e: EditorState, id: BlockId, off: number): EditorState =>
  reduceEditor(e, { type: "SET_SELECTION", selection: createSpan(createPosition(id, off), createPosition(id, off)) }, suggestingConfig);
const select = (e: EditorState, a: [BlockId, number], f: [BlockId, number]): EditorState =>
  reduceEditor(e, { type: "SET_SELECTION", selection: createSpan(createPosition(a[0], a[1]), createPosition(f[0], f[1])) }, suggestingConfig);

// reduceEditor mutates the shared underlying Y.Doc in place, so accept and reject
// CANNOT run off the same pasted editor — each independent resolution needs a FRESH
// paste (mirrors the state-level fragment tests). These thunks rebuild from scratch.
function freshCollapsedPaste(text: string): { editor: EditorState; p1: BlockId } {
  const base = stateWithTwoParagraphs(); // "abc" / "def" (built directly, no suggestions)
  const p1 = bodyParaId(base);
  return { editor: paste(caretAt(base, p1, 3), text, suggestingConfig), p1 };
}
function freshSingleBlockPaste(): { editor: EditorState; p1: BlockId } {
  const base = stateWithTwoParagraphs();
  const p1 = bodyParaId(base);
  return { editor: paste(select(base, [p1, 1], [p1, 2]), "X", suggestingConfig), p1 };
}
function freshCrossBlockPaste(): { editor: EditorState; p1: BlockId } {
  const base = stateWithTwoParagraphs(); // "abc" / "def"
  const p1 = bodyParaId(base);
  const p2 = getBlock(base.state, p1)?.nextSiblingId ?? null;
  if (p2 === null) throw new Error("expected a second paragraph");
  // Select p1[1..] .. p2[..2]: "bc" + break + "de"; paste "X".
  return { editor: paste(select(base, [p1, 1], [p2, 2]), "X", suggestingConfig), p1 };
}

describe("handlePaste — suggesting mode (PF-3)", () => {
  it("collapsed caret, single-line paste: tracks ONE insertion, stamps the run; direct mode UNCHANGED", () => {
    const { editor: sug, p1 } = freshCollapsedPaste("X");
    expect(getTextOf(sug.state, p1)).toBe("abcX");
    const suggestions = getSuggestions(sug.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("insertion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");
    const items = getBlock(sug.state, p1)?.inlineContent?.items ?? [];
    const x = items.find((it) => it.kind === "text" && it.text === "X");
    expect(x?.kind === "text" && x.attrs.insertionSuggestionId).toBe(nth(suggestions, 0, "suggestion").id);
    expect(sug.selection.focus).toEqual(createPosition(p1, 4)); // caret after the pasted "X"

    // Direct mode (FRESH doc): same paste produces the text with NO suggestions.
    const dbase = stateWithTwoParagraphs();
    const dp1 = bodyParaId(dbase);
    const direct = paste(
      reduceEditor(dbase, { type: "SET_SELECTION", selection: createSpan(createPosition(dp1, 3), createPosition(dp1, 3)) }, directConfig),
      "X",
      directConfig,
    );
    expect(getTextOf(direct.state, dp1)).toBe("abcX");
    expect(getSuggestions(direct.state)).toHaveLength(0);
  });

  it("collapsed caret, two-line paste: ONE insertion + a split embed + two blocks; accept keeps split, reject removes paste", () => {
    const { editor: sug } = freshCollapsedPaste("X\nY");
    const seq = blockSeq(sug);
    expect(getTextOf(sug.state, nth(seq, 0, "block id"))).toBe("abcX");
    expect(hasSplitEmbed(sug, nth(seq, 0, "block id"))).toBe(true);
    expect(getTextOf(sug.state, nth(seq, 1, "block id"))).toBe("Y");
    expect(getSuggestions(sug.state).map((s) => s.kind)).toEqual(["insertion"]);
    // caret lands after the last pasted line ("Y") in the new block, before any suffix.
    expect(sug.selection.focus.blockId).toBe(seq[1]);
    expect(sug.selection.focus.offset).toBe(1);

    const accepted = reduceEditor(freshCollapsedPaste("X\nY").editor, { type: "ACCEPT_ALL_SUGGESTIONS" }, suggestingConfig);
    expect(blockSeq(accepted).map((id) => getTextOf(accepted.state, id))).toEqual(["abcX", "Y", "def"]);
    expect(getSuggestions(accepted.state)).toHaveLength(0);

    const rejected = reduceEditor(freshCollapsedPaste("X\nY").editor, { type: "REJECT_ALL_SUGGESTIONS" }, suggestingConfig);
    expect(blockSeq(rejected).map((id) => getTextOf(rejected.state, id))).toEqual(["abc", "def"]);
    expect(getSuggestions(rejected.state)).toHaveLength(0);
  });

  it("paste over a SINGLE-block selection: strikes selection + tracks insert; accept removes struck + keeps text; reject restores", () => {
    expect(getSuggestions(freshSingleBlockPaste().editor.state).map((s) => s.kind).sort()).toEqual(["deletion", "insertion"]);
    const accepted = reduceEditor(freshSingleBlockPaste().editor, { type: "ACCEPT_ALL_SUGGESTIONS" }, suggestingConfig);
    expect(getTextOf(accepted.state, nth(blockSeq(accepted), 0, "block id"))).toBe("aXc"); // b struck-removed, X kept
    expect(getSuggestions(accepted.state)).toHaveLength(0);
    const rejected = reduceEditor(freshSingleBlockPaste().editor, { type: "REJECT_ALL_SUGGESTIONS" }, suggestingConfig);
    expect(blockSeq(rejected).map((id) => getTextOf(rejected.state, id))).toEqual(["abc", "def"]);
    expect(getSuggestions(rejected.state)).toHaveLength(0);
  });

  it("paste over a CROSS-block selection: strikes both blocks + join; accept merges to ONE flow; reject restores", () => {
    const { editor: sug, p1 } = freshCrossBlockPaste();
    expect(hasJoinEmbed(sug, p1)).toBe(true);
    expect(getSuggestions(sug.state).map((s) => s.kind).sort()).toEqual(["deletion", "insertion"]);

    const accepted = reduceEditor(freshCrossBlockPaste().editor, { type: "ACCEPT_ALL_SUGGESTIONS" }, suggestingConfig);
    expect(blockSeq(accepted).map((id) => getTextOf(accepted.state, id))).toEqual(["aXf"]);
    expect(getSuggestions(accepted.state)).toHaveLength(0);

    const rejected = reduceEditor(freshCrossBlockPaste().editor, { type: "REJECT_ALL_SUGGESTIONS" }, suggestingConfig);
    expect(blockSeq(rejected).map((id) => getTextOf(rejected.state, id))).toEqual(["abc", "def"]);
    expect(getSuggestions(rejected.state)).toHaveLength(0);
  });

  it("multi-line paste inherits the caret block's TYPE+ATTRS (heading), not paragraph (accept keeps headings)", () => {
    const mk = (): EditorState => {
      let e = createInitialEditorState(directConfig);
      e = reduceEditor(e, { type: "INSERT_TEXT", text: "abc" }, directConfig);
      e = reduceEditor(e, { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } }, directConfig);
      const h = bodyParaId(e);
      return paste(caretAt(e, h, 3), "X\nY", suggestingConfig);
    };
    const accepted = reduceEditor(mk(), { type: "ACCEPT_ALL_SUGGESTIONS" }, suggestingConfig);
    const seq = blockSeq(accepted);
    expect(seq.length).toBe(2);
    // The new "Y" block inherits the source HEADING type + level (would be a plain
    // "paragraph" if the fragment hardcoded the type).
    expect(getBlock(accepted.state, nth(seq, 0, "block id"))?.type).toBe("heading");
    expect(getBlock(accepted.state, nth(seq, 1, "block id"))?.type).toBe("heading");
    expect(getBlock(accepted.state, nth(seq, 1, "block id"))?.attrs.level).toBe(1);
  });

  it("footnote-body collapsed two-line paste tracks + resolves in the body tree (MT round-trip)", () => {
    const initial = createInitialEditorState(directConfig);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "x" }, directConfig);
    const withFn = reduceEditor(typed, { type: "INSERT_FOOTNOTE" }, directConfig);
    const bodyPara = withFn.selection.focus.blockId;
    const seeded = reduceEditor(withFn, { type: "INSERT_TEXT", text: "abc" }, directConfig);
    expect(selectionContextOf(seeded.state, bodyPara)).not.toBe(seeded.state.rootId);

    const sug = paste(caretAt(seeded, bodyPara, 3), "P\nQ", suggestingConfig);
    expect(getSuggestions(sug.state).map((s) => s.kind)).toEqual(["insertion"]);
    expect(hasSplitEmbed(sug, bodyPara)).toBe(true);

    const accepted = reduceEditor(sug, { type: "ACCEPT_ALL_SUGGESTIONS" }, suggestingConfig);
    expect(textOfResolved(accepted, bodyPara)).toBe("abcP");
    expect(getSuggestions(accepted.state)).toHaveLength(0);
  });

  it("direct-mode multi-line paste is byte-identical to today (regression lock)", () => {
    const base = stateWithTwoParagraphs();
    const p1 = bodyParaId(base);
    const direct = paste(
      reduceEditor(base, { type: "SET_SELECTION", selection: createSpan(createPosition(p1, 3), createPosition(p1, 3)) }, directConfig),
      "X\nY\nZ",
      directConfig,
    );
    // p1 keeps "abcX"; two new blocks "Y", "Z"; original "def" follows. No suggestions.
    expect(blockSeq(direct).map((id) => getTextOf(direct.state, id))).toEqual(["abcX", "Y", "Z", "def"]);
    expect(getSuggestions(direct.state)).toHaveLength(0);
  });
});
