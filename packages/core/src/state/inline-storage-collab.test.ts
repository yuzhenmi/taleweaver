/**
 * One `Y.Text` per block: the collaboration + undo properties the inline storage
 * exists for. Formatting is `Y.Text.format` (never deletes a character), so
 *   - an undo entry survives a FOREIGN (untracked) format over its text;
 *   - concurrent disjoint formats of one run converge without duplication;
 *   - typing into a run while a peer formats part of it keeps the typed char;
 *   - every op that used to rewrite a whole block's inline storage now keeps every
 *     other character's CRDT identity;
 *   - a peer's format across a structural marker never reaches a reader.
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { applyOperation, createState, getBlock, freshState, type Document } from "./state";
import { createHistory } from "./history";
import { insertText } from "./ops/insert-text";
import { applyAttrsToRangeInTx, planApplyAttrsToRange } from "./ops/apply-attrs";
import { insertCommentMarkers } from "./ops/insert-comment-markers";
import { deleteComment } from "./ops/comment-ops";
import { insertCrossReference } from "./ops/insert-cross-reference";
import { insertFootnote } from "./ops/insert-footnote";
import { insertInlineImage } from "./ops/insert-inline-image";
import { insertPageField } from "./ops/insert-page-field";
import { insertTab } from "./ops/insert-tab";
import { replaceAllMatches } from "./ops/replace-matches";
import { STATE_INTERNAL } from "./state-internal";
import { createPosition, createSpan } from "./block-position";
import { createTestAllocator, type BlockId } from "./block-id";
import type { CommentId } from "./comments";
import { TEST_RESOLVER, buildBlock, buildState, inlineContent, text } from "../test-utils/state-builders";
import { blockText, relAt, survives } from "../test-utils/relpos-survival";

const P = "p" as BlockId;
const UNTRACKED = Symbol("peer");

function oneBlock(runs = [text("abcdef")]): Document {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent(runs) }),
      buildBlock({ id: "h", type: "heading", parentId: "doc", inlineContent: inlineContent([text("target")]) }),
    ],
  });
}

const span = (a: number, b: number) => createSpan(createPosition(P, a), createPosition(P, b));
const itemsOf = (s: Document) => getBlock(s, P)?.inlineContent?.items ?? [];
const textOf = (s: Document) => itemsOf(s).map((i) => (i.kind === "text" ? i.text : "￼")).join("");

/** A second peer synced from `s`'s doc. */
function peerOf(s: Document): Document {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(s[STATE_INTERNAL].doc));
  return createState({ resolver: TEST_RESOLVER, rootId: s.rootId, doc });
}

/** Exchange updates both ways; return fresh Documents over each doc. */
function sync(a: Document, b: Document): [Document, Document] {
  const da = a[STATE_INTERNAL].doc;
  const db = b[STATE_INTERNAL].doc;
  Y.applyUpdate(db, Y.encodeStateAsUpdate(da));
  Y.applyUpdate(da, Y.encodeStateAsUpdate(db));
  return [createState({ resolver: TEST_RESOLVER, rootId: a.rootId, doc: da }), createState({ resolver: TEST_RESOLVER, rootId: b.rootId, doc: db })];
}

/** Format `[a, b)` of block p with `attrs` as an UNTRACKED (foreign) transaction. */
function foreignFormat(s: Document, a: number, b: number, attrs: Record<string, unknown>): Document {
  const plan = planApplyAttrsToRange(s, span(a, b));
  if (plan === null) throw new Error("empty format plan");
  return applyOperation(s, (doc) => applyAttrsToRangeInTx(doc, plan, attrs), { origin: UNTRACKED }).state;
}

describe("T6 — undo survives a foreign format", () => {
  it("type 'hello' (one entry), foreign bold over 'ell', UNDO → pre-typing text, no bold", () => {
    const s0 = oneBlock([]);
    const history = createHistory(s0);
    history.beginEntry("insert", 0);
    const typed = insertText(s0, createPosition(P, 0), "hello", {});
    history.commit(typed, { before: span(0, 0), after: span(5, 5) });

    const formatted = foreignFormat(typed.state, 1, 4, { bold: true });
    history.advanceState(formatted);
    expect(itemsOf(formatted)).toEqual([text("h"), text("ell", { bold: true }), text("o")]);

    const undone = history.undo();
    if (undone === null) throw new Error("expected the typing entry to undo");
    expect(itemsOf(undone.state)).toEqual([]);
  });
});

describe("T6 — convergence", () => {
  it("concurrent DISJOINT formats of one run converge without duplicating text", () => {
    const a0 = oneBlock();
    const b0 = peerOf(a0);
    const a1 = foreignFormat(a0, 0, 2, { bold: true });
    const b1 = foreignFormat(b0, 4, 6, { italic: true });
    const [a2, b2] = sync(a1, b1);
    const expected = [text("ab", { bold: true }), text("cd"), text("ef", { italic: true })];
    expect(itemsOf(a2)).toEqual(expected);
    expect(itemsOf(b2)).toEqual(expected);
  });

  it("typing into a run while a peer formats part of it keeps the typed char", () => {
    const a0 = oneBlock();
    const b0 = peerOf(a0);
    const a1 = insertText(a0, createPosition(P, 3), "X", {}).state;
    const b1 = foreignFormat(b0, 1, 5, { bold: true });
    const [a2, b2] = sync(a1, b1);
    expect(textOf(a2)).toBe("abcXdef");
    expect(textOf(b2)).toBe("abcXdef");
    expect(itemsOf(a2)).toEqual(itemsOf(b2));
  });
});

describe("T6 — no whole-block rewrite: every former rewriter keeps other characters", () => {
  type Op = (s: Document) => Document;
  const ops: [string, Op][] = [
    ["insertCommentMarkers", (s) => insertCommentMarkers(s, span(1, 4), "c1" as CommentId).state],
    [
      "deleteComment",
      (s) => deleteComment(insertCommentMarkers(s, span(1, 4), "c1" as CommentId).state, "c1" as CommentId).state,
    ],
    ["insertCrossReference", (s) => insertCrossReference(s, createPosition(P, 2), "h" as BlockId, "text").state],
    ["insertFootnote", (s) => insertFootnote(s, createPosition(P, 2), createTestAllocator("fn")).state],
    [
      "insertInlineImage",
      (s) => insertInlineImage(s, createPosition(P, 2), { src: "x.png", width: 1, height: 1, alt: "" }).state,
    ],
    ["insertPageField", (s) => insertPageField(s, createPosition(P, 2), "page-number").state],
    ["insertTab", (s) => insertTab(s, createPosition(P, 2)).state],
    ["replaceAllMatches", (s) => replaceAllMatches(s, [{ blockId: P, start: 2, end: 3 }], "Z").state],
  ];
  for (const [name, op] of ops) {
    it(name, () => {
      const s = oneBlock([text("ab", { bold: true }), text("cdef")]);
      const relA = relAt(s, "p", 0);
      const relE = relAt(s, "p", 4);
      const after = op(s);
      expect(survives(relA, after, "a")).toBe(true);
      expect(survives(relE, after, "e")).toBe(true);
    });
  }
});

describe("T6 — structural markers never carry formatting", () => {
  it("a peer's raw format across comment markers never reaches the read model", () => {
    const a0 = insertCommentMarkers(oneBlock(), span(1, 4), "c1" as CommentId).state;
    const b0 = peerOf(a0);
    // A peer formats the whole block with a raw Y.Text.format (no marker split).
    const yB = blockText(b0, "p");
    b0[STATE_INTERNAL].doc.transact(() => yB.format(0, yB.length, { bold: true }));
    const [a1] = sync(a0, b0);
    const markers = itemsOf(freshState(a1, new Set([P]))).filter((i) => i.kind === "embed");
    expect(markers).toHaveLength(2);
    for (const m of markers) expect(m.attrs).toEqual({});
  });
});
