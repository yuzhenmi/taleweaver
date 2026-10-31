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
import { freshDocument, resolveBlock } from "../document";
import { runTransaction } from "../yjs-doc";
import { DOCUMENT_INTERNAL } from "../document-internal";
import { createPosition, createSpan } from "../block-position";
import { buildBlock, buildDocument, inlineContent, text } from "../../test-utils/document-builders";
import type { Document } from "../document";
import type { BlockId } from "../block-id";
import type { CommentId } from "../comments";
import { DELETION_SUGGESTION_ATTR, INSERTION_SUGGESTION_ATTR, writeSuggestionRecordInTx, type SuggestionId } from "../suggestions";
import type { InlineContent } from "../inline-content";

const P = "p" as BlockId;

function oneBlock(content: InlineContent): Document {
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: content }),
    ],
  });
}

/** `BlockText#toDelta` reads (= block read-model builds) made INSIDE `doc`'s transactions while `run` runs. */
function readsInTransaction(document: Document, run: () => void): number {
  const doc = document[DOCUMENT_INTERNAL].doc;
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
    const document = oneBlock(inlineContent([text("a-b-a-b-a")]));
    const plan = planReplaceMatches(document, findMatches(document, "a"), "XY");
    expect(readsInTransaction(document, () => applyReplaceAllPlan(document, plan))).toBe(1);
  });

  it("resolve: drops reuse the caller's snapshot (no read)", () => {
    const document = oneBlock(inlineContent([text("a", { del: "s1" }), text("b", { bold: true }), text("cd", { del: "s2" })]));
    const items = resolveBlock(document, P)?.block.inlineContent?.items ?? [];
    const doc = document[DOCUMENT_INTERNAL].doc;
    const reads = readsInTransaction(document, () =>
      runTransaction(doc, () => {
        applyResolveDecisionsInTx(doc, [{ blockId: P, items, decisions: [{ op: "drop" }, { op: "keep" }, { op: "drop" }] }]);
      }),
    );
    expect(reads).toBe(0);
  });

  it("deletion strike: one read however many own-insertion runs it drops", () => {
    const document = oneBlock(inlineContent([text("ab", { [INSERTION_SUGGESTION_ATTR]: "mine" }), text("c"), text("de", { [INSERTION_SUGGESTION_ATTR]: "mine" })]));
    const doc = document[DOCUMENT_INTERNAL].doc;
    runTransaction(doc, () => {
      writeSuggestionRecordInTx(doc, { id: "mine" as SuggestionId, kind: "insertion", author: "alice", createdAt: 0 });
    });
    const reads = readsInTransaction(document, () =>
      runTransaction(doc, () => {
        applyDeletionStrikeInTx(doc, [{ blockId: P, rangeStart: 0, rangeEnd: 5 }], "d1" as SuggestionId, "alice", "test", new Set());
      }),
    );
    expect(reads).toBe(1);
    expect(resolveBlock(freshDocument(document, new Set([P])), P)?.block.inlineContent?.items).toEqual([text("c", { [DELETION_SUGGESTION_ATTR]: "d1" })]);
  });

  it("deleteComment: strips both markers from the planning snapshot (no read)", () => {
    const span = createSpan(createPosition(P, 1), createPosition(P, 3));
    const document = addComment(oneBlock(inlineContent([text("hello")])), span, {
      id: "c1" as CommentId,
      author: "alice",
      body: "x",
      createdAt: 1,
    }).document;
    expect(readsInTransaction(document, () => deleteComment(document, "c1" as CommentId))).toBe(0);
  });
});
