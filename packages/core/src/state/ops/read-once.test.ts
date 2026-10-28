/**
 * Multi-write ops read each block's inline text (`BlockText`) ONCE, compute offsets from that
 * read, and apply raw writes in descending order — O(block) per block, never one
 * re-read per item written (replace-all, resolve drops, deletion-strike drops,
 * comment-marker strip).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { BlockText } from "../block-text";
import { applyReplaceAllPlan, planReplaceMatches } from "./replace-matches";
import { applyDeletionStrikeInTx, applyResolveDecisionsInTx } from "./suggestion-ops";
import { addComment, deleteComment } from "./comment-ops";
import { findMatches } from "../find-matches";
import { freshState, resolveBlock } from "../state";
import { runTransaction } from "../yjs-doc";
import { STATE_INTERNAL } from "../state-internal";
import { createPosition, createSpan } from "../block-position";
import { buildBlock, buildState, inlineContent, text } from "../../test-utils/state-builders";
import type { State } from "../state";
import type { BlockId } from "../block-id";
import type { CommentId } from "../comments";
import { DELETION_SUGGESTION_ATTR, INSERTION_SUGGESTION_ATTR, writeSuggestionRecordInTx, type SuggestionId } from "../suggestions";
import type { InlineContent } from "../inline-content";

const P = "p" as BlockId;

function oneBlock(content: InlineContent): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: content }),
    ],
  });
}

/** `BlockText#toDelta` reads (= block read-model builds) made INSIDE `doc`'s transactions while `run` runs. */
function readsInTransaction(state: State, run: () => void): number {
  const doc = state[STATE_INTERNAL].doc;
  const spy = vi.spyOn(BlockText.prototype, "toDelta");
  let reads = 0;
  let mark = 0;
  const begin = (): void => {
    mark = spy.mock.calls.length;
  };
  const end = (): void => {
    reads += spy.mock.calls.length - mark;
  };
  doc.on("beforeTransaction", begin);
  doc.on("afterTransaction", end);
  try {
    run();
  } finally {
    doc.off("beforeTransaction", begin);
    doc.off("afterTransaction", end);
  }
  return reads;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("multi-write ops read each block once", () => {
  it("replace-all: one read for three matches in one block", () => {
    const state = oneBlock(inlineContent([text("a-b-a-b-a")]));
    const plan = planReplaceMatches(state, findMatches(state, "a"), "XY");
    expect(readsInTransaction(state, () => applyReplaceAllPlan(state, plan))).toBe(1);
  });

  it("resolve: drops reuse the caller's snapshot (no read)", () => {
    const state = oneBlock(inlineContent([text("a", { del: "s1" }), text("b", { bold: true }), text("cd", { del: "s2" })]));
    const items = resolveBlock(state, P)?.block.inlineContent?.items ?? [];
    const doc = state[STATE_INTERNAL].doc;
    const reads = readsInTransaction(state, () =>
      runTransaction(doc, () => {
        applyResolveDecisionsInTx(doc, [{ blockId: P, items, decisions: [{ op: "drop" }, { op: "keep" }, { op: "drop" }] }]);
      }),
    );
    expect(reads).toBe(0);
  });

  it("deletion strike: one read however many own-insertion runs it drops", () => {
    const state = oneBlock(inlineContent([text("ab", { [INSERTION_SUGGESTION_ATTR]: "mine" }), text("c"), text("de", { [INSERTION_SUGGESTION_ATTR]: "mine" })]));
    const doc = state[STATE_INTERNAL].doc;
    runTransaction(doc, () => {
      writeSuggestionRecordInTx(doc, { id: "mine" as SuggestionId, kind: "insertion", author: "alice", createdAt: 0 });
    });
    const reads = readsInTransaction(state, () =>
      runTransaction(doc, () => {
        applyDeletionStrikeInTx(doc, [{ blockId: P, rangeStart: 0, rangeEnd: 5 }], "d1" as SuggestionId, "alice", "test", new Set());
      }),
    );
    expect(reads).toBe(1);
    expect(resolveBlock(freshState(state, new Set([P])), P)?.block.inlineContent?.items).toEqual([text("c", { [DELETION_SUGGESTION_ATTR]: "d1" })]);
  });

  it("deleteComment: strips both markers from the planning snapshot (no read)", () => {
    const span = createSpan(createPosition(P, 1), createPosition(P, 3));
    const state = addComment(oneBlock(inlineContent([text("hello")])), span, {
      id: "c1" as CommentId,
      author: "alice",
      body: "x",
      createdAt: 1,
    }).state;
    expect(readsInTransaction(state, () => deleteComment(state, "c1" as CommentId))).toBe(0);
  });
});
