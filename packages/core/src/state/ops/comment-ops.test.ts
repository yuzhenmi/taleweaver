/**
 * Comments slice 2 — thread-record CRUD + the `getComments` read + undo
 * atomicity.
 *
 * The load-bearing properties here are: (1) the five Layer-3 ops are NORMAL
 * tracked `applyOperation` content ops, so `getComments` reflects every CRUD
 * mutation; (2) a comment is UNDOABLE AS A UNIT (markers + record revert
 * together) because the `comments` Y.Map is in the UndoManager's tracked scopes;
 * (3) per-transaction tracking means a pure text edit's undo never touches a
 * comment; (4) identity no-ops short-circuit (return the same State reference).
 */
import { describe, it, expect } from "vitest";
import {
  addComment,
  resolveComment,
  reopenComment,
  deleteComment,
  addReply,
} from "./comment-ops";
import { getComments, COMMENT_START_EMBED_TYPE, COMMENT_END_EMBED_TYPE } from "../comments";
import {
  buildCommentRangeIndex,
  type CommentId,
} from "../comments";
import { insertText } from "./insert-text";
import { deleteRange } from "./delete-range";
import { createHistory } from "../history";
import { getBlock } from "../state";
import { createPosition, createSpan } from "../block-position";
import type { BlockId } from "../block-id";
import { buildBlock, buildState, text, inlineContent, embed } from "../../test-utils/state-builders";
import type { State } from "../state";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const CID = "c1" as CommentId;

/** doc > [ p("hello world") ] */
function oneBlock(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("hello world")]),
      }),
    ],
  });
}

/** "world" span in p ("hello world"): offset 6..11. */
function worldSpan() {
  return createSpan(
    createPosition("p" as BlockId, 6),
    createPosition("p" as BlockId, 11),
  );
}

/** Reconstruct p's text from its inline items (embeds — incl. markers — omit). */
function pText(s: State): string {
  const items = getBlock(s, "p" as BlockId)?.inlineContent?.items ?? [];
  return items.map((it) => (it.kind === "text" ? it.text : "")).join("");
}

/** Count comment-start/-end markers carrying `cid` in a block's inline content. */
function markerCount(s: State, blockId: string, cid: CommentId): number {
  const items = getBlock(s, blockId as BlockId)?.inlineContent?.items ?? [];
  return items.filter(
    (it) =>
      it.kind === "embed" &&
      (it.embedType === COMMENT_START_EMBED_TYPE || it.embedType === COMMENT_END_EMBED_TYPE) &&
      it.properties.commentId === cid,
  ).length;
}

const ADD = { id: CID, author: "alice", body: "look here", createdAt: 1000 } as const;

describe("addComment — insert markers + write record in ONE tracked op", () => {
  it("appears in getComments with author/body/resolved=false + a live range", () => {
    const s = addComment(oneBlock(), worldSpan(), ADD).state;

    const comments = getComments(s);
    expect(comments.length).toBe(1);
    const c = nth(comments, 0, "comment");
    expect(c.id).toBe("c1");
    expect(c.author).toBe("alice");
    expect(c.body).toBe("look here");
    expect(c.resolved).toBe(false);
    expect(c.replies).toEqual([]);
    expect(c.range.orphaned).toBe(false);
    // start marker at original offset 6; end marker shifted +1 by the start marker.
    expect(c.range.start).toEqual(createPosition("p" as BlockId, 6));
    expect(c.range.end).toEqual(createPosition("p" as BlockId, 12));
  });

  it("markers are inserted into content (buildCommentRangeIndex sees the pair)", () => {
    const s = addComment(oneBlock(), worldSpan(), ADD).state;
    expect(buildCommentRangeIndex(s).get(CID)?.orphaned).toBe(false);
    // Markers are zero-width: extracted text is unchanged.
    expect(pText(s)).toBe("hello world");
  });

  it("output is frozen", () => {
    const s = addComment(oneBlock(), worldSpan(), ADD).state;
    const c = nth(getComments(s), 0, "comment");
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.replies)).toBe(true);
    expect(Object.isFrozen(c.range)).toBe(true);
  });

  it("re-adding an EXISTING id is an identity no-op — no duplicate marker pair (M-2)", () => {
    // Host-minted ids are unique by contract; a same-id re-add is a programmer
    // error. The op must short-circuit to the input state BEFORE planning/splicing
    // a second marker pair — otherwise the duplicate markers are the exact
    // precondition the I-1 deleteComment fix had to defend against.
    const s1 = addComment(oneBlock(), worldSpan(), ADD).state;
    expect(getComments(s1).length).toBe(1);
    expect(markerCount(s1, "p", CID)).toBe(2);

    const r2 = addComment(s1, worldSpan(), ADD);
    expect(r2.state).toBe(s1); // identity (same reference)
    expect(r2.dirtyIds.size).toBe(0);
    expect(getComments(r2.state).length).toBe(1);
    expect(markerCount(r2.state, "p", CID)).toBe(2); // NOT 4
  });
});

describe("resolveComment / reopenComment", () => {
  it("resolveComment flips resolved=true; reopenComment flips it back", () => {
    let s = addComment(oneBlock(), worldSpan(), ADD).state;
    s = resolveComment(s, CID).state;
    expect(nth(getComments(s), 0, "comment").resolved).toBe(true);
    s = reopenComment(s, CID).state;
    expect(nth(getComments(s), 0, "comment").resolved).toBe(false);
  });

  it("resolving an already-resolved comment is an identity no-op (same State ref)", () => {
    const s = resolveComment(addComment(oneBlock(), worldSpan(), ADD).state, CID).state;
    const r = resolveComment(s, CID);
    expect(r.state).toBe(s);
    expect(r.dirtyIds.size).toBe(0);
  });

  it("reopening an already-open comment is an identity no-op", () => {
    const s = addComment(oneBlock(), worldSpan(), ADD).state;
    const r = reopenComment(s, CID);
    expect(r.state).toBe(s);
  });

  it("resolving an absent comment is an identity no-op", () => {
    const s = oneBlock();
    const r = resolveComment(s, "nope" as CommentId);
    expect(r.state).toBe(s);
  });
});

describe("addReply", () => {
  it("pushes a reply onto the thread", () => {
    let s = addComment(oneBlock(), worldSpan(), ADD).state;
    s = addReply(s, CID, {
      replyId: "r1",
      author: "bob",
      body: "agreed",
      createdAt: 2000,
    }).state;
    const c = nth(getComments(s), 0, "comment");
    expect(c.replies).toEqual([
      { id: "r1", author: "bob", body: "agreed", createdAt: 2000 },
    ]);
  });

  it("appends multiple replies in order", () => {
    let s = addComment(oneBlock(), worldSpan(), ADD).state;
    s = addReply(s, CID, { replyId: "r1", author: "bob", body: "one", createdAt: 2000 }).state;
    s = addReply(s, CID, { replyId: "r2", author: "cat", body: "two", createdAt: 3000 }).state;
    expect(nth(getComments(s), 0, "comment").replies.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("replying to an absent comment is an identity no-op", () => {
    const s = oneBlock();
    const r = addReply(s, "nope" as CommentId, {
      replyId: "r1",
      author: "bob",
      body: "x",
      createdAt: 2000,
    });
    expect(r.state).toBe(s);
  });
});

describe("deleteComment", () => {
  it("removes the record AND both markers from content", () => {
    let s = addComment(oneBlock(), worldSpan(), ADD).state;
    expect(getComments(s).length).toBe(1);

    s = deleteComment(s, CID).state;
    expect(getComments(s).length).toBe(0);
    // Markers gone from content: the scan no longer finds the pair.
    expect(buildCommentRangeIndex(s).has(CID)).toBe(false);
    // And the text is intact (only the zero-width markers were removed).
    expect(pText(s)).toBe("hello world");
  });

  it("deleting an absent comment is an identity no-op", () => {
    const s = oneBlock();
    const r = deleteComment(s, "nope" as CommentId);
    expect(r.state).toBe(s);
  });

  it("strips a one-sided surviving marker (orphaned comment)", () => {
    // addComment over "world" (6..11) → start marker at 6, end marker at 12.
    let s = addComment(oneBlock(), worldSpan(), ADD).state;
    // Delete ONLY the end marker (offset [12, 13)), leaving the start marker +
    // the record → a one-sided/orphaned comment.
    s = deleteRange(
      s,
      createSpan(createPosition("p" as BlockId, 12), createPosition("p" as BlockId, 13)),
    ).state;
    const idx = buildCommentRangeIndex(s);
    expect(idx.has(CID)).toBe(true); // surviving start marker → one-sided entry
    expect(idx.get(CID)?.orphaned).toBe(true);

    s = deleteComment(s, CID).state;
    expect(getComments(s).length).toBe(0);
    // The surviving start marker was stripped too.
    expect(buildCommentRangeIndex(s).has(CID)).toBe(false);
    // Text intact — only the zero-width markers were removed (deleteRange of the
    // end marker removed no text).
    expect(pText(s)).toBe("hello world");
  });

  it("removes the record when both markers are already gone (orphaned-by-absence)", () => {
    // addComment over "world" (6..11) → start marker at 6, "world" at 7..12,
    // end marker at 12.
    let s = addComment(oneBlock(), worldSpan(), ADD).state;
    // Delete the FULL commented span INCLUDING both markers (offset [6, 13)) —
    // removes "world" and both markers. The record remains; no markers survive.
    s = deleteRange(
      s,
      createSpan(createPosition("p" as BlockId, 6), createPosition("p" as BlockId, 13)),
    ).state;
    // No markers in content (orphaned-by-absence) but the record is still there.
    expect(buildCommentRangeIndex(s).has(CID)).toBe(false);
    expect(getComments(s).length).toBe(1);
    expect(pText(s)).toBe("hello ");

    // deleteComment exercises the `writes.length === 0 && hasRecord` branch:
    // no markers to strip, but the record is removed. Because the comments map
    // is excluded from dirty-capture, the op surfaces the document root as the
    // affected dirtyId so the record delete advances state (not an identity
    // no-op) and lands a tracked, undoable entry.
    const result = deleteComment(s, CID);
    expect(result.state).not.toBe(s);
    expect(result.dirtyIds.size).toBeGreaterThan(0);
    s = result.state;
    expect(getComments(s).length).toBe(0);
    expect(pText(s)).toBe("hello ");
  });

  it("orphaned-by-absence delete is UNDOABLE (tracked even with no markers)", () => {
    // Set up an orphaned-by-absence comment (record present, both markers gone).
    let s = addComment(oneBlock(), worldSpan(), ADD).state;
    s = deleteRange(
      s,
      createSpan(createPosition("p" as BlockId, 6), createPosition("p" as BlockId, 13)),
    ).state;
    expect(getComments(s).length).toBe(1);

    const history = createHistory(s);
    history.beginEntry("command", 0);
    const del = deleteComment(s, CID);
    history.commit(del, { before: null, after: null });
    expect(getComments(del.state).length).toBe(0);
    // The record-only delete is tracked (dirtyIds non-empty → a StackItem
    // exists), so it can be undone — restoring the record.
    expect(history.canUndo()).toBe(true);

    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    expect(getComments(undone.state).length).toBe(1);

    history.destroy();
  });

  it("strips a DUPLICATE marker in a NON-endpoint block — strip scope matches the resolver's scan (audit comments I-1)", () => {
    // A malformed state (only reachable via collab merge / import, not single-user
    // ops): the comment's well-formed start+end pair lives in `p`, but a STRAY
    // duplicate `comment-start` for CID also sits in a SECOND block `p2`. The range
    // index records only the FIRST-seen start/end (both in `p`), so a strip that
    // trusted those two indexed blocks would leave the `p2` marker orphaned in
    // content forever. `deleteComment` must strip EVERY marker for CID — uniform
    // with the resolver's full-document scan.
    let s = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p2" }),
        buildBlock({
          id: "p", type: "paragraph", parentId: "doc", prevSiblingId: null, nextSiblingId: "p2",
          inlineContent: inlineContent([text("hello world")]),
        }),
        buildBlock({
          id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p", nextSiblingId: null,
          inlineContent: inlineContent([
            text("x"),
            embed(COMMENT_START_EMBED_TYPE, { commentId: CID }),
            text("y"),
          ]),
        }),
      ],
    });
    // addComment over "world" in `p` → record CID + start/end markers in `p`. CID
    // now has THREE markers: the pair in `p` plus the stray start in `p2`.
    s = addComment(s, worldSpan(), ADD).state;
    expect(markerCount(s, "p", CID)).toBe(2);
    expect(markerCount(s, "p2", CID)).toBe(1);

    s = deleteComment(s, CID).state;
    expect(getComments(s).length).toBe(0);
    // EVERY marker is gone, including the non-endpoint `p2` duplicate (was 1 before
    // the strip scanned all blocks).
    expect(markerCount(s, "p", CID)).toBe(0);
    expect(markerCount(s, "p2", CID)).toBe(0);
    // `p2`'s surrounding text is intact (only the zero-width marker was removed).
    expect(
      (getBlock(s, "p2" as BlockId)?.inlineContent?.items ?? [])
        .map((it) => (it.kind === "text" ? it.text : ""))
        .join(""),
    ).toBe("xy");
  });
});

describe("undo atomicity (§2 — undoable-as-content)", () => {
  it("undo of addComment removes BOTH markers and the record; redo restores both", () => {
    const s0 = oneBlock();
    const history = createHistory(s0);

    history.beginEntry("command", 0);
    const added = addComment(s0, worldSpan(), ADD);
    history.commit(added, { before: null, after: null });
    const s1 = added.state;
    expect(getComments(s1).length).toBe(1);
    expect(buildCommentRangeIndex(s1).get(CID)?.orphaned).toBe(false);

    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const s2 = undone.state;
    expect(getComments(s2).length).toBe(0);
    expect(buildCommentRangeIndex(s2).has(CID)).toBe(false);
    expect(pText(s2)).toBe("hello world");

    const redone = history.redo();
    if (redone === null) throw new Error("expected redo to return a result");
    const s3 = redone.state;
    expect(getComments(s3).length).toBe(1);
    expect(buildCommentRangeIndex(s3).get(CID)?.orphaned).toBe(false);

    history.destroy();
  });

  it("undo of a pure text edit does NOT touch an existing comment", () => {
    const s0 = oneBlock();
    const history = createHistory(s0);

    // Add a comment + commit (its own undo entry).
    history.beginEntry("command", 0);
    const added = addComment(s0, worldSpan(), ADD);
    history.commit(added, { before: null, after: null });
    const s1 = added.state;

    // A pure text edit (insert "X" at offset 0) + commit — a SEPARATE undo
    // entry (beginEntry closes the prior group) whose transaction never
    // touched the comments map.
    history.beginEntry("insert", 10_000);
    const typed = insertText(s1, createPosition("p" as BlockId, 0), "X", {});
    history.commit(typed, { before: null, after: null });
    const s2 = typed.state;
    expect(pText(s2)).toBe("Xhello world");
    expect(getComments(s2).length).toBe(1);

    // Undo the TEXT edit only. The comment (markers + record) is unaffected.
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const s3 = undone.state;
    expect(pText(s3)).toBe("hello world");
    expect(getComments(s3).length).toBe(1);
    expect(nth(getComments(s3), 0, "comment").range.orphaned).toBe(false);

    history.destroy();
  });
});
