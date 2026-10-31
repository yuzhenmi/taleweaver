/**
 * Tracked paragraph marks (Word's model): a suggested paragraph /
 * section-break insertion or deletion is a key on the ¶'s OWN registry entry. Storage
 * (which ¶ a writer keys), the final-projection check of suggested deletions, views,
 * uniform resolve (incl. a section-end item), undo, own-insertion removal, two
 * authors, paste / upgrade, collaboration (probe p1), a11y and dirty sets.
 */
import { attrRegistry } from "../cascade/attr-registry";
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createDocument, getBlock, applyOperation, type Document } from "./document";
import { DOCUMENT_INTERNAL } from "./document-internal";
import { splitWithSuggestion } from "./ops/split-block";
import { markParagraphMarkDeletion } from "./ops/merge-blocks";
import { acceptSuggestion, rejectSuggestion, markDeletion, mintInsertion } from "./ops/suggestion-ops";
import { applySectionBreakAsSuggestion } from "./ops/section-break";
import { insertText } from "./ops/insert-text";
import { removeBlock } from "./ops/remove-block";
import { extractFragment } from "./ops/extract-fragment";
import { insertFragment } from "./ops/insert-fragment";
import { decodeFragmentClip } from "./serialize/fragment-clip";
import { bytesToBase64 } from "./serialize/base64";
import { getSuggestions, writeSuggestionRecordInTx, type SuggestionId } from "./suggestions";
import { endMarkOf, boundaryMergesInView } from "./break-suggestions";
import { INSERTION_TAG_KEY, DELETION_TAG_KEY } from "./break-tags";
import { extractText } from "./extract-text";
import { createHistory } from "./history";
import { createPosition, createSpan } from "./block-position";
import { createTestAllocator, type BlockId } from "./block-id";
import { getRegistry } from "./registry";
import { getSuggestionsMap, dirtyIdsFromTransaction } from "./yjs-doc";
import { upgradeDocument } from "./upgrade";
import { buildAccessibilityTree } from "../accessibility/build-accessibility-tree";
import type { AccessibilityNode } from "../accessibility/accessibility-node";
import { TEST_RESOLVER, buildBlock, buildDocument, inlineContent, text, embed, withTestAttrs } from "../test-utils/document-builders";
import { legacyDoc } from "../test-utils/legacy-fixture";
import type { Block } from "./block";

const id = (s: string): BlockId => s as BlockId;
const sid = (s: string): SuggestionId => s as SuggestionId;
const A = (s: string, t = 1): { id: SuggestionId; author: string; createdAt: number } => ({ id: sid(s), author: "alice", createdAt: t });
const B = (s: string, t = 1): { id: SuggestionId; author: string; createdAt: number } => ({ id: sid(s), author: "bob", createdAt: t });

/** doc > [blocks] (the read model parents them under the final section); `type: "image"` = an atomic object. */
function docOf(blocks: ReadonlyArray<{ id: string; type?: string; text?: string }>): Document {
  const ids = blocks.map((b) => b.id);
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: ids[0] ?? null, lastChildId: ids[ids.length - 1] ?? null }),
      ...blocks.map((b, k) =>
        buildBlock({
          id: b.id,
          type: b.type ?? "paragraph",
          ...(b.type === "image" ? { attrs: { src: "x.png", width: 10, height: 10 } } : {}),
          parentId: "doc",
          prevSiblingId: ids[k - 1] ?? null,
          nextSiblingId: ids[k + 1] ?? null,
          inlineContent: b.type === "image" ? null : inlineContent(b.text === undefined || b.text === "" ? [] : [text(b.text)]),
        }),
      ),
    ],
  });
}

/** doc > s1[a("A")] | s2[b("B")]: ¶a is the section-end item of s1. */
function twoSections(): Document {
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "s1", lastChildId: "s2" }),
      buildBlock({ id: "s1", type: "section", parentId: "doc", nextSiblingId: "s2", firstChildId: "a", lastChildId: "a", attrs: { columnCount: 2 } }),
      buildBlock({ id: "a", type: "paragraph", parentId: "s1", inlineContent: inlineContent([text("A")]) }),
      buildBlock({ id: "s2", type: "section", parentId: "doc", prevSiblingId: "s1", firstChildId: "b", lastChildId: "b" }),
      buildBlock({ id: "b", type: "paragraph", parentId: "s2", inlineContent: inlineContent([text("B")]) }),
    ],
  });
}

const textOf = (s: Document, b: string): string =>
  (getBlock(s, id(b))?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "￼")).join("");

/** Leaves in document order as `id:text` (objects as their id). */
function read(s: Document): string {
  const out: string[] = [];
  const walk = (start: BlockId | null): void => {
    for (let cur = start; cur !== null; ) {
      const b = getBlock(s, cur);
      if (b === null) return;
      if (b.firstChildId !== null) walk(b.firstChildId);
      else if (b.type !== "document" && b.type !== "section") out.push(b.inlineContent === null ? b.id : `${b.id}:${textOf(s, b.id)}`);
      cur = b.nextSiblingId;
    }
  };
  walk(getBlock(s, s.rootId)?.firstChildId ?? null);
  return out.join(" | ");
}

const keysOf = (s: Document, b: string): Block["breakSuggestion"] => getBlock(s, id(b))?.breakSuggestion;
const ids = (s: Document): string[] => getSuggestions(s).map((x) => x.id).sort();
const records = (s: Document): string[] => [...getSuggestionsMap(s[DOCUMENT_INTERNAL].doc).keys()].sort();
const alloc = (prefix = "n"): ReturnType<typeof createTestAllocator> => createTestAllocator(prefix);

/** Write a raw key + record (bypassing the writers — a concurrency-born shape). */
function rawKey(s: Document, block: string, key: string, k: string, kind: "insertion" | "deletion"): Document {
  return applyOperation(s, (d) => {
    getRegistry(d).get(block)?.set(key, k);
    writeSuggestionRecordInTx(d, { id: sid(k), kind, author: "alice", createdAt: 1 });
  }).document;
}

function peer(s: Document, clientID: number): Document {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(s[DOCUMENT_INTERNAL].doc));
  return createDocument({ resolver: TEST_RESOLVER, rootId: s.rootId, doc });
}

function sync(a: Document, b: Document): [Document, Document] {
  const da = a[DOCUMENT_INTERNAL].doc;
  const db = b[DOCUMENT_INTERNAL].doc;
  Y.applyUpdate(db, Y.encodeStateAsUpdate(da), "remote");
  Y.applyUpdate(da, Y.encodeStateAsUpdate(db), "remote");
  return [createDocument({ resolver: TEST_RESOLVER, rootId: a.rootId, doc: da }), createDocument({ resolver: TEST_RESOLVER, rootId: b.rootId, doc: db })];
}

describe("storage: which ¶ a writer keys", () => {
  it("suggesting Enter at 0 / mid / end keys the NEW ¶ (the head H's own entry); the split block keeps its id", () => {
    for (const k of [0, 2, 4]) {
      const r = splitWithSuggestion(docOf([{ id: "p", text: "abcd" }]), createPosition(id("p"), k), alloc(), A("s"));
      expect(keysOf(r.document, r.newBlockId)).toEqual({ insertionId: "s" });
      expect(keysOf(r.document, "p")).toBeUndefined();
      expect(read(r.document)).toBe(`${r.newBlockId}:${"abcd".slice(0, k)} | p:${"abcd".slice(k)}`);
      expect(endMarkOf(r.document, r.newBlockId)?.kind).toBe("split");
    }
  });

  it("a suggesting delete over a span keys exactly the ¶s inside it; a span ending at (Q, 0) covers ¶ of Q's predecessor", () => {
    // (Ops write the shared Y.Doc: each case gets a fresh document.)
    const s0 = (): Document => docOf([{ id: "a", text: "aa" }, { id: "b", text: "bb" }, { id: "c", text: "cc" }]);
    const over = markDeletion(s0(), createSpan(createPosition(id("a"), 1), createPosition(id("c"), 1)), A("d")).document;
    expect([keysOf(over, "a"), keysOf(over, "b"), keysOf(over, "c")]).toEqual([{ deletionId: "d" }, { deletionId: "d" }, undefined]);
    const toStart = markDeletion(s0(), createSpan(createPosition(id("a"), 2), createPosition(id("b"), 0)), A("d")).document;
    expect([keysOf(toStart, "a"), keysOf(toStart, "b")]).toEqual([{ deletionId: "d" }, undefined]);
    // Exactly the ¶ ((a, len)–(b, 0)): copy gives "\n", accept merges.
    expect(extractText(toStart, createSpan(createPosition(id("a"), 2), createPosition(id("b"), 0)))).toBe("\n");
    expect(read(acceptSuggestion(toStart, sid("d")).document)).toBe("b:aabb | c:cc");
  });

  it("a suggested section break keys the section-end ¶; reject merges the paragraphs AND the sections, accept keeps them", () => {
    const s0 = docOf([{ id: "p", text: "abcd" }]);
    const r = applySectionBreakAsSuggestion(s0, createPosition(id("p"), 2), alloc(), A("sb"));
    const head = getBlock(r.document, id("p"))?.prevSiblingId ?? null;
    expect(head).toBeNull(); // p is the first block of the final section; the head ends the new section
    const all = read(r.document).split(" | ");
    expect(all).toHaveLength(2);
    const headId = (all[0] ?? "").split(":")[0] ?? "";
    expect(keysOf(r.document, headId)).toEqual({ insertionId: "sb" });
    expect(endMarkOf(r.document, id(headId))?.kind).toBe("section-insert");
    expect(read(rejectSuggestion(r.document, sid("sb")).document)).toBe("p:abcd");
    const fresh = applySectionBreakAsSuggestion(docOf([{ id: "p", text: "abcd" }]), createPosition(id("p"), 2), alloc(), A("sb"));
    const before = read(fresh.document);
    const kept = acceptSuggestion(fresh.document, sid("sb")).document;
    expect(read(kept)).toBe(before);
    expect(keysOf(kept, headId)).toBeUndefined();
  });

  it("a suggested deletion of a section-end ¶ (Backspace across the break) is one key; accept deletes the break in one step", () => {
    const keyed = markParagraphMarkDeletion(twoSections(), id("a"), A("sj")).document;
    expect(keysOf(keyed, "a")).toEqual({ deletionId: "sj" });
    expect(endMarkOf(keyed, id("a"))?.kind).toBe("section-join");
    expect(ids(keyed)).toEqual(["sj"]);
    const accepted = acceptSuggestion(keyed, sid("sj")).document;
    expect(read(accepted)).toBe("b:AB");
    // The content takes the FOLLOWING (final) section: no explicit section remains.
    expect(getBlock(accepted, id("b"))?.parentId).toBe(getBlock(accepted, id("doc"))?.lastChildId);
    expect(getBlock(accepted, id("s1"))).toBeNull();
    const again = markParagraphMarkDeletion(twoSections(), id("a"), A("sj")).document;
    expect(read(rejectSuggestion(again, sid("sj")).document)).toBe("a:A | b:B");
  });
});

describe("the final-projection check: a suggesting delete never keys a ¶ accepting would keep", () => {
  it("[L][P 'Heading text'][img][Q]: a delete from (P, 4) across the object strikes the text only; accept shows 'Head¶P'[img]", () => {
    // (`iterateSpan` takes no object endpoint, so the span runs on to (Q, 0): it covers
    // ¶P and the object; ¶P is followed by the object and keeps "Head" — never keyed.)
    const s0 = docOf([{ id: "l", text: "L" }, { id: "p", text: "Heading text" }, { id: "img", type: "image" }, { id: "q", text: "Q" }]);
    const r = markDeletion(s0, createSpan(createPosition(id("p"), 4), createPosition(id("q"), 0)), A("d")).document;
    expect(keysOf(r, "p")).toBeUndefined();
    expect(read(acceptSuggestion(r, sid("d")).document)).toBe("l:L | p:Head | img | q:Q");
  });

  it("[img1][P][img2][Z]: a whole-paragraph delete strikes P's text and leaves ¶P unkeyed; accept keeps ¶P", () => {
    const s0 = docOf([{ id: "i1", type: "image" }, { id: "p", text: "x" }, { id: "i2", type: "image" }, { id: "z", text: "" }]);
    const r = markDeletion(s0, createSpan(createPosition(id("p"), 0), createPosition(id("z"), 0)), A("d")).document;
    expect(keysOf(r, "p")).toBeUndefined();
    expect(read(acceptSuggestion(r, sid("d")).document)).toBe("i1 | p: | i2 | z:");
  });

  it("an EMPTY paragraph before an object is a tracked ¶ deletion (not after an object); the view never glues text to the object", () => {
    const s0 = docOf([{ id: "a", text: "a" }, { id: "e", text: "" }, { id: "img", type: "image" }, { id: "z", text: "z" }]);
    const r = markParagraphMarkDeletion(s0, id("e"), A("d"));
    expect(keysOf(r.document, "e")).toEqual({ deletionId: "d" });
    expect(boundaryMergesInView(r.document, getBlock(r.document, id("a")) ?? fail(), getBlock(r.document, id("e")) ?? fail(), "final")).toBe(false);
    expect(read(acceptSuggestion(r.document, sid("d")).document)).toBe("a:a | img | z:z");
    // After an object the empty ¶ is required (invariant I1): never keyed.
    const after = docOf([{ id: "img", type: "image" }, { id: "e", text: "" }, { id: "i2", type: "image" }, { id: "z", text: "z" }]);
    expect(markParagraphMarkDeletion(after, id("e"), A("d")).document).toBe(after);
    // Also when it follows the object only in "final": [img][a "" ¶ keyed][e ""][i2] — the
    // walk crosses the deletion-keyed run back to the object.
    const chain = rawKey(docOf([{ id: "img", type: "image" }, { id: "a", text: "" }, { id: "e", text: "" }, { id: "i2", type: "image" }, { id: "z", text: "z" }]), "a", DELETION_TAG_KEY, "d0", "deletion");
    expect(markParagraphMarkDeletion(chain, id("e"), A("d")).document).toBe(chain);
  });

  it("a concurrency-born key on a required ¶: drawn, the view does not merge, resolve drops the key and keeps the ¶", () => {
    const s0 = docOf([{ id: "p", text: "x" }, { id: "img", type: "image" }, { id: "z", text: "z" }]);
    const keyed = rawKey(s0, "p", DELETION_TAG_KEY, "d", "deletion");
    expect(endMarkOf(keyed, id("p"))?.kind).toBe("join");
    expect(boundaryMergesInView(keyed, getBlock(keyed, id("p")) ?? fail(), getBlock(keyed, id("z")) ?? fail(), "final")).toBe(false);
    expect(extractText(keyed, createSpan(createPosition(id("p"), 0), createPosition(id("z"), 1)), undefined, "final")).not.toContain("xz");
    const accepted = acceptSuggestion(keyed, sid("d")).document;
    expect(read(accepted)).toBe("p:x | img | z:z");
    expect(keysOf(accepted, "p")).toBeUndefined();
    expect(records(accepted)).toEqual([]);
  });
});

describe("views", () => {
  it("final hides a deletion-keyed ¶, original an insertion-keyed one; suggesting never", () => {
    const sp = splitWithSuggestion(docOf([{ id: "p", text: "abcd" }]), createPosition(id("p"), 2), alloc(), A("s"));
    const h = getBlock(sp.document, sp.newBlockId) ?? fail();
    const p = getBlock(sp.document, id("p")) ?? fail();
    expect([boundaryMergesInView(sp.document, h, p, "original"), boundaryMergesInView(sp.document, h, p, "final"), boundaryMergesInView(sp.document, h, p, "suggesting")]).toEqual([true, false, false]);
    const jn = markParagraphMarkDeletion(docOf([{ id: "l", text: "ab" }, { id: "r", text: "cd" }]), id("l"), A("j")).document;
    const l = getBlock(jn, id("l")) ?? fail();
    const r = getBlock(jn, id("r")) ?? fail();
    expect([boundaryMergesInView(jn, l, r, "final"), boundaryMergesInView(jn, l, r, "original")]).toEqual([true, false]);
  });

  it("a key whose record is absent is not drawn, has no range and no view effect", () => {
    const s = rawKey(docOf([{ id: "l", text: "ab" }, { id: "r", text: "cd" }]), "l", DELETION_TAG_KEY, "gone", "deletion");
    const orphan = applyOperation(s, (d) => {
      getSuggestionsMap(d).delete("gone");
      return new Set([s.rootId]);
    }).document;
    expect(endMarkOf(orphan, id("l"))).toBeNull();
    expect(ids(orphan)).toEqual([]);
    expect(boundaryMergesInView(orphan, getBlock(orphan, id("l")) ?? fail(), getBlock(orphan, id("r")) ?? fail(), "final")).toBe(false);
  });
});

describe("resolve × undo", () => {
  it("undo of a suggesting Enter deletes ¶H and its key; undo of each resolve restores ¶, key and record in one entry", () => {
    const s0 = docOf([{ id: "p", text: "abcd" }]);
    const h = createHistory(s0);
    h.beginEntry("command", 0);
    const sp = splitWithSuggestion(s0, createPosition(id("p"), 2), alloc(), A("s"));
    h.commit(sp, { before: null, after: null });
    const undone = h.undo();
    expect(undone === null ? "" : read(undone.document)).toBe("p:abcd");
    expect(undone === null ? ["?"] : records(undone.document)).toEqual([]);
    h.destroy();

    for (const mode of ["accept", "reject"] as const) {
      const seeded = markParagraphMarkDeletion(docOf([{ id: "l", text: "ab" }, { id: "r", text: "cd" }]), id("l"), A("j")).document;
      const hist = createHistory(seeded);
      hist.beginEntry("command", 0);
      const res = mode === "accept" ? acceptSuggestion(seeded, sid("j")) : rejectSuggestion(seeded, sid("j"));
      hist.commit(res, { before: null, after: null });
      const back = hist.undo();
      expect(back === null ? "" : read(back.document)).toBe("l:ab | r:cd");
      expect(back === null ? undefined : keysOf(back.document, "l")).toEqual({ deletionId: "j" });
      expect(back === null ? [] : ids(back.document)).toEqual(["j"]);
      hist.destroy();
    }
  });

  it("a combined insertion + deletion on one ¶: either resolve order ends with the ¶ gone and no records", () => {
    const both = (): { s: Document; h: BlockId } => {
      const sp = splitWithSuggestion(docOf([{ id: "p", text: "abcd" }]), createPosition(id("p"), 2), alloc(), A("s"));
      return { s: markParagraphMarkDeletion(sp.document, sp.newBlockId, B("j")).document, h: sp.newBlockId };
    };
    const x = both();
    expect(endMarkOf(x.s, x.h)).toEqual({ kind: "split+join", suggestionIds: ["s", "j"] });
    const rejected = rejectSuggestion(x.s, sid("s")).document;
    expect(read(rejected)).toBe("p:abcd");
    expect(records(rejected)).toEqual([]);
    const a1 = acceptSuggestion(both().s, sid("s")).document;
    expect(read(acceptSuggestion(a1, sid("j")).document)).toBe("p:abcd");
  });
});

describe("own pending ¶ / two authors", () => {
  it("deleting the author's own pending ¶ removes it for real (the merge), no deletion record", () => {
    const sp = splitWithSuggestion(docOf([{ id: "p", text: "abcd" }]), createPosition(id("p"), 2), alloc(), A("s"));
    const r = markParagraphMarkDeletion(sp.document, sp.newBlockId, A("j"));
    expect(r.removedBoundary).toEqual({ survivorId: "p", offset: 2 });
    expect(read(r.document)).toBe("p:abcd");
    expect(ids(r.document)).toEqual([]);
    // In a span: the own ¶ goes, another ¶ is keyed with the span's id.
    const two = splitWithSuggestion(docOf([{ id: "p", text: "abcd" }, { id: "z", text: "z" }]), createPosition(id("p"), 2), alloc(), A("s"));
    const span = markDeletion(two.document, createSpan(createPosition(two.newBlockId, 1), createPosition(id("z"), 0)), A("d")).document;
    expect(read(span)).toBe("p:abcd | z:z");
    expect(keysOf(span, "p")).toEqual({ deletionId: "d" });
  });

  it("another author's live deletion is never overwritten (no-op); a dead key may be", () => {
    const j = markParagraphMarkDeletion(docOf([{ id: "l", text: "ab" }, { id: "r", text: "cd" }]), id("l"), A("ja")).document;
    expect(markParagraphMarkDeletion(j, id("l"), B("jb")).document).toBe(j);
    const dead = applyOperation(j, (d) => {
      getSuggestionsMap(d).delete("ja");
      return new Set([j.rootId]);
    }).document;
    expect(keysOf(markParagraphMarkDeletion(dead, id("l"), B("jb")).document, "l")).toEqual({ deletionId: "jb" });
  });
});

describe("paste, upgrade", () => {
  const noTags = (s: Document): void => {
    for (const [, e] of getRegistry(s[DOCUMENT_INTERNAL].doc).entries()) {
      for (const k of [INSERTION_TAG_KEY, DELETION_TAG_KEY]) expect(e.has(k)).toBe(false);
    }
  };

  it("a copied keyed ¶ pastes as a real break (the fragment carries no keys)", () => {
    const sp = splitWithSuggestion(docOf([{ id: "p", text: "abcd" }]), createPosition(id("p"), 2), alloc(), A("s1"));
    const frag = extractFragment(sp.document, createSpan(createPosition(sp.newBlockId, 0), createPosition(id("p"), 2)));
    noTags(frag);
    const pasted = insertFragment(docOf([{ id: "x", text: "XY" }]), createSpan(createPosition(id("x"), 1), createPosition(id("x"), 1)), frag, alloc("v"));
    expect(read(pasted.document).replace(/v[^:]*:/g, "_:")).toBe("_:Xab | x:cdY");
    noTags(pasted.document);
    expect(getSuggestionsMap(pasted.document[DOCUMENT_INTERNAL].doc).size).toBe(0);
  });

  it("a legacy clip with break embeds is upgraded, then pastes as real breaks", () => {
    const clip = bytesToBase64(
      Y.encodeStateAsUpdate(legacyDoc([text("ab"), embed("block-split-suggestion", { suggestionId: "sp" })], [text("cd")])),
    );
    const frag = decodeFragmentClip(clip, TEST_RESOLVER, attrRegistry);
    if (frag === null) throw new Error("clip did not decode");
    const pasted = insertFragment(docOf([{ id: "x", text: "XY" }]), createSpan(createPosition(id("x"), 1), createPosition(id("x"), 1)), frag, alloc("v"));
    expect(read(pasted.document).replace(/v[^:]*:/g, "_:")).toBe("_:Xab | x:cdY");
    noTags(pasted.document);
    expect(ids(pasted.document)).toEqual([]);
  });

  it("upgrade: trailing, mid-content and both-kind embeds become keys on N's own ¶; orphans are reported", () => {
    const doc = legacyDoc(
      [text("ab"), embed("block-split-suggestion", { suggestionId: "sp" }), text("c"), embed("block-join-suggestion", { suggestionId: "jn" })],
      [text("de"), embed("block-split-suggestion", { suggestionId: "orphan" })],
    );
    const report = upgradeDocument(withTestAttrs(doc), { resolver: TEST_RESOLVER });
    expect(report.orphanedBreakSuggestions).toEqual(["orphan"]);
    const s = createDocument({ resolver: TEST_RESOLVER, rootId: id("doc"), doc });
    expect(getBlock(s, id("p1"))?.breakSuggestion).toEqual({ insertionId: "sp", deletionId: "jn" });
    expect(getBlock(s, id("p1"))?.inlineContent?.items.map((i) => (i.kind === "text" ? i.text : i.embedType))).toEqual(["abc"]);
    expect(getBlock(s, id("p2"))?.breakSuggestion).toBeUndefined();
  });
});

describe("collaboration (two Y.Docs)", () => {
  it("probe p1 regression: concurrent typing next to a keyed ¶ never gains the key (entry keys have no range)", () => {
    const s0 = docOf([{ id: "l", text: "ab" }, { id: "r", text: "cd" }]);
    let pa = peer(s0, 1);
    let pb = peer(s0, 2);
    pa = markParagraphMarkDeletion(pa, id("l"), A("j")).document;
    pb = insertText(pb, createPosition(id("l"), 2), "Y", {}).document;
    pb = insertText(pb, createPosition(id("r"), 0), "Z", {}).document;
    [pa, pb] = sync(pa, pb);
    for (const s of [pa, pb]) {
      expect(read(s)).toBe("l:abY | r:Zcd");
      for (const b of ["l", "r"]) for (const it of getBlock(s, id(b))?.inlineContent?.items ?? []) expect(it.attrs).toEqual({});
      expect(keysOf(s, "l")).toEqual({ deletionId: "j" });
    }
    // Accept deletes exactly ¶l: both peers' text survives.
    expect(read(acceptSuggestion(pa, sid("j")).document)).toBe("r:abYZcd");
  });

  it("key × concurrent removal of the keyed paragraph: the key is on a dead ¶, hidden, and its record is cleaned lazily", () => {
    const s0 = docOf([{ id: "l", text: "ab" }, { id: "r", text: "cd" }, { id: "z", text: "z" }]);
    let pa = peer(s0, 1);
    let pb = peer(s0, 2);
    pa = markParagraphMarkDeletion(pa, id("l"), A("j")).document;
    pb = removeBlock(pb, id("l")).document;
    [pa, pb] = sync(pa, pb);
    expect(read(pa)).toBe(read(pb));
    expect(ids(pa)).toEqual([]);
    const other = mintInsertion(pa, createPosition(id("z"), 0), "q", {}, B("i")).document;
    expect(records(acceptSuggestion(other, sid("i")).document)).toEqual([]);
  });
});

describe("accessibility + dirty", () => {
  it("the ¶ owner's own node carries the suggestion description", () => {
    const j = markParagraphMarkDeletion(docOf([{ id: "l", text: "ab" }, { id: "r", text: "cd" }]), id("l"), A("j1")).document;
    const tree = buildAccessibilityTree(j);
    const find = (n: AccessibilityNode, want: string): AccessibilityNode | null =>
      n.sourceBlockId === want ? n : n.children.reduce<AccessibilityNode | null>((acc, c) => acc ?? find(c, want), null);
    expect(find(tree, "l")?.suggestion).toEqual({ kind: "join", author: "alice", description: "Suggested paragraph join by alice" });
    expect(find(tree, "r")?.suggestion).toBeUndefined();
  });

  it("a key write dirties exactly its owner, locally and on a peer", () => {
    const s0 = docOf([{ id: "l", text: "ab" }, { id: "r", text: "cd" }, { id: "z", text: "z" }]);
    const pb = peer(s0, 808);
    const ra = markParagraphMarkDeletion(s0, id("l"), A("j1"));
    expect([...ra.dirtyIds].filter((x) => x !== s0.rootId)).toEqual(["l"]);
    const db = pb[DOCUMENT_INTERNAL].doc;
    const remote: string[] = [];
    const h = (tx: Y.Transaction): void => {
      remote.push(...dirtyIdsFromTransaction(db, tx));
    };
    db.on("afterTransaction", h);
    Y.applyUpdate(db, Y.encodeStateAsUpdate(ra.document[DOCUMENT_INTERNAL].doc), "remote");
    db.off("afterTransaction", h);
    expect(remote.filter((x) => x !== s0.rootId)).toEqual(["l"]);
  });
});

function fail(): never {
  throw new Error("expected a block");
}
