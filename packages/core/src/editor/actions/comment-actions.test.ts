/**
 * Comments slice 3: editor actions. Behavior-level tests through `reduceEditor`
 * for ADD_COMMENT / RESOLVE_COMMENT / REOPEN_COMMENT / DELETE_COMMENT /
 * ADD_REPLY.
 *
 * The anchor model is paired zero-width `comment-start`/`comment-end` marker
 * embeds (slices 0-2); these tests assert via the `getComments` read surface and
 * via the marker embeds in the affected blocks' inline content.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  reduceEditor,
  createInitialEditorState,
  createPosition,
  createSpan,
  type EditorState,
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
function bodyParaId(editor: EditorState): BlockId {
  const root = getBlock(editor.state, editor.state.rootId);
  const id = root?.firstChildId;
  if (id === undefined || id === null) {
    throw new Error("document root has no first child paragraph");
  }
  return id;
}

/** Count the comment marker embeds (start + end) for `id` in a block. */
function markerCount(editor: EditorState, blockId: BlockId, id: CommentId): number {
  const items = getBlock(editor.state, blockId)?.inlineContent?.items ?? [];
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
function withText(text: string): { editor: EditorState; paraId: BlockId } {
  const initial = createInitialEditorState(config);
  const typed = reduceEditor(initial, { type: "INSERT_TEXT", text }, config);
  return { editor: typed, paraId: bodyParaId(typed) };
}

/** Place a selection (anchor → focus offsets in `paraId`). */
function selectRange(
  editor: EditorState,
  paraId: BlockId,
  anchorOffset: number,
  focusOffset: number,
): EditorState {
  return reduceEditor(
    editor,
    {
      type: "SET_SELECTION",
      selection: createSpan(
        createPosition(paraId, anchorOffset),
        createPosition(paraId, focusOffset),
      ),
    },
    config,
  );
}

const addCommentAction = (id: CommentId) =>
  ({ type: "ADD_COMMENT", id, author: "alice", body: "needs work", createdAt: 1000 }) as const;

describe("handleAddComment — ADD_COMMENT", () => {
  it("adds a comment over an expanded main-body range; record live, markers present", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4); // select "bcd"
    const next = reduceEditor(placed, addCommentAction(CID), config);

    expect(next.state).not.toBe(placed.state);
    const comments = getComments(next.state);
    expect(comments.length).toBe(1);
    const comment0 = nth(comments, 0, "comment");
    expect(comment0.id).toBe(CID);
    expect(comment0.resolved).toBe(false);
    expect(comment0.range.orphaned).toBe(false); // live (well-formed pair)
    // Both markers (start + end) present in the paragraph.
    expect(markerCount(next, paraId, CID)).toBe(2);
  });

  it("no-ops on a COLLAPSED selection (returns the same editor reference; no comment)", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 2, 2); // collapsed caret
    const next = reduceEditor(placed, addCommentAction(CID), config);

    expect(next).toBe(placed);
    expect(getComments(next.state).length).toBe(0);
  });

  it("no-ops when the selection is NOT in the main body (caret in a footnote body)", () => {
    const { editor } = withText("abc");
    // INSERT_FOOTNOTE leaves the caret inside the new footnote body (a non-root
    // context). A comment there is body-only-rejected even with an expanded sel.
    const withFn = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    const fnPara = withFn.selection.focus.blockId;
    // Type into the footnote body, then select it.
    const typed = reduceEditor(withFn, { type: "INSERT_TEXT", text: "note" }, config);
    const placed = reduceEditor(
      typed,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(fnPara, 0), createPosition(fnPara, 4)),
      },
      config,
    );
    const next = reduceEditor(placed, addCommentAction(CID), config);

    expect(next).toBe(placed);
    expect(getComments(next.state).length).toBe(0);
  });

  it("preserves the visible selection across the +2 markers — SAME-BLOCK, forward", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4); // forward: anchor 1, focus 4
    const next = reduceEditor(placed, addCommentAction(CID), config);

    // Markers OUTSIDE: start-marker at 1, end-marker at original-5 (after the +1
    // shift from the start-marker). Visible selection wraps the same "bcd":
    // anchor 1+1=2, focus 4+1=5.
    expect(next.selection.anchor).toEqual(createPosition(paraId, 2));
    expect(next.selection.focus).toEqual(createPosition(paraId, 5));
  });

  it("preserves direction across the +2 markers — SAME-BLOCK, backward", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 4, 1); // backward: anchor 4, focus 1
    const next = reduceEditor(placed, addCommentAction(CID), config);

    // start = offset 1, end = offset 4. anchor was at `end` → stays at the new
    // end (5); focus stays at the new start (2). Same chars, reversed.
    expect(next.selection.anchor).toEqual(createPosition(paraId, 5));
    expect(next.selection.focus).toEqual(createPosition(paraId, 2));
  });

  it("preserves the visible selection across the +2 markers — CROSS-BLOCK", () => {
    const initial = createInitialEditorState(config);
    const p1 = reduceEditor(initial, { type: "INSERT_TEXT", text: "abc" }, config);
    const firstId = bodyParaId(p1);
    const split = reduceEditor(p1, { type: "SPLIT_NODE" }, config);
    const withSecond = reduceEditor(split, { type: "INSERT_TEXT", text: "def" }, config);
    const secondId = withSecond.selection.focus.blockId;
    expect(secondId).not.toBe(firstId);

    // Select from para1 offset 1 → para2 offset 2 (forward, cross-block).
    const placed = reduceEditor(
      withSecond,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(firstId, 1), createPosition(secondId, 2)),
      },
      config,
    );
    const next = reduceEditor(placed, addCommentAction(CID), config);

    // start-marker in para1 at 1 → new start endpoint 1+1=2. end-marker in para2
    // at 2 → end endpoint UNSHIFTED (different block) = 2.
    expect(next.selection.anchor).toEqual(createPosition(firstId, 2));
    expect(next.selection.focus).toEqual(createPosition(secondId, 2));
    // One marker in each block.
    expect(markerCount(next, firstId, CID)).toBe(1);
    expect(markerCount(next, secondId, CID)).toBe(1);
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
    const withFn = reduceEditor(editor, { type: "INSERT_FOOTNOTE" }, config);
    const bodyId = bodyParaId(withFn);
    const fnPara = withFn.selection.focus.blockId;
    // Hand-build a cross-context selection on the editor (anchor in body, focus
    // in footnote). This bypasses the SET_SELECTION chokepoint deliberately to
    // exercise the handler's own isCrossContextSelection guard.
    const crossEditor: EditorState = {
      ...withFn,
      selection: createSpan(createPosition(bodyId, 0), createPosition(fnPara, 0)),
    };
    const next = reduceEditor(crossEditor, addCommentAction(CID), config);

    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(next.state).toBe(crossEditor.state);
    expect(getComments(next.state).length).toBe(0);
  });

  it("UNDO of ADD_COMMENT removes BOTH markers AND the record", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4);
    const added = reduceEditor(placed, addCommentAction(CID), config);
    expect(getComments(added.state).length).toBe(1);
    expect(markerCount(added, paraId, CID)).toBe(2);

    const undone = reduceEditor(added, { type: "UNDO" }, config);
    expect(getComments(undone.state).length).toBe(0);
    expect(markerCount(undone, paraId, CID)).toBe(0);
  });

  it("does not swallow a later text edit into the comment's undo unit (own undo entry)", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4);
    const added = reduceEditor(placed, addCommentAction(CID), config);
    // Caret to end, type a char (a SEPARATE undo unit — "command" never coalesces
    // with the following "insert").
    const atEnd = selectRange(added, paraId, 8, 8); // 6 chars + 2 markers
    const typed = reduceEditor(atEnd, { type: "INSERT_TEXT", text: "Z" }, config);
    expect(getComments(typed.state).length).toBe(1);

    // First UNDO removes the typed "Z" but KEEPS the comment.
    const undo1 = reduceEditor(typed, { type: "UNDO" }, config);
    expect(getComments(undo1.state).length).toBe(1);
    // Second UNDO removes the comment.
    const undo2 = reduceEditor(undo1, { type: "UNDO" }, config);
    expect(getComments(undo2.state).length).toBe(0);
  });
});

describe("handleResolveComment / handleReopenComment", () => {
  function withComment(): EditorState {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4);
    return reduceEditor(placed, addCommentAction(CID), config);
  }

  it("RESOLVE flips resolved → true; REOPEN flips it back; both undoable", () => {
    const added = withComment();
    expect(nth(getComments(added.state), 0, "comment").resolved).toBe(false);

    const resolved = reduceEditor(added, { type: "RESOLVE_COMMENT", id: CID }, config);
    expect(nth(getComments(resolved.state), 0, "comment").resolved).toBe(true);

    const reopened = reduceEditor(resolved, { type: "REOPEN_COMMENT", id: CID }, config);
    expect(nth(getComments(reopened.state), 0, "comment").resolved).toBe(false);

    // Undo the reopen → back to resolved.
    const undoReopen = reduceEditor(reopened, { type: "UNDO" }, config);
    expect(nth(getComments(undoReopen.state), 0, "comment").resolved).toBe(true);
    // Undo the resolve → back to open.
    const undoResolve = reduceEditor(undoReopen, { type: "UNDO" }, config);
    expect(nth(getComments(undoResolve.state), 0, "comment").resolved).toBe(false);
  });

  it("RESOLVE on an already-resolved comment is an identity no-op (same state ref)", () => {
    const added = withComment();
    const resolved = reduceEditor(added, { type: "RESOLVE_COMMENT", id: CID }, config);
    const again = reduceEditor(resolved, { type: "RESOLVE_COMMENT", id: CID }, config);
    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(again.state).toBe(resolved.state);
  });

  it("RESOLVE on an absent comment is an identity no-op (same editor ref)", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4); // an editor with NO comment
    const next = reduceEditor(placed, { type: "RESOLVE_COMMENT", id: "nope" as CommentId }, config);
    expect(next).toBe(placed);
  });

  it("REOPEN on an already-open comment is an identity no-op (same state ref)", () => {
    const added = withComment(); // open by default
    const next = reduceEditor(added, { type: "REOPEN_COMMENT", id: CID }, config);
    // Same state reference (no-op; reducer entry-clears lastDirtyIds).
    expect(next.state).toBe(added.state);
  });
});

describe("handleDeleteComment — DELETE_COMMENT", () => {
  it("removes the comment (record + markers) and is undoable (redo re-adds)", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4);
    const added = reduceEditor(placed, addCommentAction(CID), config);
    expect(getComments(added.state).length).toBe(1);
    expect(markerCount(added, paraId, CID)).toBe(2);

    const deleted = reduceEditor(added, { type: "DELETE_COMMENT", id: CID }, config);
    expect(getComments(deleted.state).length).toBe(0);
    expect(markerCount(deleted, paraId, CID)).toBe(0);

    // Undo re-adds, redo re-deletes.
    const undone = reduceEditor(deleted, { type: "UNDO" }, config);
    expect(getComments(undone.state).length).toBe(1);
    expect(markerCount(undone, paraId, CID)).toBe(2);

    const redone = reduceEditor(undone, { type: "REDO" }, config);
    expect(getComments(redone.state).length).toBe(0);
  });

  it("no-ops when the id is absent (same editor reference)", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4);
    const next = reduceEditor(placed, { type: "DELETE_COMMENT", id: "nope" as CommentId }, config);
    expect(next).toBe(placed);
  });

  it("leaves a VALID selection when the caret sits in an UNRELATED block (sidebar-driven)", () => {
    // Two paragraphs; comment on para1; caret in para2. Deleting the comment
    // strips markers from para1 only, so the para2 selection stays valid.
    const initial = createInitialEditorState(config);
    const p1 = reduceEditor(initial, { type: "INSERT_TEXT", text: "abc" }, config);
    const firstId = bodyParaId(p1);
    const split = reduceEditor(p1, { type: "SPLIT_NODE" }, config);
    const withSecond = reduceEditor(split, { type: "INSERT_TEXT", text: "defgh" }, config);
    const secondId = withSecond.selection.focus.blockId;

    // Comment over "bc" in para1.
    const placed = reduceEditor(
      withSecond,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(firstId, 1), createPosition(firstId, 3)),
      },
      config,
    );
    const added = reduceEditor(placed, addCommentAction(CID), config);

    // Caret in para2 at offset 3 (unrelated block).
    const caretElsewhere = reduceEditor(
      added,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(secondId, 3), createPosition(secondId, 3)),
      },
      config,
    );
    const deleted = reduceEditor(caretElsewhere, { type: "DELETE_COMMENT", id: CID }, config);

    expect(getComments(deleted.state).length).toBe(0);
    // The para2 selection is unchanged and in range (para2 length is 5 ≥ 3).
    expect(deleted.selection.focus).toEqual(createPosition(secondId, 3));
    const para2Len =
      getBlock(deleted.state, secondId)?.inlineContent?.items.reduce(
        (n, it) => n + (it.kind === "text" ? it.text.length : 1),
        0,
      ) ?? 0;
    expect(deleted.selection.focus.offset).toBeLessThanOrEqual(para2Len);
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
    const added = reduceEditor(placed, addCommentAction(CID), config);
    expect(markerCount(added, paraId, CID)).toBe(2);

    // Collapsed caret at the END of the marked block (offset 8 = past "f" + 2 markers).
    const caretInBlock = reduceEditor(
      added,
      {
        type: "SET_SELECTION",
        selection: createSpan(createPosition(paraId, 8), createPosition(paraId, 8)),
      },
      config,
    );
    const deleted = reduceEditor(caretInBlock, { type: "DELETE_COMMENT", id: CID }, config);

    expect(getComments(deleted.state).length).toBe(0);
    expect(markerCount(deleted, paraId, CID)).toBe(0);
    // The caret is remapped to offset 6 (end of "abcdef") — valid and visually correct.
    const paraLen =
      getBlock(deleted.state, paraId)?.inlineContent?.items.reduce(
        (n, it) => n + (it.kind === "text" ? it.text.length : 1),
        0,
      ) ?? 0;
    expect(paraLen).toBe(6);
    expect(deleted.selection.focus).toEqual(createPosition(paraId, 6));
    expect(deleted.selection.anchor).toEqual(createPosition(paraId, 6));
    expect(deleted.selection.focus.offset).toBeLessThanOrEqual(paraLen);
  });
});

describe("handleAddReply — ADD_REPLY", () => {
  it("appends a reply to the record's replies", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4);
    const added = reduceEditor(placed, addCommentAction(CID), config);
    expect(nth(getComments(added.state), 0, "comment").replies.length).toBe(0);

    const replied = reduceEditor(
      added,
      {
        type: "ADD_REPLY",
        commentId: CID,
        replyId: "r1",
        author: "bob",
        body: "agreed",
        createdAt: 2000,
      },
      config,
    );
    const replies = nth(getComments(replied.state), 0, "comment").replies;
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
    const next = reduceEditor(
      placed,
      {
        type: "ADD_REPLY",
        commentId: "nope" as CommentId,
        replyId: "r1",
        author: "bob",
        body: "x",
        createdAt: 2000,
      },
      config,
    );
    expect(next).toBe(placed);
  });

  it("is undoable — UNDO removes the reply, leaving the comment", () => {
    const { editor, paraId } = withText("abcdef");
    const placed = selectRange(editor, paraId, 1, 4);
    const added = reduceEditor(placed, addCommentAction(CID), config);
    const replied = reduceEditor(
      added,
      {
        type: "ADD_REPLY",
        commentId: CID,
        replyId: "r1",
        author: "bob",
        body: "agreed",
        createdAt: 2000,
      },
      config,
    );
    expect(nth(getComments(replied.state), 0, "comment").replies.length).toBe(1);

    const undone = reduceEditor(replied, { type: "UNDO" }, config);
    // The reply is its own "command" undo unit: one UNDO drops the reply but
    // the comment record + markers survive (a separate prior entry).
    const comments = getComments(undone.state);
    expect(comments.length).toBe(1);
    expect(nth(comments, 0, "comment").replies.length).toBe(0);
  });
});
