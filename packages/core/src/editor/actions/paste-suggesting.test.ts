/**
 * Change-tracking PF-3: PASTE in suggesting mode inserts the pasted fragment as ONE
 * tracked insertion (via `replaceWithSuggestedFragment`) instead of mutating the
 * document destructively. A multi-line paste's inter-line breaks become split
 * TAGS (`insertionSuggestionId` on each new block); a paste OVER a selection
 * soft-deletes the selection (cross-block: a join tag per crossed boundary) and
 * inserts the fragment in ONE undoable op. Accept-all lands the paste for real;
 * reject-all restores the original document. Tracking is ALL-CONTEXT (main body AND
 * footnote / header / footer bodies) via the MT-4 `replaceSuggestionInputForBlock`
 * gate. Direct mode (no `suggestingAuthor`) keeps the destructive paste UNCHANGED.
 *
 * Behavior-level tests through the real reducer (`PASTE` action).
 */
import { finalSectionOf } from "../../test-utils/document-builders";
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
  endMarkOf,
  type BlockId,
} from "../../state";

const suggestingConfig: EditorConfig = { ...directConfig, suggestingAuthor: "alice" };

/** The first body paragraph id under the document root. */
function bodyParaId(editor: EditorState): BlockId {
  const id = firstChildId(editor.document);
  if (id === null) throw new Error("document root has no first child paragraph");
  return id;
}

/** Doc-order block ids under the MAIN document root. */
function blockSeq(editor: EditorState): BlockId[] {
  const out: BlockId[] = [];
  let id = getBlock(editor.document, finalSectionOf(editor.document))?.firstChildId ?? null;
  while (id) {
    out.push(id);
    id = getBlock(editor.document, id)?.nextSiblingId ?? null;
  }
  return out;
}

const textOfResolved = (editor: EditorState, id: BlockId): string =>
  (resolveBlock(editor.document, id)?.block?.inlineContent?.items ?? [])
    .map((it) => (it.kind === "text" ? it.text : ""))
    .join("");

/** The kind of the boundary ¶ drawn at the END of `id` (split / join / …), or null. */
const endMarkKind = (editor: EditorState, id: BlockId): string | null =>
  endMarkOf(editor.document, id)?.kind ?? null;

const paste = (e: EditorState, text: string): EditorState =>
  reduceEditor(e, { type: "PASTE", text });
const caretAt = (e: EditorState, id: BlockId, off: number): EditorState =>
  reduceEditor({ ...e, config: suggestingConfig }, { type: "SET_SELECTION", selection: createSpan(createPosition(id, off), createPosition(id, off)) });
const select = (e: EditorState, a: [BlockId, number], f: [BlockId, number]): EditorState =>
  reduceEditor({ ...e, config: suggestingConfig }, { type: "SET_SELECTION", selection: createSpan(createPosition(a[0], a[1]), createPosition(f[0], f[1])) });

// reduceEditor mutates the shared underlying Y.Doc in place, so accept and reject
// CANNOT run off the same pasted editor — each independent resolution needs a FRESH
// paste (mirrors the state-level fragment tests). These thunks rebuild from scratch.
function freshCollapsedPaste(text: string): { editor: EditorState; p1: BlockId } {
  const base = stateWithTwoParagraphs(); // "abc" / "def" (built directly, no suggestions)
  const p1 = bodyParaId(base);
  return { editor: paste(caretAt(base, p1, 3), text), p1 };
}
function freshSingleBlockPaste(): { editor: EditorState; p1: BlockId } {
  const base = stateWithTwoParagraphs();
  const p1 = bodyParaId(base);
  return { editor: paste(select(base, [p1, 1], [p1, 2]), "X"), p1 };
}
function freshCrossBlockPaste(): { editor: EditorState; p1: BlockId } {
  const base = stateWithTwoParagraphs(); // "abc" / "def"
  const p1 = bodyParaId(base);
  const p2 = getBlock(base.document, p1)?.nextSiblingId ?? null;
  if (p2 === null) throw new Error("expected a second paragraph");
  // Select p1[1..] .. p2[..2]: "bc" + break + "de"; paste "X".
  return { editor: paste(select(base, [p1, 1], [p2, 2]), "X"), p1 };
}

describe("handlePaste — suggesting mode (PF-3)", () => {
  it("collapsed caret, single-line paste: tracks ONE insertion, stamps the run; direct mode UNCHANGED", () => {
    const { editor: sug, p1 } = freshCollapsedPaste("X");
    expect(getTextOf(sug.document, p1)).toBe("abcX");
    const suggestions = getSuggestions(sug.document);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("insertion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");
    const items = getBlock(sug.document, p1)?.inlineContent?.items ?? [];
    const x = items.find((it) => it.kind === "text" && it.text === "X");
    expect(x?.kind === "text" && x.attrs.insertionSuggestionId).toBe(nth(suggestions, 0, "suggestion").id);
    expect(sug.selection.focus).toEqual(createPosition(p1, 4)); // caret after the pasted "X"

    // Direct mode (FRESH doc): same paste produces the text with NO suggestions.
    const dbase = stateWithTwoParagraphs();
    const dp1 = bodyParaId(dbase);
    const direct = paste(
      reduceEditor(dbase, { type: "SET_SELECTION", selection: createSpan(createPosition(dp1, 3), createPosition(dp1, 3)) }),
      "X",
    );
    expect(getTextOf(direct.document, dp1)).toBe("abcX");
    expect(getSuggestions(direct.document)).toHaveLength(0);
  });

  it("collapsed caret, two-line paste: ONE insertion + a split tag + two blocks; accept keeps split, reject removes paste", () => {
    const { editor: sug } = freshCollapsedPaste("X\nY");
    const seq = blockSeq(sug);
    // the inserted ¶ is the new head's own (keyed on its entry).
    expect(getTextOf(sug.document, nth(seq, 0, "block id"))).toBe("abcX");
    expect(endMarkKind(sug, nth(seq, 0, "block id"))).toBe("split");
    expect(getBlock(sug.document, nth(seq, 0, "block id"))?.breakSuggestion?.insertionId).toBe(getSuggestions(sug.document)[0]?.id);
    expect(getTextOf(sug.document, nth(seq, 1, "block id"))).toBe("Y");
    expect(getSuggestions(sug.document).map((s) => s.kind)).toEqual(["insertion"]);
    // caret lands after the last pasted line ("Y") in the new block, before any suffix.
    expect(sug.selection.focus.blockId).toBe(seq[1]);
    expect(sug.selection.focus.offset).toBe(1);

    const accepted = reduceEditor(freshCollapsedPaste("X\nY").editor, { type: "ACCEPT_ALL_SUGGESTIONS" });
    expect(blockSeq(accepted).map((id) => getTextOf(accepted.document, id))).toEqual(["abcX", "Y", "def"]);
    expect(getSuggestions(accepted.document)).toHaveLength(0);

    const rejected = reduceEditor(freshCollapsedPaste("X\nY").editor, { type: "REJECT_ALL_SUGGESTIONS" });
    expect(blockSeq(rejected).map((id) => getTextOf(rejected.document, id))).toEqual(["abc", "def"]);
    expect(getSuggestions(rejected.document)).toHaveLength(0);
  });

  it("paste over a SINGLE-block selection: strikes selection + tracks insert; accept removes struck + keeps text; reject restores", () => {
    expect(getSuggestions(freshSingleBlockPaste().editor.document).map((s) => s.kind).sort()).toEqual(["deletion", "insertion"]);
    const accepted = reduceEditor(freshSingleBlockPaste().editor, { type: "ACCEPT_ALL_SUGGESTIONS" });
    expect(getTextOf(accepted.document, nth(blockSeq(accepted), 0, "block id"))).toBe("aXc"); // b struck-removed, X kept
    expect(getSuggestions(accepted.document)).toHaveLength(0);
    const rejected = reduceEditor(freshSingleBlockPaste().editor, { type: "REJECT_ALL_SUGGESTIONS" });
    expect(blockSeq(rejected).map((id) => getTextOf(rejected.document, id))).toEqual(["abc", "def"]);
    expect(getSuggestions(rejected.document)).toHaveLength(0);
  });

  it("paste over a CROSS-block selection: strikes both blocks + join; accept merges to ONE flow; reject restores", () => {
    const { editor: sug, p1 } = freshCrossBlockPaste();
    expect(endMarkKind(sug, p1)).toBe("join");
    expect(getSuggestions(sug.document).map((s) => s.kind).sort()).toEqual(["deletion", "insertion"]);

    const accepted = reduceEditor(freshCrossBlockPaste().editor, { type: "ACCEPT_ALL_SUGGESTIONS" });
    expect(blockSeq(accepted).map((id) => getTextOf(accepted.document, id))).toEqual(["aXf"]);
    expect(getSuggestions(accepted.document)).toHaveLength(0);

    const rejected = reduceEditor(freshCrossBlockPaste().editor, { type: "REJECT_ALL_SUGGESTIONS" });
    expect(blockSeq(rejected).map((id) => getTextOf(rejected.document, id))).toEqual(["abc", "def"]);
    expect(getSuggestions(rejected.document)).toHaveLength(0);
  });

  it("multi-line paste inherits the caret block's TYPE+ATTRS (heading), not paragraph (accept keeps headings)", () => {
    const mk = (): EditorState => {
      let e = createInitialEditorState(directConfig);
      e = reduceEditor(e, { type: "INSERT_TEXT", text: "abc" });
      e = reduceEditor(e, { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } });
      const h = bodyParaId(e);
      return paste(caretAt(e, h, 3), "X\nY");
    };
    const accepted = reduceEditor(mk(), { type: "ACCEPT_ALL_SUGGESTIONS" });
    const seq = blockSeq(accepted);
    expect(seq.length).toBe(2);
    // The new "Y" block inherits the source HEADING type + level (would be a plain
    // "paragraph" if the fragment hardcoded the type).
    expect(getBlock(accepted.document, nth(seq, 0, "block id"))?.type).toBe("heading");
    expect(getBlock(accepted.document, nth(seq, 1, "block id"))?.type).toBe("heading");
    expect(getBlock(accepted.document, nth(seq, 1, "block id"))?.attrs.level).toBe(1);
  });

  it("footnote-body collapsed two-line paste tracks + resolves in the body tree (MT round-trip)", () => {
    const initial = createInitialEditorState(directConfig);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "x" });
    const withFn = reduceEditor(typed, { type: "INSERT_FOOTNOTE" });
    const bodyPara = withFn.selection.focus.blockId;
    const seeded = reduceEditor(withFn, { type: "INSERT_TEXT", text: "abc" });
    expect(selectionContextOf(seeded.document, bodyPara)).not.toBe(seeded.document.rootId);

    const sug = paste(caretAt(seeded, bodyPara, 3), "P\nQ");
    expect(getSuggestions(sug.document).map((s) => s.kind)).toEqual(["insertion"]);
    // The new head (before the body paragraph, which keeps "Q" + its ¶) holds "abcP".
    const head = resolveBlock(sug.document, bodyPara)?.block.prevSiblingId ?? null;
    if (head === null) throw new Error("expected a new head");
    expect(endMarkKind(sug, head)).toBe("split");
    const accepted = reduceEditor(sug, { type: "ACCEPT_ALL_SUGGESTIONS" });
    expect(textOfResolved(accepted, head)).toBe("abcP");
    expect(textOfResolved(accepted, bodyPara)).toBe("Q");
    expect(getSuggestions(accepted.document)).toHaveLength(0);
  });

  it("direct-mode multi-line paste is byte-identical to today (regression lock)", () => {
    const base = stateWithTwoParagraphs();
    const p1 = bodyParaId(base);
    const direct = paste(
      reduceEditor(base, { type: "SET_SELECTION", selection: createSpan(createPosition(p1, 3), createPosition(p1, 3)) }),
      "X\nY\nZ",
    );
    // p1 keeps "abcX"; two new blocks "Y", "Z"; original "def" follows. No suggestions.
    expect(blockSeq(direct).map((id) => getTextOf(direct.document, id))).toEqual(["abcX", "Y", "Z", "def"]);
    expect(getSuggestions(direct.document)).toHaveLength(0);
  });
});
