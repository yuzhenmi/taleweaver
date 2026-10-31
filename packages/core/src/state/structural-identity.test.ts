/**
 * Structural identity: blocks are ranges of a CRDT sequence delimited by mark
 * items, so concurrent structural ops (split / merge / remove / move) converge on
 * every peer without losing or duplicating text, and undo restores exactly.
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createDocument, getBlock, type Document } from "./document";
import { DOCUMENT_INTERNAL } from "./document-internal";
import { createHistory } from "./history";
import { insertText } from "./ops/insert-text";
import { splitBlockAtPosition } from "./ops/split-block";
import { mergeAdjacentBlocks } from "./ops/merge-blocks";
import { removeBlock } from "./ops/remove-block";
import { deleteRange } from "./ops/delete-range";
import { setBlockAttrs } from "./ops/set-block-attrs";
import { applySectionBreak } from "./ops/section-break";
import { createPosition, createSpan, type Position } from "./block-position";
import { createTestAllocator, type BlockId, type IdAllocator } from "./block-id";
import { TEST_RESOLVER, buildBlock, buildDocument, inlineContent, text } from "../test-utils/document-builders";
import type { Block } from "./block";

const UNTRACKED = Symbol("untracked");
const id = (s: string) => s as BlockId;
const pos = (b: string, o: number): Position => createPosition(id(b), o);

/** A document `doc` with one paragraph per `[id, text]`. */
function docOf(paras: ReadonlyArray<readonly [string, string]>, attrs: Record<string, Record<string, unknown>> = {}): Document {
  const ids = paras.map(([i]) => i);
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: ids[0] ?? null, lastChildId: ids[ids.length - 1] ?? null }),
      ...paras.map(([i, t], k) =>
        buildBlock({
          id: i,
          type: "paragraph",
          attrs: attrs[i],
          parentId: "doc",
          prevSiblingId: ids[k - 1] ?? null,
          nextSiblingId: ids[k + 1] ?? null,
          inlineContent: inlineContent(t === "" ? [] : [text(t)]),
        }),
      ),
    ],
  });
}

function peerOf(s: Document, clientID: number): Document {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(s[DOCUMENT_INTERNAL].doc));
  return createDocument({ resolver: TEST_RESOLVER, rootId: s.rootId, doc });
}

/** Two peers over the same document (clientIDs 1 and 2). */
function twoPeers(s: Document): [Document, Document] {
  return [peerOf(s, 1), peerOf(s, 2)];
}

function sync(a: Document, b: Document): [Document, Document] {
  const da = a[DOCUMENT_INTERNAL].doc;
  const db = b[DOCUMENT_INTERNAL].doc;
  Y.applyUpdate(db, Y.encodeStateAsUpdate(da), "remote");
  Y.applyUpdate(da, Y.encodeStateAsUpdate(db), "remote");
  return [createDocument({ resolver: TEST_RESOLVER, rootId: a.rootId, doc: da }), createDocument({ resolver: TEST_RESOLVER, rootId: b.rootId, doc: db })];
}

function reload(s: Document): Document {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(s[DOCUMENT_INTERNAL].doc));
  return createDocument({ resolver: TEST_RESOLVER, rootId: s.rootId, doc });
}

const textOf = (b: Block | null): string =>
  (b?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "￼")).join("");

/** The document's leaf blocks in order as `id:text`, joined by ` | `. */
function read(s: Document): string {
  const out: string[] = [];
  const walk = (bid: BlockId | null): void => {
    for (let cur = bid; cur !== null; ) {
      const b = getBlock(s, cur);
      if (b === null) throw new Error(`dangling ${cur}`);
      if (b.inlineContent !== null) out.push(`${b.id}:${textOf(b)}`);
      else walk(b.firstChildId);
      cur = b.nextSiblingId;
    }
  };
  walk(getBlock(s, s.rootId)?.firstChildId ?? null);
  return out.join(" | ");
}

/** Every leaf's text concatenated (order-insensitive loss checks use this). */
const allText = (s: Document) => read(s).split(" | ").map((x) => x.slice(x.indexOf(":") + 1)).join("");

function alloc(prefix: string): IdAllocator {
  return createTestAllocator(prefix);
}

describe("concurrent structural ops converge with no loss (the head of a split gets the new id, a merge keeps R)", () => {
  it("A: split × split of one paragraph at different offsets", () => {
    let [a, b] = twoPeers(docOf([["A", "abcdef"], ["B", "ghij"]]));
    a = splitBlockAtPosition(a, pos("A", 2), alloc("n")).document;
    b = splitBlockAtPosition(b, pos("A", 4), alloc("m")).document;
    [a, b] = sync(a, b);
    expect(read(a)).toBe(read(b));
    expect(allText(a)).toBe("abcdefghij");
    expect(read(a).split(" | ")).toHaveLength(4);
  });

  it("B: split vs typing in the tail — the typed char stays in the tail block", () => {
    let [a, b] = twoPeers(docOf([["A", "abcdef"]]));
    a = splitBlockAtPosition(a, pos("A", 2), alloc("n")).document;
    b = insertText(b, pos("A", 6), "X", {}).document;
    [a, b] = sync(a, b);
    expect(read(a)).toBe(read(b));
    expect(read(a)).toBe("n-0:ab | A:cdefX");
  });

  it("C: merge vs typing in the right block — nothing lost", () => {
    let [a, b] = twoPeers(docOf([["A", "abcdef"], ["B", "ghij"]]));
    a = mergeAdjacentBlocks(a, id("A"), id("B")).document;
    b = insertText(b, pos("B", 1), "X", {}).document;
    [a, b] = sync(a, b);
    expect(read(a)).toBe(read(b));
    expect(read(a)).toBe("B:abcdefgXhij");
  });

  it("D: merge B into A vs split of B — converges, nothing lost", () => {
    let [a, b] = twoPeers(docOf([["A", "abcdef"], ["B", "ghij"]]));
    a = mergeAdjacentBlocks(a, id("A"), id("B")).document;
    b = splitBlockAtPosition(b, pos("B", 2), alloc("n")).document;
    [a, b] = sync(a, b);
    expect(read(a)).toBe(read(b));
    expect(read(a)).toBe("n-0:abcdefgh | B:ij");
  });

  it("stray: removing the first block while a peer types in it keeps the typed text visible", () => {
    let [a, b] = twoPeers(docOf([["A", "abc"], ["B", "def"]]));
    a = removeBlock(a, id("A")).document;
    b = insertText(b, pos("A", 2), "X", {}).document;
    [a, b] = sync(a, b);
    expect(read(a)).toBe(read(b));
    expect(allText(a)).toContain("X");
    expect(allText(a)).toContain("def");
  });

  it("empty flow: each peer deletes a different one of two paragraphs → one empty paragraph remains", () => {
    let [a, b] = twoPeers(docOf([["P1", "a"], ["P2", "b"]]));
    a = removeBlock(a, id("P1")).document;
    b = removeBlock(b, id("P2")).document;
    [a, b] = sync(a, b);
    expect(read(a)).toBe(read(b));
    expect(read(a).split(" | ")).toHaveLength(1);
    expect(allText(a)).toBe("");
  });

  it("split keeps every character's CRDT identity (a peer's relative position survives)", () => {
    let [a, b] = twoPeers(docOf([["A", "abcdef"]]));
    b = insertText(b, pos("A", 5), "Y", {}).document; // concurrent, lands after 'e'
    a = splitBlockAtPosition(a, pos("A", 3), alloc("n")).document;
    [a, b] = sync(a, b);
    expect(read(a)).toBe("n-0:abc | A:deYf");
    expect(read(b)).toBe(read(a));
  });
});

describe("undo is exact across structure (marks are separate items)", () => {
  it("type, then an UNTRACKED split → Ctrl+Z removes exactly the typing", () => {
    const s0 = docOf([["A", "abcdef"]]);
    const h = createHistory(s0);
    h.beginEntry("insert", 0);
    const typed = insertText(s0, pos("A", 6), "XY", {});
    h.commit(typed, { before: createSpan(pos("A", 6), pos("A", 6)), after: createSpan(pos("A", 8), pos("A", 8)) });
    // A foreign (untracked) split in the middle of the typed paragraph.
    const plan = splitBlockAtPosition(typed.document, pos("A", 3), alloc("n"));
    void plan;
    const doc = typed.document[DOCUMENT_INTERNAL].doc;
    // Re-run the split untracked by replaying it on a peer and applying back.
    const peer = peerOf(typed.document, 7);
    const split = splitBlockAtPosition(peer, pos("A", 3), alloc("q")).document;
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(split[DOCUMENT_INTERNAL].doc), UNTRACKED);
    h.advanceDocument(createDocument({ resolver: TEST_RESOLVER, rootId: s0.rootId, doc }));
    const undone = h.undo();
    expect(undone).not.toBeNull();
    const after = undone === null ? s0 : undone.document;
    // The typing is gone; the peer's split survives with its own id (its ¶ ends the head
    // "…def"; undoing the local split deleted ¶n-0, so "abc" continues q-0's paragraph).
    expect(read(after)).toBe("q-0:abcdef | A:");
  });

  it("own Enter → undo → redo is exact on the local peer, a remote peer and after reload", () => {
    const s0 = docOf([["A", "abcdef"]]);
    const h = createHistory(s0);
    h.beginEntry("command", 0);
    const split = splitBlockAtPosition(s0, pos("A", 3), alloc("n"));
    h.commit(split, { before: createSpan(pos("A", 3), pos("A", 3)), after: createSpan(pos("n-0", 0), pos("n-0", 0)) });
    const remote = peerOf(split.document, 9);
    const undone = h.undo();
    expect(undone).not.toBeNull();
    if (undone === null) return;
    expect(read(undone.document)).toBe("A:abcdef");
    const redone = h.redo();
    expect(redone).not.toBeNull();
    if (redone === null) return;
    expect(read(redone.document)).toBe("n-0:abc | A:def");
    const [, r] = sync(redone.document, remote);
    expect(read(r)).toBe("n-0:abc | A:def");
    expect(read(reload(redone.document))).toBe("n-0:abc | A:def");
  });

  it("own merge → undo restores the right block with its id and attrs (local, remote, reload)", () => {
    const s0 = docOf([["A", "abc"], ["B", "def"]], { B: { align: "center" } });
    const h = createHistory(s0);
    h.beginEntry("command", 0);
    const merged = mergeAdjacentBlocks(s0, id("A"), id("B"));
    h.commit(merged, { before: createSpan(pos("B", 0), pos("B", 0)), after: createSpan(pos("A", 3), pos("A", 3)) });
    expect(read(merged.document)).toBe("B:abcdef");
    const remote = peerOf(merged.document, 9);
    const undone = h.undo();
    if (undone === null) throw new Error("no undo");
    expect(read(undone.document)).toBe("A:abc | B:def");
    expect(getBlock(undone.document, id("B"))?.attrs).toEqual({ align: "center" });
    const [, r] = sync(undone.document, remote);
    expect(read(r)).toBe("A:abc | B:def");
    expect(read(reload(undone.document))).toBe("A:abc | B:def");
  });

  it("range delete across blocks → undo restores both blocks exactly", () => {
    const s0 = docOf([["A", "abc"], ["B", "def"], ["C", "ghi"]]);
    const h = createHistory(s0);
    h.beginEntry("delete", 0);
    const del = deleteRange(s0, createSpan(pos("A", 1), pos("C", 1)));
    h.commit(del, { before: createSpan(pos("A", 1), pos("C", 1)), after: createSpan(pos("A", 1), pos("A", 1)) });
    expect(read(del.document)).toBe("C:ahi");
    const undone = h.undo();
    if (undone === null) throw new Error("no undo");
    expect(read(undone.document)).toBe("A:abc | B:def | C:ghi");
  });

  it("concurrent undos restoring one mark → no visible empty paragraph (consecutive duplicates join)", () => {
    let [a, b] = twoPeers(docOf([["A", "abc"], ["B", "def"]]));
    const ha = createHistory(a);
    const hb = createHistory(b);
    for (const [h, s] of [[ha, a], [hb, b]] as const) {
      h.beginEntry("command", 0);
      const m = mergeAdjacentBlocks(s, id("A"), id("B"));
      h.commit(m, { before: createSpan(pos("B", 0), pos("B", 0)), after: createSpan(pos("A", 3), pos("A", 3)) });
    }
    [a, b] = sync(a, b);
    ha.advanceDocument(a);
    hb.advanceDocument(b);
    const ua = ha.undo();
    const ub = hb.undo();
    if (ua === null || ub === null) throw new Error("no undo");
    [a, b] = sync(ua.document, ub.document);
    expect(read(a)).toBe(read(b));
    expect(read(a)).toBe("A:abc | B:def");
  });
});

describe("Enter at offset 0, Word-model Backspace, one-shot attrs", () => {
  it("Enter at offset 0 of a non-empty block inserts the new block BEFORE and keeps the old id after", () => {
    const s0 = docOf([["A", "abc"]]);
    const r = splitBlockAtPosition(s0, pos("A", 0), alloc("n"));
    expect(read(r.document)).toBe("n-0: | A:abc");
  });

  it("splitting never copies a one-shot attr (listCounterOverride): it follows the content that carried it", () => {
    const s0 = docOf([["A", "abcdef"]], { A: { listCounterOverride: 5, align: "center" } });
    const r = splitBlockAtPosition(s0, pos("A", 3), alloc("n"));
    // k > 0: the head n-0 holds the text the restart was set on; the tail A loses it.
    expect(getBlock(r.document, id("n-0"))?.attrs).toEqual({ listCounterOverride: 5, align: "center" });
    expect(getBlock(r.document, id("A"))?.attrs).toEqual({ align: "center" });
  });

  it("Backspace into an empty paragraph deletes the EMPTY paragraph, keeping the neighbour's id + attrs", () => {
    const s0 = docOf([["E", ""], ["B", "def"]], { B: { align: "center" } });
    const r = mergeAdjacentBlocks(s0, id("E"), id("B"));
    expect(read(r.document)).toBe("B:def");
    expect(getBlock(r.document, id("B"))?.attrs).toEqual({ align: "center" });
  });
});

describe("sections and implicit entities", () => {
  it("concurrent first section breaks converge with no empty section and no loss", () => {
    let [a, b] = twoPeers(docOf([["A", "abc"], ["B", "def"], ["C", "ghi"]]));
    a = applySectionBreak(a, pos("B", 0), alloc("s")).document;
    b = applySectionBreak(b, pos("C", 0), alloc("t")).document;
    [a, b] = sync(a, b);
    expect(read(a)).toBe(read(b));
    expect(allText(a)).toBe("abcdefghi");
    const root = getBlock(a, a.rootId);
    const sections: string[] = [];
    for (let c = root?.firstChildId ?? null; c !== null; c = getBlock(a, c)?.nextSiblingId ?? null) {
      const s = getBlock(a, c);
      expect(s?.type).toBe("section");
      expect(s?.firstChildId).not.toBeNull();
      sections.push(c);
    }
    expect(sections).toHaveLength(3);
  });

  it("concurrent attr writes on the same paragraph merge key-wise", () => {
    let [a, b] = twoPeers(docOf([["A", "abc"]]));
    a = setBlockAttrs(a, id("A"), { align: "center" }).document;
    b = setBlockAttrs(b, id("A"), { indent: 1 }).document;
    [a, b] = sync(a, b);
    expect(getBlock(a, id("A"))?.attrs).toEqual({ align: "center", indent: 1 });
    expect(getBlock(b, id("A"))?.attrs).toEqual({ align: "center", indent: 1 });
  });
});
