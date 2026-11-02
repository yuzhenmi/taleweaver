/**
 * Comments slice 3: editor actions. Behavior-level tests through `reduceEditor`
 * for ADD_COMMENT / RESOLVE_COMMENT / REOPEN_COMMENT / DELETE_COMMENT /
 * ADD_REPLY.
 *
 * The anchor model is paired zero-width `comment-start`/`comment-end` marker
 * embeds (slices 0-2); these tests assert via the `getComments` read surface and
 * via the marker embeds in the affected blocks' inline content.
 */
import { finalSectionOf } from "../../test-utils/document-builders";
import { EDITOR_INTERNAL } from "../editor-internal";
import { describe, it, expect } from "vitest";
import {
  config,
  createPosition,
  createSpan,
  createEditor,
  type Editor,
} from "./test-helpers";
import {
  getBlock,
  getComments,
  COMMENT_START_EMBED_TYPE,
  COMMENT_END_EMBED_TYPE,
  type BlockId,
  type CommentId,
} from "../../state";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const CID = "c1" as CommentId;

/** The first body paragraph id under the document root. */
function bodyParaId(editor: Editor): BlockId {
  const root = getBlock(editor.document, finalSectionOf(editor.document)); // the root holds sections
  const id = root?.firstChildId;
  if (id === undefined || id === null) {
    throw new Error("document root has no first child paragraph");
  }
  return id;
}

/** Count the comment marker embeds (start + end) for `id` in a block. */
function markerCount(editor: Editor, blockId: BlockId, id: CommentId): number {
  const items = getBlock(editor.document, blockId)?.inlineContent?.items ?? [];
  let n = 0;
  for (const it of items) {
    if (it.kind !== "embed") continue;
    if (it.embedType !== COMMENT_START_EMBED_TYPE && it.embedType !== COMMENT_END_EMBED_TYPE) {
      continue;
    }
    if (it.properties.commentId === id) n += 1;
  }
  return n;
}

/** Build an editor with a single paragraph of `text`. */
function withText(text: string): { editor: Editor; paraId: BlockId } {
  const initial = createEditor(config);
  initial.dispatch({ type: "INSERT_TEXT", text });
  return { editor: initial, paraId: bodyParaId(initial) };
}

/** Place a selection (anchor → focus offsets in `paraId`). */
function selectRange(
  editor: Editor,
  paraId: BlockId,
  anchorOffset: number,
  focusOffset: number,
): Editor {
  editor.dispatch({
      type: "SET_SELECTION",
      selection: createSpan(
        createPosition(paraId, anchorOffset),
        createPosition(paraId, focusOffset),
      ),
    });
    return editor;
}

const addCommentAction = (id: CommentId) =>
  ({ type: "ADD_COMMENT", id, author: "alice", body: "needs work", createdAt: 1000 }) as const;

describe("handleAddComment — ADD_COMMENT", () => {
  it("adds a comment over an expanded main-body range; record live, markers present", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4); // select "bcd"
    const before = placed.snapshot();
    placed.dispatch(addCommentAction(CID));

    expect(placed.document).not.toBe(before.document);
    const comments = getComments(placed.document);
    expect(comments.length).toBe(1);
    const comment0 = nth(comments, 0, "comment");
    expect(comment0.id).toBe(CID);
    expect(comment0.resolved).toBe(false);
    expect(comment0.range.orphaned).toBe(false); // live (well-formed pair)
    // Both markers (start + end) present in the paragraph.
    expect(markerCount(placed, paraId, CID)).toBe(2);
  });

  it("no-ops on a COLLAPSED selection (returns the same editor reference; no comment)", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 2, 2); // collapsed caret
    const before = placed.snapshot();
    placed.dispatch(addCommentAction(CID));

    expect(placed.document).toBe(before.document);
    expect(placed.selection).toBe(before.selection);
    expect(getComments(placed.document).length).toBe(0);
  });

  it("no-ops when the selection is NOT in the main body (caret in a footnote body)", () => {
    const { editor } = withText("abc");
    // INSERT_FOOTNOTE leaves the caret inside the new footnote body (a non-root
    // context). A comment there is body-only-rejected even with an expanded sel.
    editor.dispatch({ type: "INSERT_FOOTNOTE" });
    const fnPara = editor.selection.focus.blockId;
    // Type into the footnote body, then select it.
    editor.dispatch({ type: "INSERT_TEXT", text: "note" });
    editor.dispatch({
        type: "SET_SELECTION",
        selection: createSpan(createPosition(fnPara, 0), createPosition(fnPara, 4)),
      });
    const before = editor.snapshot();
    editor.dispatch(addCommentAction(CID));

    expect(editor.document).toBe(before.document);
    expect(editor.selection).toBe(before.selection);
    expect(getComments(editor.document).length).toBe(0);
  });

  it("preserves the visible selection across the +2 markers — SAME-BLOCK, forward", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4); // forward: anchor 1, focus 4
    placed.dispatch(addCommentAction(CID));

    // Markers OUTSIDE: start-marker at 1, end-marker at original-5 (after the +1
    // shift from the start-marker). Visible selection wraps the same "bcd":
    // anchor 1+1=2, focus 4+1=5.
    expect(placed.selection.anchor).toEqual(createPosition(paraId, 2));
    expect(placed.selection.focus).toEqual(createPosition(paraId, 5));
  });

  it("preserves direction across the +2 markers — SAME-BLOCK, backward", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 4, 1); // backward: anchor 4, focus 1
    placed.dispatch(addCommentAction(CID));

    // start = offset 1, end = offset 4. anchor was at `end` → stays at the new
    // end (5); focus stays at the new start (2). Same chars, reversed.
    expect(placed.selection.anchor).toEqual(createPosition(paraId, 5));
    expect(placed.selection.focus).toEqual(createPosition(paraId, 2));
  });

  it("preserves the visible selection across the +2 markers — CROSS-BLOCK", () => {
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "abc" });
    initial.dispatch({ type: "SPLIT_NODE" });
    const firstId = bodyParaId(initial); // the split's head (new id)
    initial.dispatch({ type: "INSERT_TEXT", text: "def" });
    const secondId = initial.selection.focus.blockId;
    expect(secondId).not.toBe(firstId);

    // Select from para1 offset 1 → para2 offset 2 (forward, cross-block).
    initial.dispatch({
        type: "SET_SELECTION",
        selection: createSpan(createPosition(firstId, 1), createPosition(secondId, 2)),
      });
    initial.dispatch(addCommentAction(CID));

    // start-marker in para1 at 1 → new start endpoint 1+1=2. end-marker in para2
    // at 2 → end endpoint UNSHIFTED (different block) = 2.
    expect(initial.selection.anchor).toEqual(createPosition(firstId, 2));
    expect(initial.selection.focus).toEqual(createPosition(secondId, 2));
    // One marker in each block.
    expect(markerCount(initial, firstId, CID)).toBe(1);
    expect(markerCount(initial, secondId, CID)).toBe(1);
  });

  it("no-ops on a cross-context selection (body ↔ footnote-body span)", () => {
    // Build a body paragraph with a footnote; then attempt a span whose anchor is
    // in the body and focus is in the footnote body. SET_SELECTION rejects a true
    // cross-context span (dev-throw), so we construct the span directly and feed
    // it to the handler via a hand-built editor whose selection straddles. The
    // simplest cross-context construction the harness supports: select the body
    // paragraph fully, then ADD over a span we set bypassing SET_SELECTION is not
    // possible — instead we assert the guard at the handler input by selecting an
    // empty-but-expanded body range adjacent to a footnote and confirm a normal
    // in-body comment still works (covered above), and rely on the non-main-body
    // case for the body-only guard. Here we verify the cross-context predicate by
    // a span main↔footnote built directly on the editor object.
    const { editor } = withText("abc");
    editor.dispatch({ type: "INSERT_FOOTNOTE" });
    const bodyId = bodyParaId(editor);
    const fnPara = editor.selection.focus.blockId;
    // Hand-build a cross-context selection on the editor (anchor in body, focus
    // in footnote). This bypasses the SET_SELECTION chokepoint deliberately to
    // exercise the handler's own isCrossContextSelection guard.
    const crossEditor = editor;
    crossEditor[EDITOR_INTERNAL].selection = createSpan(createPosition(bodyId, 0), createPosition(fnPara, 0));
    const before = crossEditor.snapshot();
    crossEditor.dispatch(addCommentAction(CID));

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(crossEditor.document).toBe(before.document);
    expect(getComments(crossEditor.document).length).toBe(0);
  });

  it("UNDO of ADD_COMMENT removes BOTH markers AND the record", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4);
    placed.dispatch(addCommentAction(CID));
    expect(getComments(placed.document).length).toBe(1);
    expect(markerCount(placed, paraId, CID)).toBe(2);

    placed.dispatch({ type: "UNDO" });
    expect(getComments(placed.document).length).toBe(0);
    expect(markerCount(placed, paraId, CID)).toBe(0);
  });

  it("does not swallow a later text edit into the comment's undo unit (own undo entry)", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4);
    placed.dispatch(addCommentAction(CID));
    // Caret to end, type a char (a SEPARATE undo unit — "command" never coalesces
    // with the following "insert").
    const atEnd = selectRange(placed, paraId, 8, 8); // 6 chars + 2 markers
    atEnd.dispatch({ type: "INSERT_TEXT", text: "Z" });
    expect(getComments(atEnd.document).length).toBe(1);

    // First UNDO removes the typed "Z" but KEEPS the comment.
    atEnd.dispatch({ type: "UNDO" });
    expect(getComments(atEnd.document).length).toBe(1);
    // Second UNDO removes the comment.
    atEnd.dispatch({ type: "UNDO" });
    expect(getComments(atEnd.document).length).toBe(0);
  });
});

describe("handleResolveComment / handleReopenComment", () => {
  function withComment(): Editor {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4);
    placed.dispatch(addCommentAction(CID));
    return placed;
  }

  it("RESOLVE flips resolved → true; REOPEN flips it back; both undoable", () => {
    const added = withComment();
    expect(nth(getComments(added.document), 0, "comment").resolved).toBe(false);

    added.dispatch({ type: "RESOLVE_COMMENT", id: CID });
    expect(nth(getComments(added.document), 0, "comment").resolved).toBe(true);

    added.dispatch({ type: "REOPEN_COMMENT", id: CID });
    expect(nth(getComments(added.document), 0, "comment").resolved).toBe(false);

    // Undo the reopen → back to resolved.
    added.dispatch({ type: "UNDO" });
    expect(nth(getComments(added.document), 0, "comment").resolved).toBe(true);
    // Undo the resolve → back to open.
    added.dispatch({ type: "UNDO" });
    expect(nth(getComments(added.document), 0, "comment").resolved).toBe(false);
  });

  it("RESOLVE on an already-resolved comment is an identity no-op (same state ref)", () => {
    const added = withComment();
    added.dispatch({ type: "RESOLVE_COMMENT", id: CID });
    const before = added.snapshot();
    added.dispatch({ type: "RESOLVE_COMMENT", id: CID });
    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(added.document).toBe(before.document);
  });

  it("RESOLVE on an absent comment is an identity no-op (same editor ref)", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4); // an editor with NO comment
    const before = placed.snapshot();
    placed.dispatch({ type: "RESOLVE_COMMENT", id: "nope" as CommentId });
    expect(placed.document).toBe(before.document);
    expect(placed.selection).toBe(before.selection);
  });

  it("REOPEN on an already-open comment is an identity no-op (same state ref)", () => {
    const added = withComment(); // open by default
    const before = added.snapshot();
    added.dispatch({ type: "REOPEN_COMMENT", id: CID });
    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(added.document).toBe(before.document);
  });
});

describe("handleDeleteComment — DELETE_COMMENT", () => {
  it("removes the comment (record + markers) and is undoable (redo re-adds)", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4);
    placed.dispatch(addCommentAction(CID));
    expect(getComments(placed.document).length).toBe(1);
    expect(markerCount(placed, paraId, CID)).toBe(2);

    placed.dispatch({ type: "DELETE_COMMENT", id: CID });
    expect(getComments(placed.document).length).toBe(0);
    expect(markerCount(placed, paraId, CID)).toBe(0);

    // Undo re-adds, redo re-deletes.
    placed.dispatch({ type: "UNDO" });
    expect(getComments(placed.document).length).toBe(1);
    expect(markerCount(placed, paraId, CID)).toBe(2);

    placed.dispatch({ type: "REDO" });
    expect(getComments(placed.document).length).toBe(0);
  });

  it("no-ops when the id is absent (same editor reference)", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4);
    const before = placed.snapshot();
    placed.dispatch({ type: "DELETE_COMMENT", id: "nope" as CommentId });
    expect(placed.document).toBe(before.document);
    expect(placed.selection).toBe(before.selection);
  });

  it("leaves a VALID selection when the caret sits in an UNRELATED block (sidebar-driven)", () => {
    // Two paragraphs; comment on para1; caret in para2. Deleting the comment
    // strips markers from para1 only, so the para2 selection stays valid.
    const initial = createEditor(config);
    initial.dispatch({ type: "INSERT_TEXT", text: "abc" });
    initial.dispatch({ type: "SPLIT_NODE" });
    const firstId = bodyParaId(initial); // the split's head (new id)
    initial.dispatch({ type: "INSERT_TEXT", text: "defgh" });
    const secondId = initial.selection.focus.blockId;

    // Comment over "bc" in para1.
    initial.dispatch({
        type: "SET_SELECTION",
        selection: createSpan(createPosition(firstId, 1), createPosition(firstId, 3)),
      });
    initial.dispatch(addCommentAction(CID));

    // Caret in para2 at offset 3 (unrelated block).
    initial.dispatch({
        type: "SET_SELECTION",
        selection: createSpan(createPosition(secondId, 3), createPosition(secondId, 3)),
      });
    initial.dispatch({ type: "DELETE_COMMENT", id: CID });

    expect(getComments(initial.document).length).toBe(0);
    // The para2 selection is unchanged and in range (para2 length is 5 ≥ 3).
    expect(initial.selection.focus).toEqual(createPosition(secondId, 3));
    const para2Len =
      getBlock(initial.document, secondId)?.inlineContent?.items.reduce(
        (n, it) => n + (it.kind === "text" ? it.text.length : 1),
        0,
      ) ?? 0;
    expect(initial.selection.focus.offset).toBeLessThanOrEqual(para2Len);
  });

  it("remaps the caret through the stripped markers when it sits IN the marked block (M-1)", () => {
    // Caret physically inside the marker-bearing block (not the sidebar path).
    // Para "abcdef"; comment over "bcd" inserts a start marker at offset 1 and an
    // end marker at offset 5 ⇒ the block is 8 offsets wide. Caret at the block END
    // (offset 8). Deleting the comment strips both zero-width markers, shrinking the
    // block to 6 offsets — the pass-through selection (offset 8) would be PAST the
    // new length. The handler must remap the caret through the removal: 8 − 2
    // stripped-before = offset 6 (end of "abcdef"), which is valid AND the same
    // visual position.
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4); // "bcd"
    placed.dispatch(addCommentAction(CID));
    expect(markerCount(placed, paraId, CID)).toBe(2);

    // Collapsed caret at the END of the marked block (offset 8 = past "f" + 2 markers).
    placed.dispatch({
        type: "SET_SELECTION",
        selection: createSpan(createPosition(paraId, 8), createPosition(paraId, 8)),
      });
    placed.dispatch({ type: "DELETE_COMMENT", id: CID });

    expect(getComments(placed.document).length).toBe(0);
    expect(markerCount(placed, paraId, CID)).toBe(0);
    // The caret is remapped to offset 6 (end of "abcdef") — valid and visually correct.
    const paraLen =
      getBlock(placed.document, paraId)?.inlineContent?.items.reduce(
        (n, it) => n + (it.kind === "text" ? it.text.length : 1),
        0,
      ) ?? 0;
    expect(paraLen).toBe(6);
    expect(placed.selection.focus).toEqual(createPosition(paraId, 6));
    expect(placed.selection.anchor).toEqual(createPosition(paraId, 6));
    expect(placed.selection.focus.offset).toBeLessThanOrEqual(paraLen);
  });
});

describe("handleAddReply — ADD_REPLY", () => {
  it("appends a reply to the record's replies", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4);
    placed.dispatch(addCommentAction(CID));
    expect(nth(getComments(placed.document), 0, "comment").replies.length).toBe(0);

    placed.dispatch({
        type: "ADD_REPLY",
        commentId: CID,
        replyId: "r1",
        author: "bob",
        body: "agreed",
        createdAt: 2000,
      });
    const replies = nth(getComments(placed.document), 0, "comment").replies;
    expect(replies.length).toBe(1);
    const reply0 = nth(replies, 0, "reply");
    expect(reply0.id).toBe("r1");
    expect(reply0.author).toBe("bob");
    expect(reply0.body).toBe("agreed");
    expect(reply0.createdAt).toBe(2000);
  });

  it("no-ops when the comment is absent (same editor reference)", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4); // no comment exists
    const before = placed.snapshot();
    placed.dispatch({
        type: "ADD_REPLY",
        commentId: "nope" as CommentId,
        replyId: "r1",
        author: "bob",
        body: "x",
        createdAt: 2000,
      });
    expect(placed.document).toBe(before.document);
    expect(placed.selection).toBe(before.selection);
  });

  it("is undoable — UNDO removes the reply, leaving the comment", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4);
    placed.dispatch(addCommentAction(CID));
    placed.dispatch({
        type: "ADD_REPLY",
        commentId: CID,
        replyId: "r1",
        author: "bob",
        body: "agreed",
        createdAt: 2000,
      });
    expect(nth(getComments(placed.document), 0, "comment").replies.length).toBe(1);

    placed.dispatch({ type: "UNDO" });
    // The reply is its own "command" undo unit: one UNDO drops the reply but
    // the comment record + markers survive (a separate prior entry).
    const comments = getComments(placed.document);
    expect(comments.length).toBe(1);
    expect(nth(comments, 0, "comment").replies.length).toBe(0);
  });
});
