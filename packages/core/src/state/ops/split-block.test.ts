/**
 * Split (Word / Quill): insert a ¶ at the caret. The NEW ¶ ends the
 * HEAD [0, k), which takes the new id; the tail keeps ¶B, its id and its entry. No
 * text item moves. One-shot attrs follow the content that carried them;
 * `newBlockInit` ("style for the following paragraph") is written onto B at k = len;
 * H's ¶ takes the inclusive formatting at the caret (`markAttrs`).
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  splitBlockAtPosition,
  splitBlockAtPositionInTx,
  planSplitBlockAtPosition,
} from "./split-block";
import { planInsertText, insertTextInTx } from "./insert-text";
import { setBlockAttrs } from "./set-block-attrs";
import { applyOperation, createDocument, getBlock, type Document } from "../document";
import { DOCUMENT_INTERNAL } from "../document-internal";
import { createHistory } from "../history";
import type { Block } from "../block";
import { buildBlock, buildDocument, text, embed, inlineContent, TEST_RESOLVER, withTestAttrs } from "../../test-utils/document-builders";
import { flowShape, assertInvariantI } from "../../test-utils/invariant-i";
import { createPosition, createSpan } from "../block-position";
import { createTestAllocator, type BlockId } from "../block-id";

const id = (s: string) => s as BlockId;
/** doc > [blocks…] (a section-less document: its blocks sit in the final section). */
function doc(...blocks: Block[]): Document {
  const ids = blocks.map((b) => b.id);
  const linked = blocks.map((b, i) => ({ ...b, parentId: id("doc"), prevSiblingId: ids[i - 1] ?? null, nextSiblingId: ids[i + 1] ?? null }));
  return buildDocument({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document", firstChildId: ids[0] ?? null, lastChildId: ids[ids.length - 1] ?? null }), ...linked] });
}
const para = (pid: string, ...items: Parameters<typeof inlineContent>[0]) => buildBlock({ id: pid, type: "paragraph", inlineContent: inlineContent(items) });
const fin = (s: Document): BlockId => {
  const f = getBlock(s, id("doc"))?.lastChildId;
  if (f === null || f === undefined) throw new Error("no final section");
  return f;
};
const items = (s: Document, b: string) => getBlock(s, id(b))?.inlineContent?.items;

describe("splitBlockAtPosition — the head takes the new id, the tail keeps B", () => {
  it("mid-text: H = [0, k), B = [k, len); links and dirty ids", () => {
    const document = doc(para("p", text("hello world")));
    const F = fin(document);
    const result = splitBlockAtPosition(document, createPosition(id("p"), 5), createTestAllocator("p2"));
    expect(flowShape(result.document, "doc")).toBe('p2-0:"hello" p:" world"');
    const head = getBlock(result.document, id("p2-0"));
    expect(head?.type).toBe("paragraph");
    expect(head?.parentId).toBe(F);
    expect(head?.prevSiblingId).toBeNull();
    expect(head?.nextSiblingId).toBe("p");
    expect(getBlock(result.document, id("p"))?.prevSiblingId).toBe("p2-0");
    expect(getBlock(result.document, F)?.firstChildId).toBe("p2-0");
    expect(getBlock(result.document, F)?.lastChildId).toBe("p");
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p", "p2-0", F]));
    assertInvariantI(result.document, "storage");
  });

  it("splits between two text items without splitting either; attrs survive on both halves", () => {
    const s1 = splitBlockAtPosition(doc(para("p", text("hello"), text(" world", { italic: true }))), createPosition(id("p"), 5), createTestAllocator("p2")).document;
    expect(items(s1, "p2-0")).toEqual([{ kind: "text", text: "hello", attrs: {} }]);
    expect(items(s1, "p")).toEqual([{ kind: "text", text: " world", attrs: { italic: true } }]);
    const s2 = splitBlockAtPosition(doc(para("p", text("ab"), text("cd", { bold: true }), text("ef"))), createPosition(id("p"), 3), createTestAllocator("p2")).document;
    expect(items(s2, "p2-0")).toMatchObject([{ text: "ab", attrs: {} }, { text: "c", attrs: { bold: true } }]);
    expect(items(s2, "p")).toMatchObject([{ text: "d", attrs: { bold: true } }, { text: "ef", attrs: {} }]);
  });

  it("splits at either edge of an embed", () => {
    const fixture = () => doc(para("p", text("a"), embed("img"), text("b")));
    const lead = splitBlockAtPosition(fixture(), createPosition(id("p"), 1), createTestAllocator("p2")).document;
    expect(items(lead, "p2-0")).toMatchObject([{ kind: "text", text: "a" }]);
    expect(items(lead, "p")).toMatchObject([{ kind: "embed", embedType: "img" }, { kind: "text", text: "b" }]);
    const trail = splitBlockAtPosition(fixture(), createPosition(id("p"), 2), createTestAllocator("p2")).document;
    expect(items(trail, "p2-0")).toMatchObject([{ kind: "text", text: "a" }, { kind: "embed", embedType: "img" }]);
    expect(items(trail, "p")).toMatchObject([{ kind: "text", text: "b" }]);
    const zero = splitBlockAtPosition(doc(para("p", embed("img"), text("a"))), createPosition(id("p"), 0), createTestAllocator("p2")).document;
    expect(items(zero, "p2-0")).toEqual([]);
    expect(items(zero, "p")).toMatchObject([{ kind: "embed", embedType: "img" }, { kind: "text", text: "a" }]);
  });

  it("offset 0 of a non-empty block: the new EMPTY paragraph is above, the content keeps B's id", () => {
    const document = doc(para("p", text("hello")));
    const F = fin(document);
    const result = splitBlockAtPosition(document, createPosition(id("p"), 0), createTestAllocator("p2"));
    expect(flowShape(result.document, "doc")).toBe('p2-0:"" p:"hello"');
    expect(getBlock(result.document, F)?.firstChildId).toBe("p2-0");
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p", "p2-0", F]));
  });

  it("offset = length: the head keeps the text under the new id, the empty tail keeps B", () => {
    const result = splitBlockAtPosition(doc(para("p", text("hello"))), createPosition(id("p"), 5), createTestAllocator("p2"));
    expect(flowShape(result.document, "doc")).toBe('p2-0:"hello" p:""');
  });

  it("an empty block splits into two empty paragraphs", () => {
    const result = splitBlockAtPosition(doc(para("p")), createPosition(id("p"), 0), createTestAllocator("p2"));
    expect(flowShape(result.document, "doc")).toBe('p2-0:"" p:""');
    expect(getBlock(result.document, id("p2-0"))?.type).toBe("paragraph");
  });

  it("linked list: a middle split rewires only the previous sibling; the next one and the parent are untouched", () => {
    const document = doc(para("p1", text("one")), para("p2", text("two")), para("p3", text("three")));
    const F = fin(document);
    const result = splitBlockAtPosition(document, createPosition(id("p2"), 1), createTestAllocator("p2b"));
    expect(flowShape(result.document, "doc")).toBe('p1:"one" p2b-0:"t" p2:"wo" p3:"three"');
    expect(getBlock(result.document, id("p1"))?.nextSiblingId).toBe("p2b-0");
    expect(getBlock(result.document, id("p2b-0"))?.prevSiblingId).toBe("p1");
    expect(getBlock(result.document, id("p2"))?.prevSiblingId).toBe("p2b-0");
    expect(getBlock(result.document, id("p3"))?.prevSiblingId).toBe("p2");
    expect(getBlock(result.document, F)?.firstChildId).toBe("p1");
    expect(getBlock(result.document, F)?.lastChildId).toBe("p3");
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "p2b-0"]));
  });

  it("first-child / last-child splits rewire the parent's first child only", () => {
    const first = doc(para("p1", text("one")), para("p2", text("two")));
    const F = fin(first);
    const r1 = splitBlockAtPosition(first, createPosition(id("p1"), 1), createTestAllocator("n"));
    expect(getBlock(r1.document, F)?.firstChildId).toBe("n-0");
    expect(getBlock(r1.document, F)?.lastChildId).toBe("p2");
    const last = doc(para("p1", text("one")), para("p2", text("two")));
    const F2 = fin(last);
    const r2 = splitBlockAtPosition(last, createPosition(id("p2"), 1), createTestAllocator("m"));
    expect(getBlock(r2.document, F2)?.firstChildId).toBe("p1");
    expect(getBlock(r2.document, F2)?.lastChildId).toBe("p2");
    expect(getBlock(r2.document, id("m-0"))?.prevSiblingId).toBe("p1");
  });

  it("a paragraph inside an explicit section splits under that section", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "p_only", lastChildId: "p_only" }),
        buildBlock({ id: "p_only", type: "paragraph", parentId: "section", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const result = splitBlockAtPosition(document, createPosition(id("p_only"), 3), createTestAllocator("pNew"));
    expect(getBlock(result.document, id("pNew-0"))?.parentId).toBe("section");
    expect(getBlock(result.document, id("section"))?.firstChildId).toBe("pNew-0");
    expect(getBlock(result.document, id("section"))?.lastChildId).toBe("p_only");
    expect(getBlock(result.document, id("doc"))?.firstChildId).toBe("section");
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p_only", "pNew-0", "section"]));
  });

  it("the head takes B's type + attrs; its id comes from the allocator", () => {
    const document = doc(buildBlock({ id: "li", type: "list-item", attrs: { level: 2, ordered: true }, inlineContent: inlineContent([text("hello")]) }));
    const result = splitBlockAtPosition(document, createPosition(id("li"), 3), createTestAllocator("custom"));
    const head = getBlock(result.document, id("custom-0"));
    expect(head?.type).toBe("list-item");
    expect(head?.attrs).toEqual({ level: 2, ordered: true });
    expect(getBlock(result.document, id("li"))?.attrs).toEqual({ level: 2, ordered: true });
  });

  it("snapshots: the pre-op state still reads the pre-op snapshots", () => {
    const document = doc(para("p1", text("one")), para("p", text("hello")), para("p3", text("three")));
    const beforeP = getBlock(document, id("p"));
    const result = splitBlockAtPosition(document, createPosition(id("p"), 2), createTestAllocator("p2"));
    expect(result.document).not.toBe(document);
    expect(getBlock(document, id("p"))).toBe(beforeP);
    expect(beforeP?.inlineContent?.items).toMatchObject([{ text: "hello" }]);
    expect(getBlock(result.document, id("p"))).not.toBe(beforeP);
  });

  it("snaps ONCE inside a surrogate pair: the cut uses one grapheme boundary", () => {
    const result = splitBlockAtPosition(doc(para("p", text("a😀b"))), createPosition(id("p"), 2), createTestAllocator("p2"));
    expect(items(result.document, "p2-0")).toMatchObject([{ text: "a" }]);
    expect(items(result.document, "p")).toMatchObject([{ text: "😀b" }]);
  });
});

describe("splitBlockAtPosition — newBlockInit, one-shot attrs, ¶ character props", () => {
  const heading = () => doc(buildBlock({ id: "h", type: "heading", attrs: { level: 1 }, inlineContent: inlineContent([text("Title")]) }));

  it("newBlockInit at k = len is written onto B (the empty tail); H keeps the heading", () => {
    const result = splitBlockAtPosition(heading(), createPosition(id("h"), 5), createTestAllocator("n"), { type: "paragraph", attrs: {} });
    expect(flowShape(result.document, "doc")).toBe('n-0:"Title" h:""');
    expect(getBlock(result.document, id("n-0"))?.type).toBe("heading");
    expect(getBlock(result.document, id("n-0"))?.attrs).toEqual({ level: 1 });
    expect(getBlock(result.document, id("h"))?.type).toBe("paragraph");
    expect(getBlock(result.document, id("h"))?.attrs).toEqual({});
  });

  it("without newBlockInit both halves keep the heading; before the end newBlockInit does not apply", () => {
    const plain = splitBlockAtPosition(heading(), createPosition(id("h"), 5), createTestAllocator("n")).document;
    expect(getBlock(plain, id("n-0"))?.type).toBe("heading");
    expect(getBlock(plain, id("h"))?.type).toBe("heading");
    const mid = splitBlockAtPosition(heading(), createPosition(id("h"), 2), createTestAllocator("n"), { type: "paragraph", attrs: {} }).document;
    expect(getBlock(mid, id("h"))?.type).toBe("heading");
    expect(getBlock(mid, id("n-0"))?.type).toBe("heading");
  });

  const listItem = (t: string) => doc(buildBlock({ id: "b", type: "paragraph", attrs: { listId: "L", listCounterOverride: 5 }, inlineContent: inlineContent(t === "" ? [] : [text(t)]) }));

  it("one-shot attrs follow the content: k > 0 and k = len move them to H, deleted from B", () => {
    for (const k of [1, 3]) {
      const s = splitBlockAtPosition(listItem("abc"), createPosition(id("b"), k), createTestAllocator("n")).document;
      expect(getBlock(s, id("n-0"))?.attrs).toEqual({ listId: "L", listCounterOverride: 5 });
      expect(getBlock(s, id("b"))?.attrs).toEqual({ listId: "L" });
    }
  });

  it("one-shot attrs: k = 0 on a non-empty B keeps them on B; an empty B moves them to H (the upper paragraph)", () => {
    const zero = splitBlockAtPosition(listItem("abc"), createPosition(id("b"), 0), createTestAllocator("n")).document;
    expect(getBlock(zero, id("n-0"))?.attrs).toEqual({ listId: "L" });
    expect(getBlock(zero, id("b"))?.attrs).toEqual({ listId: "L", listCounterOverride: 5 });
    const empty = splitBlockAtPosition(listItem(""), createPosition(id("b"), 0), createTestAllocator("n")).document;
    expect(getBlock(empty, id("n-0"))?.attrs).toEqual({ listId: "L", listCounterOverride: 5 });
    expect(getBlock(empty, id("b"))?.attrs).toEqual({ listId: "L" });
  });

  it("H's ¶ takes the INCLUSIVE formatting at the caret (no link, no provenance); an empty B passes its own", () => {
    // The registry bound to the doc judges inclusiveness (none bound: no markAttrs).
    const state = () => doc(para("p", text("ab", { bold: true }), text("cd", { bold: true, link: "x", insertionSuggestionId: "s1" })));
    expect(getBlock(splitBlockAtPosition(state(), createPosition(id("p"), 4), createTestAllocator("n")).document, id("n-0"))?.markAttrs).toBeUndefined();
    const end = splitBlockAtPosition(withTestAttrs(state()), createPosition(id("p"), 4), createTestAllocator("n")).document;
    expect(getBlock(end, id("n-0"))?.markAttrs).toEqual({ bold: true });
    const start = splitBlockAtPosition(withTestAttrs(doc(para("p", text("ab", { italic: true })))), createPosition(id("p"), 0), createTestAllocator("n")).document;
    expect(getBlock(start, id("n-0"))?.markAttrs).toEqual({ italic: true });
    const empty = doc({ ...para("p"), markAttrs: { bold: true } });
    const e = splitBlockAtPosition(empty, createPosition(id("p"), 0), createTestAllocator("n")).document;
    expect(getBlock(e, id("n-0"))?.markAttrs).toEqual({ bold: true });
    expect(getBlock(e, id("p"))?.markAttrs).toEqual({ bold: true });
  });

  it("split × a concurrent attr edit on B: the tail has the peer's write, H keeps the split-time copy (y-quill)", () => {
    const base = doc(buildBlock({ id: "b", type: "paragraph", attrs: { align: "left" }, inlineContent: inlineContent([text("abcd")]) }));
    const peer = (c: number): Document => {
      const d = new Y.Doc();
      d.clientID = c;
      Y.applyUpdate(d, Y.encodeStateAsUpdate(base[DOCUMENT_INTERNAL].doc));
      return createDocument({ resolver: TEST_RESOLVER, rootId: base.rootId, doc: d });
    };
    const a = splitBlockAtPosition(peer(1), createPosition(id("b"), 2), createTestAllocator("n")).document;
    const b = setBlockAttrs(peer(2), id("b"), { align: "right" }).document;
    Y.applyUpdate(a[DOCUMENT_INTERNAL].doc, Y.encodeStateAsUpdate(b[DOCUMENT_INTERNAL].doc));
    const merged = createDocument({ resolver: TEST_RESOLVER, rootId: a.rootId, doc: a[DOCUMENT_INTERNAL].doc });
    expect(flowShape(merged, "doc")).toBe('n-0:"ab" b:"cd"');
    expect(getBlock(merged, id("b"))?.attrs).toEqual({ align: "right" });
    expect(getBlock(merged, id("n-0"))?.attrs).toEqual({ align: "left" });
  });
});

describe("splitBlockAtPosition — error cases", () => {
  it("throws when the block does not exist", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(document, createPosition("missing" as BlockId, 0), allocator),
    ).toThrow(/not found/);
  });

  it("throws when the block is a container (firstChildId is set)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "s", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(document, createPosition("s" as BlockId, 0), allocator),
    ).toThrow(/container/);
  });

  it("throws when the block has null inlineContent (independent of firstChildId)", () => {
    // A block with inlineContent === null is container-shaped even if firstChildId
    // is also null. The container guard rejects on EITHER condition; this test pins
    // the inlineContent === null arm so a future regression that changes || to &&
    // (or removes the inlineContent check) is caught.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        // An object block: null inlineContent AND null firstChildId. (An empty
        // SECTION is not in the read model.)
        buildBlock({ id: "s", type: "horizontal-line", parentId: "doc" }),
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(document, createPosition("s" as BlockId, 0), allocator),
    ).toThrow(/container/);
  });

  it("throws when the block is the root (parentId is null)", () => {
    // Root block given leaf-shaped. A tree root is always a flow HOLDER (its own
    // inline content reads as the implicit paragraph `p#i`), so it is refused as a container.
    const document = buildDocument({
      rootId: "p",
      blocks: [
        buildBlock({ id: "p", type: "paragraph", parentId: null, inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(document, createPosition("p" as BlockId, 1), allocator),
    ).toThrow(/container/);
  });

  it("throws when offset is negative", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(document, createPosition("p" as BlockId, -1), allocator),
    ).toThrow(/out of range/);
  });

  it("throws when offset exceeds inlineContentLength", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator();
    expect(() =>
      splitBlockAtPosition(document, createPosition("p" as BlockId, 999), allocator),
    ).toThrow(/out of range/);
  });

  it("throws when the allocator returns a colliding id (already exists in blocks)", () => {
    // Seed state with a block named "collide-0", then provide an allocator
    // whose first allocation also returns "collide-0". Without the dev-mode
    // collision check, the Y.Map.set for the new split-block would silently
    // overwrite the existing "collide-0" block.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "collide-0" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "collide-0", inlineContent: inlineContent([text("hello world")]) }),
        buildBlock({ id: "collide-0", type: "paragraph", parentId: "doc", prevSiblingId: "p", inlineContent: inlineContent([]) }),
      ],
    });
    const allocator = createTestAllocator("collide");
    expect(() =>
      splitBlockAtPosition(document, createPosition("p" as BlockId, 5), allocator),
    ).toThrow(/allocator returned a colliding id "collide-0"/);
  });
});


describe("splitBlockAtPositionInTx — composability with insertTextInTx", () => {
  // Split "abcdef" at 3 (H = "abc", B = "def"), then insert "X" at (B, 0) — a position
  // the split does not invalidate — in ONE applyOperation: one undo entry.
  it("split + insertText composed in one applyOperation produce one undo entry", () => {
    const document = doc(para("p", text("abcdef")));
    const F = fin(document);
    const history = createHistory(document);
    const splitPlan = planSplitBlockAtPosition(document, createPosition(id("p"), 3), createTestAllocator("new"));
    const insertPlan = planInsertText(document, createPosition(id("p"), 0), "X", {});
    const opResult = applyOperation(document, () => {
      splitBlockAtPositionInTx(document[DOCUMENT_INTERNAL].doc, splitPlan);
      insertTextInTx(document[DOCUMENT_INTERNAL].doc, insertPlan);
    });
    const sel = createSpan(createPosition(id("p"), 0), createPosition(id("p"), 0));
    history.commit(opResult, { before: sel, after: sel });
    expect(flowShape(opResult.document, "doc")).toBe('new-0:"abc" p:"Xdef"');
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to succeed");
    expect(flowShape(undone.document, "doc")).toBe('p:"abcdef"');
    expect(getBlock(undone.document, id("new-0"))).toBeNull();
    expect(getBlock(undone.document, F)?.firstChildId).toBe("p");
    expect(history.canUndo()).toBe(false);
  });
});
