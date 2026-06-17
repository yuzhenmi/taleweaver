/**
 * FN-7.1: `INSERT_FOOTNOTE` editor action + handler.
 *
 * Dispatching INSERT_FOOTNOTE splices a `footnote-anchor` embed at the caret,
 * creates a one-paragraph footnote body (CONTAINER root + paragraph child) in
 * `embedContents`, and places a collapsed caret in the new body's paragraph so
 * the user can immediately type. Mirrors the INSERT_HEADER/FOOTER vertical
 * slice, minus the idempotency check (every call inserts a NEW anchor).
 *
 * These tests run at editor-behavior level through `reduceEditor` and assert
 * via `getEmbedContent` / `resolveBlock` / `collectFootnoteAnchors`.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  reduceEditor,
  createInitialEditorState,
  getTextOf,
  type EditorState,
} from "./test-helpers";
import {
  getBlock,
  getEmbedContent,
  resolveBlock,
  createPosition,
  createSpan,
  FOOTNOTE_ANCHOR_EMBED_TYPE,
} from "../../state";
import type { BlockId } from "../../state";
import { collectFootnoteAnchors, footnoteNumbers } from "../../footnotes";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/** Concatenate the text-item runs of an inlineContent items list. */
function joinText(
  items: ReadonlyArray<{ kind: string; text?: string }> | undefined,
): string {
  return (items ?? [])
    .map((i) => (i.kind === "text" ? (i as { text: string }).text : ""))
    .join("");
}

/** The id of the first body paragraph under the document root. */
function bodyParaId(editor: EditorState): BlockId {
  const root = getBlock(editor.state, editor.state.rootId);
  const id = root?.firstChildId;
  if (id === undefined || id === null) {
    throw new Error("document root has no first child paragraph");
  }
  return id;
}

/** All footnote-anchor embeds in a leaf block's inlineContent. */
function anchorEmbedsOf(
  editor: EditorState,
  blockId: BlockId,
): ReadonlyArray<{ contentBlockId: BlockId }> {
  const block = getBlock(editor.state, blockId);
  const items = block?.inlineContent?.items ?? [];
  const out: { contentBlockId: BlockId }[] = [];
  for (const it of items) {
    if (it.kind !== "embed") continue;
    if (it.embedType !== FOOTNOTE_ANCHOR_EMBED_TYPE) continue;
    const cb = it.properties.contentBlockId;
    if (typeof cb === "string") out.push({ contentBlockId: cb as BlockId });
  }
  return out;
}

describe("handleInsertFootnote — INSERT_FOOTNOTE", () => {
  it("replaces a non-collapsed selection (deletes it) before inserting the anchor, as one undo step", () => {
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abcdef" }, config);
    const paraId = bodyParaId(typed);
    // Select "cd" (offset 2..4).
    const placed = reduceEditor(
      typed,
      { type: "SET_SELECTION", selection: createSpan(createPosition(paraId, 2), createPosition(paraId, 4)) },
      config,
    );

    const next = reduceEditor(placed, { type: "INSERT_FOOTNOTE" }, config);
    // "cd" deleted; the anchor sits between "ab" and "ef".
    expect(getTextOf(next.state, paraId)).toBe("abef");
    expect(anchorEmbedsOf(next, paraId).length).toBe(1);

    // ONE undo step restores "abcdef" AND removes the anchor + body.
    const undone = reduceEditor(next, { type: "UNDO" }, config);
    expect(getTextOf(undone.state, paraId)).toBe("abcdef");
    expect(anchorEmbedsOf(undone, paraId).length).toBe(0);
  });

  it("splices a footnote-anchor at the caret, creates the body, and carets into the body paragraph", () => {
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abc" }, config);
    const paraId = bodyParaId(typed);

    // Caret at offset 1 (between "a" and "bc").
    const placed = reduceEditor(
      typed,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: paraId, offset: 1 },
          focus: { blockId: paraId, offset: 1 },
        },
      },
      config,
    );

    const next = reduceEditor(placed, { type: "INSERT_FOOTNOTE" }, config);

    // A new state (real change).
    expect(next.state).not.toBe(placed.state);

    // The leaf gained exactly one footnote-anchor embed.
    const anchors = anchorEmbedsOf(next, paraId);
    expect(anchors.length).toBe(1);
    const bodyRootId = nth(anchors, 0, "anchor").contentBlockId;

    // The body root + its paragraph child exist in embedContents.
    const bodyRoot = getEmbedContent(next.state, bodyRootId);
    expect(bodyRoot).not.toBeNull();
    expect(bodyRoot?.type).toBe("footnote-body");
    expect(bodyRoot?.parentId).toBeNull();
    expect(bodyRoot?.inlineContent).toBeNull();

    const firstParagraphId = bodyRoot?.firstChildId as BlockId | null;
    expect(firstParagraphId).not.toBeNull();
    if (firstParagraphId === null) return;
    const bodyPara = resolveBlock(next.state, firstParagraphId)?.block;
    expect(bodyPara?.type).toBe("paragraph");
    expect(bodyPara?.parentId).toBe(bodyRootId);

    // The caret is collapsed at the start of the body paragraph.
    expect(next.selection.anchor.blockId).toBe(firstParagraphId);
    expect(next.selection.anchor.offset).toBe(0);
    expect(next.selection.focus.blockId).toBe(firstParagraphId);
    expect(next.selection.focus.offset).toBe(0);
  });

  it("typing a character after INSERT_FOOTNOTE lands in the footnote body (routes via resolveBlock)", () => {
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "x" }, config);
    const withFn = reduceEditor(typed, { type: "INSERT_FOOTNOTE" }, config);

    const firstParagraphId = withFn.selection.focus.blockId;
    const afterType = reduceEditor(withFn, { type: "INSERT_TEXT", text: "Hi" }, config);

    // The body paragraph now reads "Hi".
    const bodyPara = resolveBlock(afterType.state, firstParagraphId)?.block;
    expect(joinText(bodyPara?.inlineContent?.items)).toBe("Hi");
    // Caret advanced inside the body paragraph.
    expect(afterType.selection.focus.blockId).toBe(firstParagraphId);
    expect(afterType.selection.focus.offset).toBe(2);
  });

  it("one undo reverts BOTH the anchor and the body (one history entry)", () => {
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abc" }, config);
    const paraId = bodyParaId(typed);
    const next = reduceEditor(typed, { type: "INSERT_FOOTNOTE" }, config);

    const anchors = anchorEmbedsOf(next, paraId);
    expect(anchors.length).toBe(1);
    const bodyRootId = nth(anchors, 0, "anchor").contentBlockId;
    expect(getEmbedContent(next.state, bodyRootId)).not.toBeNull();

    const undone = reduceEditor(next, { type: "UNDO" }, config);

    // Anchor gone from the leaf, body gone from embedContents.
    expect(anchorEmbedsOf(undone, paraId).length).toBe(0);
    expect(getEmbedContent(undone.state, bodyRootId)).toBeNull();
    // Original text intact.
    expect(joinText(getBlock(undone.state, paraId)?.inlineContent?.items)).toBe("abc");
  });

  it("a SECOND INSERT_FOOTNOTE adds a 2nd anchor; markers renumber 1,2 (computeFootnoteNumbers)", () => {
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abc" }, config);
    const paraId = bodyParaId(typed);

    // Insert the FIRST footnote with the caret at the END (offset 3).
    const atEnd = reduceEditor(
      typed,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: paraId, offset: 3 },
          focus: { blockId: paraId, offset: 3 },
        },
      },
      config,
    );
    const first = reduceEditor(atEnd, { type: "INSERT_FOOTNOTE" }, config);

    // Insert the SECOND footnote BEFORE the first (caret back at offset 0).
    const atStart = reduceEditor(
      first,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: paraId, offset: 0 },
          focus: { blockId: paraId, offset: 0 },
        },
      },
      config,
    );
    const second = reduceEditor(atStart, { type: "INSERT_FOOTNOTE" }, config);

    // Two anchors in the leaf.
    const anchors = anchorEmbedsOf(second, paraId);
    expect(anchors.length).toBe(2);

    // The numbering engine renumbers in DOCUMENT ORDER: the anchor inserted at
    // offset 0 is #1, the one at the end is #2 — regardless of insert order.
    const ordered = collectFootnoteAnchors(second.state);
    expect(ordered.length).toBe(2);
    const numbers = footnoteNumbers(ordered, {
      reset: "continuous",
      format: "decimal",
    });
    expect(numbers.get(nth(ordered, 0, "anchor").contentBlockId)?.formatted).toBe("1");
    expect(numbers.get(nth(ordered, 1, "anchor").contentBlockId)?.formatted).toBe("2");
    // The earlier-in-document anchor's body is the one inserted last (at 0).
    expect(numbers.get(nth(anchors, 0, "anchor").contentBlockId)?.value).toBe(1);
    expect(numbers.get(nth(anchors, 1, "anchor").contentBlockId)?.value).toBe(2);
  });

  it("a SECOND INSERT_FOOTNOTE with the caret JUST AFTER the first marker inserts cleanly (no crash); markers renumber 1,2", () => {
    // Regression for the marker-adjacent insert: after the first footnote, the
    // anchor is a 1-unit embed at the end of "abc" (index 3). Placing the caret
    // at offset 4 — the position immediately AFTER that embed — and inserting a
    // second footnote splices the new anchor right after the first, with no
    // out-of-range / normalization failure on the embed-adjacent splice.
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abc" }, config);
    const paraId = bodyParaId(typed);

    const atEnd = reduceEditor(
      typed,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: paraId, offset: 3 },
          focus: { blockId: paraId, offset: 3 },
        },
      },
      config,
    );
    const first = reduceEditor(atEnd, { type: "INSERT_FOOTNOTE" }, config);

    // Caret to offset 4 = "abc" (3) + the 1-unit first anchor — JUST AFTER the
    // marker in the main body.
    const afterMarker = reduceEditor(
      first,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: paraId, offset: 4 },
          focus: { blockId: paraId, offset: 4 },
        },
      },
      config,
    );
    const second = reduceEditor(afterMarker, { type: "INSERT_FOOTNOTE" }, config);

    // Two anchors now live on the leaf (no crash on the embed-adjacent splice).
    const anchors = anchorEmbedsOf(second, paraId);
    expect(anchors.length).toBe(2);

    // Both anchors sit back-to-back at the end of "abc": the two trailing items
    // are the embeds, in document order.
    const items = getBlock(second.state, paraId)?.inlineContent?.items ?? [];
    const embeds = items.filter(
      (it) =>
        it.kind === "embed" && it.embedType === FOOTNOTE_ANCHOR_EMBED_TYPE,
    );
    expect(embeds.length).toBe(2);

    // Numbering renumbers in document order: 1, 2.
    const ordered = collectFootnoteAnchors(second.state);
    expect(ordered.length).toBe(2);
    const numbers = footnoteNumbers(ordered, {
      reset: "continuous",
      format: "decimal",
    });
    expect(numbers.get(nth(ordered, 0, "anchor").contentBlockId)?.formatted).toBe("1");
    expect(numbers.get(nth(ordered, 1, "anchor").contentBlockId)?.formatted).toBe("2");
  });

  it("refuses a nested footnote: with the caret already in a footnote body, INSERT_FOOTNOTE returns the editor unchanged", () => {
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abc" }, config);
    const withFn = reduceEditor(typed, { type: "INSERT_FOOTNOTE" }, config);

    // The caret is now in the footnote body (a non-main context).
    const before = withFn;
    const after = reduceEditor(before, { type: "INSERT_FOOTNOTE" }, config);

    // No-op: same STATE reference (the guard returns the editor with its state
    // unchanged). Phase 0b's reduceEditor entry-clear of `lastDirtyIds` rewraps
    // the editor object, so the no-op contract is state-identity, not editor-
    // object identity (mirrors the #141 `result.state === editor.state` rule).
    expect(after.state).toBe(before.state);
    // No second anchor on the main body leaf.
    const paraId = bodyParaId(typed);
    expect(anchorEmbedsOf(after, paraId).length).toBe(1);
  });

  it("refuses a footnote with the caret in a header body (cross-context guard)", () => {
    const initial = createInitialEditorState(config);
    const withHeader = reduceEditor(initial, { type: "INSERT_HEADER" }, config);
    // The caret is now inside the header body (a templateContents non-main context).
    const after = reduceEditor(withHeader, { type: "INSERT_FOOTNOTE" }, config);

    // State-identity no-op (Phase 0b entry-clear rewraps the editor object —
    // see the nested-footnote refuse test above).
    expect(after.state).toBe(withHeader.state);
    // No footnote anchors anywhere in the main document.
    expect(collectFootnoteAnchors(after.state).length).toBe(0);
  });

  it("DELETE_BACKWARD over the anchor removes BOTH the anchor and the body (FN-1 cascade through the editor)", () => {
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abc" }, config);
    const paraId = bodyParaId(typed);

    // Insert the footnote with the caret at the END of "abc" (offset 3) so the
    // anchor sits at index 3 in the leaf's inlineContent.
    const atEnd = reduceEditor(
      typed,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: paraId, offset: 3 },
          focus: { blockId: paraId, offset: 3 },
        },
      },
      config,
    );
    const withFn = reduceEditor(atEnd, { type: "INSERT_FOOTNOTE" }, config);

    const anchors = anchorEmbedsOf(withFn, paraId);
    expect(anchors.length).toBe(1);
    const bodyRootId = nth(anchors, 0, "anchor").contentBlockId;
    expect(getEmbedContent(withFn.state, bodyRootId)).not.toBeNull();

    // Move the caret to just AFTER the anchor in the main body (offset 4 = 3
    // chars + 1-unit embed), then backspace over it.
    const afterAnchor = reduceEditor(
      withFn,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: paraId, offset: 4 },
          focus: { blockId: paraId, offset: 4 },
        },
      },
      config,
    );
    const deleted = reduceEditor(afterAnchor, { type: "DELETE_BACKWARD" }, config);

    // Anchor removed from the leaf AND body cascade-deleted.
    expect(anchorEmbedsOf(deleted, paraId).length).toBe(0);
    expect(getEmbedContent(deleted.state, bodyRootId)).toBeNull();
    // "abc" survives (only the embed was deleted).
    expect(joinText(getBlock(deleted.state, paraId)?.inlineContent?.items)).toBe("abc");
  });
});

/**
 * Bug-A-class siblings: keyboard navigation and selection ACROSS an inline-block
 * footnote call-marker. The marker is a 1-unit `EmbedItem` in the host paragraph
 * — `"abc"` (offsets 0..3) followed by the marker, which occupies one offset
 * unit, so the position BEFORE the marker is offset 3 and the position AFTER is
 * offset 4 (= block end). Every nav/selection primitive must treat the marker as
 * a SINGLE atomic cursor stop with a before/after position — never step into its
 * inner body text, never skip it, never land off-by-one.
 *
 * Driven through the real `reduceEditor` (the same surface ArrowLeft/Right,
 * Ctrl+Arrow, Shift+Arrow, Home/End map to). Fixture: type "abc", caret to the
 * end (offset 3), INSERT_FOOTNOTE splices the marker at 3, then SET_SELECTION
 * places a collapsed caret back in the MAIN paragraph (INSERT_FOOTNOTE leaves the
 * caret inside the new body) at the requested offset.
 */
describe("nav + selection across an inline-block footnote marker (Bug-A siblings)", () => {
  /**
   * Build an editor whose main paragraph is "abc" + a footnote marker, with a
   * collapsed caret at `caretOffset` in that main paragraph. Returns the editor
   * and the main paragraph id. Offsets: 0..3 = "abc", 3 = before marker, 4 =
   * after marker (block end).
   */
  function markerFixture(caretOffset: number): {
    editor: EditorState;
    paraId: BlockId;
  } {
    const initial = createInitialEditorState(config);
    const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abc" }, config);
    const paraId = bodyParaId(typed);
    const atEnd = reduceEditor(
      typed,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: paraId, offset: 3 },
          focus: { blockId: paraId, offset: 3 },
        },
      },
      config,
    );
    const withFn = reduceEditor(atEnd, { type: "INSERT_FOOTNOTE" }, config);
    // The marker is now a 1-unit embed at index after "abc": block length is 4.
    expect(anchorEmbedsOf(withFn, paraId).length).toBe(1);
    // Caret back into the main paragraph at the requested offset.
    const editor = reduceEditor(
      withFn,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: paraId, offset: caretOffset },
          focus: { blockId: paraId, offset: caretOffset },
        },
      },
      config,
    );
    expect(editor.selection.focus.blockId).toBe(paraId);
    expect(editor.selection.focus.offset).toBe(caretOffset);
    return { editor, paraId };
  }

  // NB: MOVE_CURSOR / EXPAND_SELECTION / MOVE_LINE_BOUNDARY across the marker
  // moved to the print backend's nav suite (Phase 0b — geometric nav left core's
  // reducer): packages/print/src/nav/insert-footnote-nav.test.ts. The geometry-free
  // MOVE_WORD / DELETE_BACKWARD sibling cases stay here.

  // (3) MOVE_WORD across the marker treats it as a 1-unit barrier: forward from
  // before "abc" stops at the marker boundary (offset 3 = end of the word, before
  // the embed); a further forward steps the single embed unit to offset 4.
  // Backward from offset 4 (after marker) retreats over the 1-unit embed to 3.
  it("MOVE_WORD forward stops at the marker boundary (offset 3), then steps the embed to 4; never crashes/skips", () => {
    const { editor, paraId } = markerFixture(0);
    const fwd1 = reduceEditor(editor, { type: "MOVE_WORD", direction: "forward" }, config);
    // Word-forward over "abc" halts at the embed barrier = offset 3 (before marker).
    expect(fwd1.selection.focus.blockId).toBe(paraId);
    expect(fwd1.selection.focus.offset).toBe(3);
    const fwd2 = reduceEditor(fwd1, { type: "MOVE_WORD", direction: "forward" }, config);
    // The next word-forward steps the single embed unit → after the marker (4).
    expect(fwd2.selection.focus.offset).toBe(4);
  });

  it("MOVE_WORD backward from offset 4 (after marker) retreats over the 1-unit embed to offset 3", () => {
    const { editor, paraId } = markerFixture(4);
    const back = reduceEditor(editor, { type: "MOVE_WORD", direction: "backward" }, config);
    expect(back.selection.focus.blockId).toBe(paraId);
    expect(back.selection.focus.offset).toBe(3);
  });

  // (5) DELETE_BACKWARD from offset 4 (caret just AFTER the marker) deletes the
  // marker AND cascade-deletes its body — confirmed here in the nav context
  // (the offset-4 = after-the-1-unit-embed accounting is the same that ArrowLeft
  // and Shift+ArrowLeft rely on).
  it("DELETE_BACKWARD from offset 4 (after marker) deletes the marker + cascades the body", () => {
    const { editor, paraId } = markerFixture(4);
    const anchors = anchorEmbedsOf(editor, paraId);
    expect(anchors.length).toBe(1);
    const bodyRootId = nth(anchors, 0, "anchor").contentBlockId;
    expect(getEmbedContent(editor.state, bodyRootId)).not.toBeNull();

    const deleted = reduceEditor(editor, { type: "DELETE_BACKWARD" }, config);
    expect(anchorEmbedsOf(deleted, paraId).length).toBe(0);
    expect(getEmbedContent(deleted.state, bodyRootId)).toBeNull();
    // "abc" survives — only the 1-unit embed was removed.
    expect(joinText(getBlock(deleted.state, paraId)?.inlineContent?.items)).toBe("abc");
    // Caret collapses to where the marker was (offset 3, the end of "abc").
    expect(deleted.selection.focus.blockId).toBe(paraId);
    expect(deleted.selection.focus.offset).toBe(3);
  });
});
