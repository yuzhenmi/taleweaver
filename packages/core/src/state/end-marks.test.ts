/**
 * The end-mark reference model (storage and position tests), state level: every paragraph is terminated by its own ¶
 * item; split inserts a ¶, merge deletes one, no text item moves; invariant I holds
 * through the two primitives `deleteUnits` / `insertItemsAt`; the final section
 * always exists.
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import type { BlockId } from "./block-id";
import { createTestAllocator } from "./block-id";
import { createDocument, getBlock, getEmbedContent, getTemplateContent, applyOperation, type Document } from "./document";
import { DOCUMENT_INTERNAL } from "./document-internal";
import { createEmptyDocument } from "./create-empty-document";
import { splitBlockAtPosition } from "./ops/split-block";
import { mergeAdjacentBlocks } from "./ops/merge-blocks";
import { removeBlock } from "./ops/remove-block";
import { reparentChildren } from "./ops/reparent-children";
import { insertText } from "./ops/insert-text";
import { createPosition, type Position } from "./block-position";
import { createPositionMapping } from "./position-mapping";
import { getRegistry, entryFlow } from "./registry";
import { liveMarks } from "./mark-index";
import { deleteUnits, insertChildren, splitAt, type TreeNode } from "./flow-ops";
import { firstUnitOfFlow, nextUnit } from "./y-flow";
import { upgradeDocument } from "./upgrade";
import { TEST_RESOLVER, buildBlock, buildDocument, buildFlowDoc, inlineContent, text, withTestAttrs } from "../test-utils/document-builders";
import { assertInvariantI, flowShape } from "../test-utils/invariant-i";

const id = (s: string) => s as BlockId;
const pos = (b: string, o: number): Position => createPosition(id(b), o);
const docOf = (s: Document) => s[DOCUMENT_INTERNAL].doc;

const build = buildFlowDoc;

const shape = (s: Document) => flowShape(s, "doc");
const childIds = (s: Document, parent: string): string[] => {
  const out: string[] = [];
  for (let c = getBlock(s, id(parent))?.firstChildId ?? null; c !== null; c = getBlock(s, c)?.nextSiblingId ?? null) out.push(c);
  return out;
};
const finalSection = (s: Document): string => {
  const f = getRegistry(docOf(s)).get(s.rootId)?.get("finalSection");
  if (typeof f !== "string") throw new Error("no final section");
  return f;
};
const paraMark = (s: Document, b: string): Y.Item => {
  const m = [...liveMarks(docOf(s), b)].find((it) => {
    const e: unknown = it.content instanceof Y.ContentEmbed ? it.content.embed : null;
    return typeof e === "object" && e !== null && (e as { end?: unknown }).end === b;
  });
  if (m === undefined) throw new Error(`no ¶ for ${b}`);
  return m;
};
const op = (s: Document, fn: (doc: Y.Doc) => void): Document => applyOperation(s, fn).document;

describe("storage — expected shapes (invariant I through the primitives)", () => {
  it("removeEntity of the flow's last paragraph keeps its ¶ (I2): [L a][P end] → [L a][P ]", () => {
    const s = removeBlock(build([{ p: "L", t: "a" }, { p: "P", t: "end" }]), id("P")).document;
    expect(shape(s)).toBe('L:"a" P:""');
    assertInvariantI(s, "storage");
  });

  it("removeEntity of the paragraph after a table goes when the next ¶ terminates it: [T][P x][Q y] → [T][Q y]", () => {
    const s = removeBlock(build([{ img: "T" }, { p: "P", t: "x" }, { p: "Q", t: "y" }]), id("P")).document;
    expect(shape(s)).toBe('[T] Q:"y"');
    assertInvariantI(s, "storage");
  });

  it("removeEntity of the required paragraph between two tables keeps its ¶: [T1][P][T2]", () => {
    const s = removeBlock(build([{ img: "T1" }, { p: "P", t: "x" }, { img: "T2" }, { p: "Z", t: "z" }]), id("P")).document;
    expect(shape(s)).toBe('[T1] P:"" [T2] Z:"z"');
    assertInvariantI(s, "storage");
  });

  it("delete-all of [T1][a¶A][b¶B][T2]: ¶A goes, ¶B is skipped (document order) → [T1][¶B][T2]", () => {
    let s = build([{ img: "T1" }, { p: "A", t: "a" }, { p: "B", t: "b" }, { img: "T2" }, { p: "Z", t: "z" }]);
    s = op(s, (doc) => {
      deleteUnits(doc, { spans: [{ id: "A", from: 0, to: 1 }, { id: "B", from: 0, to: 1 }], items: [paraMark(s, "A"), paraMark(s, "B")] });
    });
    expect(shape(s)).toBe('[T1] B:"" [T2] Z:"z"');
    assertInvariantI(s, "storage");
  });

  it("deleteUnits: several spans of one block go last-first; an endpoint inside a ZWJ cluster snaps OUT", () => {
    const FAMILY = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    let s = build([{ p: "P", t: `ab${FAMILY}cd` }]);
    s = op(s, (doc) => {
      deleteUnits(doc, { spans: [{ id: "P", from: 0, to: 1 }, { id: "P", from: 2, to: 3 }] });
    });
    expect(shape(s)).toBe('P:"bcd"');
  });

  it("deleting the final ¶ is skipped (I2)", () => {
    let s = build([{ p: "P", t: "x" }]);
    s = op(s, (doc) => {
      deleteUnits(doc, { items: [paraMark(s, "P")] });
    });
    expect(shape(s)).toBe('P:"x"');
  });

  it("moving the required paragraph to the end leaves a FRESH ¶ between the tables; P occurs once", () => {
    const s0 = build([{ img: "T1" }, { p: "P", t: "x" }, { img: "T2" }, { p: "Z", t: "z" }]);
    const s = reparentChildren(s0, [id("P")], id(finalSection(s0)), null).document;
    const m = /^\[T1\] (\S+):"" \[T2\] Z:"z" P:"x"$/.exec(shape(s));
    expect(m, shape(s)).not.toBeNull();
    expect(m?.[1]).not.toBe("P");
    assertInvariantI(s, "storage");
  });

  it("inserting a table after the flow's final ¶ adds ONE fresh final ¶; before another table, ONE ¶ between", () => {
    const img = (n: string): TreeNode => ({ id: id(n), type: "image", attrs: {}, inlineContent: null, children: [] });
    let s = build([{ p: "A", t: "a" }]);
    const F = finalSection(s);
    s = op(s, (doc) => insertChildren(doc, F, "A", [img("T")], "block"));
    expect(shape(s)).toMatch(/^A:"a" \[T\] \S+:""$/);
    assertInvariantI(s, "storage");
    let t = build([{ p: "A", t: "a" }, { img: "T2" }, { p: "Z", t: "z" }]);
    t = op(t, (doc) => insertChildren(doc, finalSection(t), "A", [img("T1")], "block"));
    expect(shape(t)).toMatch(/^A:"a" \[T1\] \S+:"" \[T2\] Z:"z"$/);
    assertInvariantI(t, "storage");
  });

  it("moving a table to the flow end, and away from between two tables, repairs with one fresh ¶ each", () => {
    const s0 = build([{ img: "T" }, { p: "P", t: "p" }, { p: "Z", t: "z" }]);
    const s = reparentChildren(s0, [id("T")], id(finalSection(s0)), null).document;
    expect(shape(s)).toMatch(/^P:"p" Z:"z" \[T\] \S+:""$/);
    assertInvariantI(s, "storage");
    const t0 = build([{ img: "T1" }, { p: "Q", t: "" }, { img: "T2" }, { p: "M", t: "" }, { img: "T3" }, { p: "Z", t: "z" }]);
    // Move T2 out from between T1 / T3 to the end: Q and M stay; the end gets a fresh ¶.
    const t = reparentChildren(t0, [id("T2")], id(finalSection(t0)), null).document;
    expect(shape(t)).toMatch(/^\[T1\] Q:"" M:"" \[T3\] Z:"z" \[T2\] \S+:""$/);
    assertInvariantI(t, "storage");
  });

  it("moving the final section's paragraph before a section-end leaves a fresh final PLAIN ¶", () => {
    const s0 = build([{ sec: "S1", children: [{ p: "A", t: "a" }] }, { sec: "F", children: [{ p: "P", t: "final" }] }]);
    const s = reparentChildren(s0, [id("P")], id("S1"), id("A")).document;
    expect(shape(s)).toMatch(/^P:"final" A:"a"\/S1 (\S+):""$/);
    assertInvariantI(s, "storage");
  });

  it("a moved paragraph carries its section-end: [A/S1][B][Z] move A to the end → [B][Z][a/S1][N]", () => {
    const s0 = build([{ sec: "S1", children: [{ p: "A", t: "a" }] }, { sec: "F", children: [{ p: "B", t: "b" }, { p: "Z", t: "z" }] }]);
    const s = reparentChildren(s0, [id("A")], id("F"), null).document;
    expect(shape(s)).toMatch(/^B:"b" Z:"z" A:"a"\/S1 (\S+):""$/);
    assertInvariantI(s, "storage");
  });

  it("inserting a fragment ending in a section-end after the final ¶ appends a fresh final plain ¶", () => {
    const s0 = build([{ p: "Z", t: "z" }]);
    const node: TreeNode = {
      id: id("S2"),
      type: "section",
      attrs: {},
      inlineContent: null,
      children: [{ id: id("Q"), type: "paragraph", attrs: {}, inlineContent: inlineContent([text("q")]), children: [] }],
    };
    const s = op(s0, (doc) => insertChildren(doc, finalSection(s0), "Z", [node], "block"));
    expect(shape(s)).toMatch(/^Z:"z" Q:"q"\/S2 (\S+):""$/);
    assertInvariantI(s, "storage");
  });

  it("concurrent removal of the two paragraphs leaves one empty paragraph (structural-identity :149)", () => {
    const base = build([{ p: "P1", t: "a" }, { p: "P2", t: "b" }]);
    const peer = (c: number): Document => {
      const d = new Y.Doc();
      d.clientID = c;
      Y.applyUpdate(d, Y.encodeStateAsUpdate(docOf(base)));
      return createDocument({ resolver: TEST_RESOLVER, rootId: base.rootId, doc: d });
    };
    const a = removeBlock(peer(1), id("P1")).document;
    const b = removeBlock(peer(2), id("P2")).document;
    Y.applyUpdate(docOf(a), Y.encodeStateAsUpdate(docOf(b)));
    const merged = createDocument({ resolver: TEST_RESOLVER, rootId: a.rootId, doc: docOf(a) });
    expect(shape(merged)).toBe('P2:""');
    assertInvariantI(merged, "read");
  });
});

describe("storage: Enter keeps content identity", () => {
  it("Enter at (B, k) keeps every text item's Yjs id; the head gets the new id, the tail keeps B", () => {
    const s0 = build([{ p: "B", t: "abcdef" }]);
    const ids = (s: Document): string[] => {
      const out: string[] = [];
      const flow = entryFlow(getRegistry(docOf(s)).get("doc") ?? new Y.Map());
      for (let u = flow === null ? null : firstUnitOfFlow(flow); u !== null; u = nextUnit(u)) {
        if (!u.deleted && u.content instanceof Y.ContentString) for (let i = 0; i < u.length; i++) out.push(`${u.id.client}:${u.id.clock + i}`);
      }
      return out;
    };
    const before = ids(s0);
    const s = splitBlockAtPosition(s0, pos("B", 3), createTestAllocator("n")).document;
    expect(shape(s)).toBe('n-0:"abc" B:"def"');
    expect(ids(s)).toEqual(before);
  });

  it("Enter at (B, 0) keeps B's id on the content (the new empty paragraph is above)", () => {
    const s = splitBlockAtPosition(build([{ p: "B", t: "abc" }]), pos("B", 0), createTestAllocator("n")).document;
    expect(shape(s)).toBe('n-0:"" B:"abc"');
  });

  it("merge: the survivor is R; L's type + attrs + markAttrs win (Google Docs / Quill), an empty DEFAULT L loses", () => {
    let s = build([{ p: "L", t: "ab", type: "heading", attrs: { level: 1 } }, { p: "R", t: "cd", attrs: { align: "center" } }]);
    s = op(s, (doc) => {
      const m = getRegistry(doc).get("L")?.get("markAttrs");
      if (m instanceof Y.Map) m.set("bold", true);
    });
    s = mergeAdjacentBlocks(s, id("L"), id("R")).document;
    expect(shape(s)).toBe('R:"abcd"');
    expect(getBlock(s, id("R"))?.type).toBe("heading");
    expect(getBlock(s, id("R"))?.attrs).toEqual({ level: 1 });
    expect((getRegistry(docOf(s)).get("R")?.get("markAttrs") as Y.Map<unknown>).toJSON()).toEqual({ bold: true });
    const h = mergeAdjacentBlocks(build([{ p: "L", t: "", type: "heading", attrs: { level: 1 } }, { p: "R", t: "cd", attrs: { align: "center" } }]), id("L"), id("R")).document;
    expect(shape(h)).toBe('R:"cd"');
    expect(getBlock(h, id("R"))?.type).toBe("heading");
    expect(getBlock(h, id("R"))?.attrs).toEqual({ level: 1 });
    const e = mergeAdjacentBlocks(build([{ p: "L", t: "" }, { p: "R", t: "cd", attrs: { align: "center" } }]), id("L"), id("R")).document;
    expect(shape(e)).toBe('R:"cd"');
    expect(getBlock(e, id("R"))?.type).toBe("paragraph");
    expect(getBlock(e, id("R"))?.attrs).toEqual({ align: "center" });
  });

  it("an empty document / cell / footnote body / header body holds exactly one ¶", () => {
    const empty = createEmptyDocument({ resolver: TEST_RESOLVER, allocator: createTestAllocator("e") });
    expect(flowShape(empty, empty.rootId)).toMatch(/^\S+:""$/);
    const table = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "t", lastChildId: "z" }),
        buildBlock({ id: "t", type: "table", parentId: "doc", nextSiblingId: "z", firstChildId: "r", lastChildId: "r" }),
        buildBlock({ id: "r", type: "table-row", parentId: "t", firstChildId: "c", lastChildId: "c" }),
        buildBlock({ id: "c", type: "table-cell", parentId: "r" }),
        buildBlock({ id: "z", type: "paragraph", parentId: "doc", prevSiblingId: "t", inlineContent: inlineContent([]) }),
      ],
      embedContents: [buildBlock({ id: "fb", type: "footnote-body" })],
      templateContents: [buildBlock({ id: "hb", type: "header-body" })],
    });
    expect(flowShape(table, "c")).toMatch(/^\S+:""$/);
    expect(flowShape(table, "fb")).toMatch(/^\S+:""$/);
    expect(flowShape(table, "hb")).toMatch(/^\S+:""$/);
    expect(getEmbedContent(table, id("fb"))?.firstChildId).not.toBeNull();
    expect(getTemplateContent(table, id("hb"))?.firstChildId).not.toBeNull();
    assertInvariantI(table, "storage");
  });

  it("a section-end item terminates its paragraph; deleting it merges the paragraphs and the content takes the FOLLOWING section", () => {
    let s = build([
      { sec: "S1", attrs: { pageWidth: 50 }, children: [{ p: "A", t: "a" }] },
      { sec: "F", attrs: { pageWidth: 100 }, children: [{ p: "B", t: "b" }] },
    ]);
    expect(shape(s)).toBe('A:"a"/S1 B:"b"');
    expect(childIds(s, "doc")).toEqual(["S1", "F"]);
    expect(getBlock(s, id("A"))?.parentId).toBe("S1");
    expect(getBlock(s, id("B"))?.parentId).toBe("F");
    s = op(s, (doc) => {
      deleteUnits(doc, { items: [paraMark(s, "A")] });
    });
    expect(shape(s)).toBe('B:"ab"');
    expect(childIds(s, "doc")).toEqual(["F"]);
    expect(getBlock(s, id("B"))?.parentId).toBe("F");
    expect(getBlock(s, id("F"))?.attrs).toEqual({ pageWidth: 100 });
    assertInvariantI(s, "storage");
  });

  it("a section always has ≥ 1 paragraph: a section ending in an object gets its own terminating ¶", () => {
    const s = build([{ sec: "S1", children: [{ p: "A", t: "a" }, { img: "T" }] }, { sec: "F", children: [{ p: "B", t: "b" }] }]);
    expect(shape(s)).toMatch(/^A:"a" \[T\] (\S+):""\/S1 B:"b"$/);
    assertInvariantI(s, "storage");
  });

  it("the final section always exists and the root's child shape never flips", () => {
    const s0 = createEmptyDocument({ resolver: TEST_RESOLVER, allocator: createTestAllocator("e") });
    const F = finalSection(s0);
    const p = getBlock(s0, id(F))?.firstChildId ?? null;
    expect(childIds(s0, s0.rootId)).toEqual([F]);
    expect(getBlock(s0, id(F))?.type).toBe("section");
    if (p === null) throw new Error("no paragraph");
    const s1 = insertText(s0, pos(p, 0), "abcd", {}).document;
    const s2 = op(s1, (doc) => {
      getRegistry(doc).set("S1", getRegistryEntryLike(doc, F));
      splitAt(doc, p, 2, "H", { type: "paragraph", attrs: {}, tree: "block" }, { section: "S1" });
    });
    expect(childIds(s2, s2.rootId)).toEqual(["S1", F]);
    expect(getBlock(s2, id("H"))?.parentId).toBe("S1");
    expect(getBlock(s2, id(p))?.parentId).toBe(F);
    const s3 = op(s2, (doc) => {
      deleteUnits(doc, { items: [paraMark(s2, "H")] });
    });
    expect(childIds(s3, s3.rootId)).toEqual([F]);
    expect(getBlock(s3, id(p))?.parentId).toBe(F);
  });

  it("upgrade: a section ending in a table gets an empty terminating paragraph; markAttrs come from the last run", () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      for (const key of ["embedContents", "templateContents", "listDefs", "comments", "suggestions"]) doc.getMap(key);
      doc.getMap("meta").set("rootId", "doc");
      const blocks = doc.getMap<Y.Map<unknown>>("blocks");
      const yb = (f: Record<string, unknown>, inline: Y.Text | null = null): Y.Map<unknown> => {
        const m = new Y.Map<unknown>();
        m.set("attrs", new Y.Map<unknown>());
        for (const k of ["parentId", "prevSiblingId", "nextSiblingId", "firstChildId", "lastChildId"]) m.set(k, f[k] ?? null);
        m.set("type", f.type);
        m.set("inlineContent", inline);
        return m;
      };
      const yt = (s: string, attrs: Record<string, unknown> = {}): Y.Text => {
        const t = new Y.Text();
        t.insert(0, s, attrs);
        return t;
      };
      blocks.set("doc", yb({ type: "document", firstChildId: "s1", lastChildId: "s2" }));
      blocks.set("s1", yb({ type: "section", parentId: "doc", nextSiblingId: "s2", firstChildId: "a", lastChildId: "t" }));
      // The last run carries a non-inclusive link and a provenance id: neither reaches markAttrs.
      blocks.set("a", yb({ type: "paragraph", parentId: "s1", nextSiblingId: "t" }, yt("ab", { bold: true, link: "u", insertionSuggestionId: "s9" })));
      blocks.set("t", yb({ type: "table", parentId: "s1", prevSiblingId: "a", firstChildId: "r", lastChildId: "r" }));
      blocks.set("r", yb({ type: "table-row", parentId: "t", firstChildId: "c", lastChildId: "c" }));
      blocks.set("c", yb({ type: "table-cell", parentId: "r", firstChildId: "cp", lastChildId: "cp" }));
      blocks.set("cp", yb({ type: "paragraph", parentId: "c" }, yt("")));
      blocks.set("s2", yb({ type: "section", parentId: "doc", prevSiblingId: "s1", firstChildId: "b", lastChildId: "b" }));
      blocks.set("b", yb({ type: "paragraph", parentId: "s2" }, yt("")));
      doc.getMap("meta").set("schemaVersion", 2);
    });
    upgradeDocument(withTestAttrs(doc), { resolver: TEST_RESOLVER });
    const s = createDocument({ resolver: TEST_RESOLVER, rootId: id("doc"), doc });
    expect(shape(s)).toMatch(/^a:"ab" \[t\] (\S+):""\/s1 b:""$/);
    expect(getRegistry(doc).get("doc")?.get("finalSection")).toBe("s2");
    expect(childIds(s, "doc")).toEqual(["s1", "s2"]);
    expect((getRegistry(doc).get("a")?.get("markAttrs") as Y.Map<unknown>).toJSON()).toEqual({ bold: true });
    expect((getRegistry(doc).get("b")?.get("markAttrs") as Y.Map<unknown>).size).toBe(0);
    assertInvariantI(s, "storage");
  });
});

/** A detached copy of section entry `from` (for a raw section-break test). */
function getRegistryEntryLike(doc: Y.Doc, from: string): Y.Map<unknown> {
  const src = getRegistry(doc).get(from);
  const e = new Y.Map<unknown>();
  e.set("type", "section");
  e.set("attrs", new Y.Map<unknown>());
  e.set("tree", "block");
  e.set("shape", src?.get("shape") ?? "section");
  return e;
}

describe("positions — the ¶ is one unit of the index model", () => {
  it("tx-mapping: Enter inserts one unit — (B, k) maps to (H, k) with assoc −1 and (B, 0) with assoc 1", () => {
    const prev = build([{ p: "B", t: "abcdef" }]);
    const r = splitBlockAtPosition(prev, pos("B", 3), createTestAllocator("n"));
    const m = createPositionMapping(prev, r.document, r.dirtyIds);
    expect(m.map(pos("B", 3), -1).position).toEqual(pos("n-0", 3));
    expect(m.map(pos("B", 3), 1).position).toEqual(pos("B", 0));
    expect(m.map(pos("B", 5), 1).position).toEqual(pos("B", 2));
    expect(m.map(pos("B", 1), 1).position).toEqual(pos("n-0", 1));
  });

  it("an anchor at (P, len) across a split at (P, len) lands at (H, len) with assoc −1 and (P, 0) with assoc 1", () => {
    const prev = build([{ p: "P", t: "abc" }]);
    const r = splitBlockAtPosition(prev, pos("P", 3), createTestAllocator("n"));
    const m = createPositionMapping(prev, r.document, r.dirtyIds);
    expect(m.map(pos("P", 3), -1).position).toEqual(pos("n-0", 3));
    expect(m.map(pos("P", 3), 1).position).toEqual(pos("P", 0));
  });

  it("tx-mapping: Backspace-merge deletes one unit — (L, len) and (R, 0) meet at (R, len(L))", () => {
    const prev = build([{ p: "L", t: "abc" }, { p: "R", t: "def" }]);
    const r = mergeAdjacentBlocks(prev, id("L"), id("R"));
    const m = createPositionMapping(prev, r.document, r.dirtyIds);
    expect(m.map(pos("L", 3), 1).position).toEqual(pos("R", 3));
    expect(m.map(pos("R", 0), -1).position).toEqual(pos("R", 3));
    expect(m.map(pos("L", 1), 1).position).toEqual(pos("R", 1));
    expect(m.map(pos("R", 2), 1).position).toEqual(pos("R", 5));
  });

  it("no Position after a flow's final ¶ validates", () => {
    const s = build([{ p: "P", t: "abc" }]);
    expect(() => insertText(s, pos("P", 4), "x", {})).toThrow();
  });
});
