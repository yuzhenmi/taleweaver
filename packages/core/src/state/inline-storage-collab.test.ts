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
import { applyOperation, createDocument, getBlock, freshDocument, type Document } from "./document";
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
import { DOCUMENT_INTERNAL } from "./document-internal";
import { createPosition, createSpan } from "./block-position";
import { createTestAllocator, type BlockId } from "./block-id";
import type { CommentId } from "./comments";
import { TEST_RESOLVER, buildBlock, buildDocument, inlineContent, text } from "../test-utils/document-builders";
import { blockText, relAt, survives } from "../test-utils/relpos-survival";

const P = "p" as BlockId;
const UNTRACKED = Symbol("peer");

function oneBlock(runs = [text("abcdef")]): Document {
  return buildDocument({
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
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(s[DOCUMENT_INTERNAL].doc));
  return createDocument({ resolver: TEST_RESOLVER, rootId: s.rootId, doc });
}

/** Exchange updates both ways; return fresh Documents over each doc. */
function sync(a: Document, b: Document): [Document, Document] {
  const da = a[DOCUMENT_INTERNAL].doc;
  const db = b[DOCUMENT_INTERNAL].doc;
  Y.applyUpdate(db, Y.encodeStateAsUpdate(da));
  Y.applyUpdate(da, Y.encodeStateAsUpdate(db));
  return [createDocument({ resolver: TEST_RESOLVER, rootId: a.rootId, doc: da }), createDocument({ resolver: TEST_RESOLVER, rootId: b.rootId, doc: db })];
}

/** Format `[a, b)` of block p with `attrs` as an UNTRACKED (foreign) transaction. */
function foreignFormat(s: Document, a: number, b: number, attrs: Record<string, unknown>): Document {
  const plan = planApplyAttrsToRange(s, span(a, b));
  if (plan === null) throw new Error("empty format plan");
  return applyOperation(s, (doc) => applyAttrsToRangeInTx(doc, plan, attrs), { origin: UNTRACKED }).document;
}

describe("T6 — undo survives a foreign format", () => {
  it("type 'hello' (one entry), foreign bold over 'ell', UNDO → pre-typing text, no bold", () => {
    const s0 = oneBlock([]);
    const history = createHistory(s0);
    history.beginEntry("insert", 0);
    const typed = insertText(s0, createPosition(P, 0), "hello", {});
    history.commit(typed, { before: span(0, 0), after: span(5, 5) });

    const formatted = foreignFormat(typed.document, 1, 4, { bold: true });
    history.advanceDocument(formatted);
    expect(itemsOf(formatted)).toEqual([text("h"), text("ell", { bold: true }), text("o")]);

    const undone = history.undo();
    if (undone === null) throw new Error("expected the typing entry to undo");
    expect(itemsOf(undone.document)).toEqual([]);
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
    const a1 = insertText(a0, createPosition(P, 3), "X", {}).document;
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
    ["insertCommentMarkers", (s) => insertCommentMarkers(s, span(1, 4), "c1" as CommentId).document],
    [
      "deleteComment",
      (s) => deleteComment(insertCommentMarkers(s, span(1, 4), "c1" as CommentId).document, "c1" as CommentId).document,
    ],
    ["insertCrossReference", (s) => insertCrossReference(s, createPosition(P, 2), "h" as BlockId, "text").document],
    ["insertFootnote", (s) => insertFootnote(s, createPosition(P, 2), createTestAllocator("fn")).document],
    [
      "insertInlineImage",
      (s) => insertInlineImage(s, createPosition(P, 2), { src: "x.png", width: 1, height: 1, alt: "" }).document,
    ],
    ["insertPageField", (s) => insertPageField(s, createPosition(P, 2), "page-number").document],
    ["insertTab", (s) => insertTab(s, createPosition(P, 2)).document],
    ["replaceAllMatches", (s) => replaceAllMatches(s, [{ blockId: P, start: 2, end: 3 }], "Z").document],
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
    const a0 = insertCommentMarkers(oneBlock(), span(1, 4), "c1" as CommentId).document;
    const b0 = peerOf(a0);
    // A peer formats the whole block with a raw Y.Text.format (no marker split).
    const yB = blockText(b0, "p");
    b0[DOCUMENT_INTERNAL].doc.transact(() => yB.format(0, yB.length, { bold: true }));
    const [a1] = sync(a0, b0);
    const markers = itemsOf(freshDocument(a1, new Set([P]))).filter((i) => i.kind === "embed");
    expect(markers).toHaveLength(2);
    for (const m of markers) expect(m.attrs).toEqual({});
  });
});
