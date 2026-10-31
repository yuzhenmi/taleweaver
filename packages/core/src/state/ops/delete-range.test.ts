import { describe, it, expect } from "vitest";
import { deleteRange, deleteRangeInTx, planDeleteRange } from "./delete-range";
import { getBlock, getEmbedContent, type Document } from "../document";
import { DOCUMENT_INTERNAL } from "../document-internal";
import { buildBlock, buildDocument, buildFlowDoc, text, embed, inlineContent } from "../../test-utils/document-builders";
import { flowShape, assertInvariantI } from "../../test-utils/invariant-i";
import { createPosition, createSpan } from "../block-position";
import type { BlockId } from "../block-id";

describe("deleteRange — basic same-block range delete", () => {
  // doc > [p("hello world")]
  // Delete range [3, 7) — covers "lo w".
  // Expected: p("helorld")
  const fixture = () =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello world")]) }),
      ],
    });

  it("deletes the range from a single text item, keeping prefix and suffix", () => {
    const document = fixture();
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = deleteRange(document, span);

    const block = getBlock(result.document, "p" as BlockId);
    expect(block?.inlineContent?.items).toHaveLength(1);
    expect(block?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "helorld" });

    // dirtyIds: only the modified block.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p"]));
  });
});

describe("deleteRange — same-block: item shapes and edges", () => {
  it("deletes a range that exactly covers a text item (clean removal at boundary)", () => {
    // [text("hello"), text(" world")] — delete [0, 5) — drops "hello", keeps " world".
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello"), text(" world")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5));
    const result = deleteRange(document, span);
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: " world" });
  });

  it("deletes a range that spans multiple text items, splitting both endpoints", () => {
    // [text("ab"), text("cd"), text("ef")] — delete [1, 5) — keeps "a" + "f".
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("ab"), text("cd"), text("ef")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 5));
    const result = deleteRange(document, span);
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    // After run-merging: text("a") and text("f") have same attrs ({}), so they merge.
    expect(items?.[0]).toMatchObject({ text: "af", attrs: {} });
  });

  it("deletes an embed item in the range", () => {
    // [text("a"), embed("img"), text("b")] — delete [1, 2) — drops the embed.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("a"), embed("img"), text("b")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 2));
    const result = deleteRange(document, span);
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "ab" }); // run-merged at the seam
  });

  it("preserves attrs on both halves when splitting a styled item mid-text", () => {
    // [text("hello world", { bold: true })] — delete [3, 7) drops "lo w" (4 chars)
    // and leaves "hel" + "orld" → run-merged to text("helorld", {bold:true}).
    // Pins the attrs-preservation contract on both prefix and suffix sides.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello world", { bold: true })]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = deleteRange(document, span);
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "helorld", attrs: { bold: true } });
  });

  it("does NOT merge text across an embed at the seam", () => {
    // [text("a", {bold}), embed("img"), text("X"), text("b", {bold})]
    // Delete [2, 3) — drops text("X").
    // Result: [text("a", {bold}), embed, text("b", {bold})] — embed at seam,
    // text("a") and text("b") have same attrs but separated by embed → no merge.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("a", { bold: true }),
            embed("img"),
            text("X"),
            text("b", { bold: true }),
          ]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 2), createPosition("p" as BlockId, 3));
    const result = deleteRange(document, span);
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "img" });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b", attrs: { bold: true } });
  });
});

describe("deleteRange — cross-block (same-parent): the FOCUS survives (Word: ¶A and the crossed ¶s are deleted)", () => {
  const flow = (...ps: [string, string, Partial<{ type: string; attrs: Record<string, unknown> }>?][]) =>
    buildFlowDoc(ps.map(([p, t, more]) => ({ p, t, ...(more ?? {}) })));
  const fin = (s: Document): BlockId => {
    const f = getBlock(s, "doc" as BlockId)?.lastChildId;
    if (f === null || f === undefined) throw new Error("no final section");
    return f;
  };

  it("adjacent pair: the anchor prefix + the focus suffix read as the focus; links + dirty ids", () => {
    const document = flow(["p1", "hello"], ["p2", " world"]);
    const F = fin(document);
    const result = deleteRange(document, createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3)));
    expect(flowShape(result.document, "doc")).toBe('p2:"herld"');
    expect(getBlock(result.document, "p1" as BlockId)).toBeNull();
    expect(getBlock(result.document, F)?.firstChildId).toBe("p2");
    expect([...result.dirtyIds]).toEqual(expect.arrayContaining(["p1", "p2", F]));
    assertInvariantI(result.document, "storage");
  });

  it("intervening leaves go with their ¶s", () => {
    const document = flow(["p1", "hello"], ["p2", "middle"], ["p3", "world"]);
    const result = deleteRange(document, createSpan(createPosition("p1" as BlockId, 2), createPosition("p3" as BlockId, 2)));
    expect(flowShape(result.document, "doc")).toBe('p3:"herld"');
    expect([...result.dirtyIds]).toEqual(expect.arrayContaining(["p1", "p2", "p3"]));
  });

  it("removes an intervening TABLE whole — its subtree and the footnote bodies its cells reference", () => {
    // p1 | tbl[cp: "item" + footnote → fn] | p2 — a span p1@2 → p2@3 covers the table.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "tbl", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "tbl", type: "table", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p2", firstChildId: "r", lastChildId: "r" }),
        buildBlock({ id: "r", type: "table-row", parentId: "tbl", firstChildId: "c", lastChildId: "c" }),
        buildBlock({ id: "c", type: "table-cell", parentId: "r", firstChildId: "cp", lastChildId: "cp" }),
        buildBlock({ id: "cp", type: "paragraph", parentId: "c", inlineContent: inlineContent([text("item"), embed("fn-anchor", { contentBlockId: "fn" })]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "tbl", inlineContent: inlineContent([text("world")]) }),
      ],
      embedContents: [buildBlock({ id: "fn", type: "fn-body", inlineContent: inlineContent([text("F")]) })],
    });
    const result = deleteRange(document, createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3)));
    expect(flowShape(result.document, "doc")).toBe('p2:"held"');
    expect(getBlock(result.document, "tbl" as BlockId)).toBeNull();
    expect(getBlock(result.document, "cp" as BlockId)).toBeNull();
    expect(getEmbedContent(result.document, "fn" as BlockId)).toBeNull();
  });

  it("normalizes a reverse-order cross-block span before deleting", () => {
    const result = deleteRange(flow(["p1", "hello"], ["p2", " world"]), createSpan(createPosition("p2" as BlockId, 3), createPosition("p1" as BlockId, 2)));
    expect(flowShape(result.document, "doc")).toBe('p2:"herld"');
  });

  it("a middle pair rewires the previous sibling onto the survivor; the parent's ends are unchanged", () => {
    const document = flow(["p0", "zero"], ["p1", "hello"], ["p2", "world"], ["p3", "end"]);
    const F = fin(document);
    const result = deleteRange(document, createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 2)));
    expect(flowShape(result.document, "doc")).toBe('p0:"zero" p2:"herld" p3:"end"');
    expect(getBlock(result.document, "p0" as BlockId)?.nextSiblingId).toBe("p2");
    expect(getBlock(result.document, "p3" as BlockId)?.prevSiblingId).toBe("p2");
    expect(getBlock(result.document, F)?.firstChildId).toBe("p0");
    expect(getBlock(result.document, F)?.lastChildId).toBe("p3");
  });

  it("deleting both blocks' whole content leaves one empty paragraph (the focus)", () => {
    const result = deleteRange(flow(["p1", "a"], ["p2", "b"]), createSpan(createPosition("p1" as BlockId, 0), createPosition("p2" as BlockId, 1)));
    expect(flowShape(result.document, "doc")).toBe('p2:""');
  });

  it("inside an explicit section: the section's first child becomes the survivor", () => {
    const document = buildFlowDoc([{ sec: "section", children: [{ p: "p1", t: "hello" }, { p: "p2", t: "world" }] }]);
    const result = deleteRange(document, createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 2)));
    expect(getBlock(result.document, "section" as BlockId)?.firstChildId).toBe("p2");
    expect(getBlock(result.document, "section" as BlockId)?.lastChildId).toBe("p2");
    expect(getBlock(result.document, "doc" as BlockId)?.firstChildId).toBe("section");
  });
});

describe("deleteRange — formatting of the survivor (the span's first paragraph → the survivor; Google Docs / Quill)", () => {
  it("the anchor keeps content: its type + attrs are written onto the surviving focus", () => {
    const document = buildFlowDoc([{ p: "p", t: "hello" }, { p: "h", t: " world", type: "heading", attrs: { level: 2 } }]);
    const result = deleteRange(document, createSpan(createPosition("p" as BlockId, 2), createPosition("h" as BlockId, 2)));
    expect(getBlock(result.document, "h" as BlockId)?.type).toBe("paragraph");
    expect(getBlock(result.document, "h" as BlockId)?.attrs).toEqual({});
  });

  it("an anchor left EMPTY still wins unless it is a default paragraph", () => {
    const document = buildFlowDoc([{ p: "li1", t: "a", type: "list-item", attrs: { level: 2 } }, { p: "li2", t: "b", type: "list-item", attrs: { level: 3 } }]);
    const result = deleteRange(document, createSpan(createPosition("li1" as BlockId, 0), createPosition("li2" as BlockId, 1)));
    expect(getBlock(result.document, "li2" as BlockId)?.attrs).toEqual({ level: 2 });
    const plain = buildFlowDoc([{ p: "a", t: "x" }, { p: "h", t: "yz", type: "heading", attrs: { level: 1 } }]);
    const r2 = deleteRange(plain, createSpan(createPosition("a" as BlockId, 0), createPosition("h" as BlockId, 1)));
    expect(getBlock(r2.document, "h" as BlockId)?.type).toBe("heading");
    expect(getBlock(r2.document, "h" as BlockId)?.attrs).toEqual({ level: 1 });
  });

  it("preserves embed-referenced content blocks carried by the surviving focus suffix", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("see")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([embed("footnote-anchor", { contentBlockId: "fn-body" })]) }),
      ],
      embedContents: [buildBlock({ id: "fn-body", type: "footnote-body", inlineContent: inlineContent([text("footnote text")]) })],
    });
    const result = deleteRange(document, createSpan(createPosition("p1" as BlockId, 0), createPosition("p2" as BlockId, 0)));
    expect(getEmbedContent(result.document, "fn-body" as BlockId)).not.toBeNull();
    expect(getBlock(result.document, "p2" as BlockId)?.inlineContent?.items).toMatchObject([{ kind: "embed", embedType: "footnote-anchor", properties: { contentBlockId: "fn-body" } }]);
  });

  it("does not mutate the original state", () => {
    const document = buildFlowDoc([{ p: "p1", t: "hello" }, { p: "p2", t: " world" }]);
    const before = getBlock(document, "p1" as BlockId);
    const result = deleteRange(document, createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3)));
    expect(result.document).not.toBe(document);
    expect(getBlock(document, "p1" as BlockId)).toBe(before);
    expect(before?.nextSiblingId).toBe("p2");
  });
});

describe("deleteRange — cascade-delete embed-content references in the DELETED portion", () => {
  it("same-block: deleting a span that covers an embed cascade-deletes its fn-body", () => {
    // p[text("a"), embed("fn-anchor", { contentBlockId: "fn-body" }), text("b")]
    // Delete [1, 2) — drops the embed; fn-body must be removed from embedContents.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("a"),
            embed("fn-anchor", { contentBlockId: "fn-body" }),
            text("b"),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fn-body", type: "fn-body", inlineContent: inlineContent([text("note")]) }),
      ],
    });
    expect(getEmbedContent(document, "fn-body" as BlockId)).not.toBeNull();

    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 2));
    const result = deleteRange(document, span);

    expect(getEmbedContent(result.document, "fn-body" as BlockId)).toBeNull();
    expect(result.dirtyIds.has("fn-body" as BlockId)).toBe(true);
  });

  it("same-block: recursively cascade-deletes nested embed-content (footnote in footnote)", () => {
    // p[embed("fn-anchor", { contentBlockId: "outer" })]
    // outer body contains another embed → "inner"
    // Delete the whole inline content → both outer and inner must cascade.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([embed("fn-anchor", { contentBlockId: "outer" })]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "outer",
          type: "fn-body",
          inlineContent: inlineContent([embed("fn-anchor", { contentBlockId: "inner" })]),
        }),
        buildBlock({
          id: "inner",
          type: "fn-body",
          inlineContent: inlineContent([text("deep")]),
        }),
      ],
    });

    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 1));
    const result = deleteRange(document, span);

    expect(getEmbedContent(result.document, "outer" as BlockId)).toBeNull();
    expect(getEmbedContent(result.document, "inner" as BlockId)).toBeNull();
    expect(result.dirtyIds.has("outer" as BlockId)).toBe(true);
    expect(result.dirtyIds.has("inner" as BlockId)).toBe(true);
  });

  it("cross-block: cascade-deletes embeds in anchor suffix, intervening leaves, and focus prefix", () => {
    // doc > [p1[text("x"), embed("fn-anchor", { contentBlockId: "fn-a" })],
    //        p2[embed("fn-anchor", { contentBlockId: "fn-b" })],
    //        p3[embed("fn-anchor", { contentBlockId: "fn-c" }), text("y")]]
    // Delete span p1@1 → p3@1. The deleted portion is:
    //   - anchor (p1) suffix items[1..] → embed referencing fn-a
    //   - intervening (p2) all items → embed referencing fn-b
    //   - focus (p3) prefix items[..1] → embed referencing fn-c
    // The transferred suffix from focus is items[1..] → text("y").
    // All three referenced fn-bodies must be removed.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p2",
          inlineContent: inlineContent([
            text("x"),
            embed("fn-anchor", { contentBlockId: "fn-a" }),
          ]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          nextSiblingId: "p3",
          inlineContent: inlineContent([embed("fn-anchor", { contentBlockId: "fn-b" })]),
        }),
        buildBlock({
          id: "p3",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p2",
          inlineContent: inlineContent([
            embed("fn-anchor", { contentBlockId: "fn-c" }),
            text("y"),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fn-a", type: "fn-body", inlineContent: inlineContent([text("A")]) }),
        buildBlock({ id: "fn-b", type: "fn-body", inlineContent: inlineContent([text("B")]) }),
        buildBlock({ id: "fn-c", type: "fn-body", inlineContent: inlineContent([text("C")]) }),
      ],
    });

    const span = createSpan(createPosition("p1" as BlockId, 1), createPosition("p3" as BlockId, 1));
    const result = deleteRange(document, span);

    expect(getEmbedContent(result.document, "fn-a" as BlockId)).toBeNull();
    expect(getEmbedContent(result.document, "fn-b" as BlockId)).toBeNull();
    expect(getEmbedContent(result.document, "fn-c" as BlockId)).toBeNull();
    expect(result.dirtyIds.has("fn-a" as BlockId)).toBe(true);
    expect(result.dirtyIds.has("fn-b" as BlockId)).toBe(true);
    expect(result.dirtyIds.has("fn-c" as BlockId)).toBe(true);
  });

  it("cross-block: preserves embed in transferred focus suffix; cascade-deletes embed in deleted focus prefix", () => {
    // doc > [p1[text("x")],
    //        p2[embed("fn-anchor", { contentBlockId: "drop" }),
    //           embed("fn-anchor", { contentBlockId: "keep" })]]
    // Delete p1@1 → p2@1. Deleted = "" from p1 suffix (empty) +
    //   p2 prefix items[..1] = embed referencing "drop".
    // Transferred suffix from p2 = items[1..] = embed referencing "keep".
    // Result: "drop" must be cascade-deleted, "keep" must NOT.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p2",
          inlineContent: inlineContent([text("x")]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          inlineContent: inlineContent([
            embed("fn-anchor", { contentBlockId: "drop" }),
            embed("fn-anchor", { contentBlockId: "keep" }),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "drop", type: "fn-body", inlineContent: inlineContent([text("drop")]) }),
        buildBlock({ id: "keep", type: "fn-body", inlineContent: inlineContent([text("keep")]) }),
      ],
    });

    const span = createSpan(createPosition("p1" as BlockId, 1), createPosition("p2" as BlockId, 1));
    const result = deleteRange(document, span);

    expect(getEmbedContent(result.document, "drop" as BlockId)).toBeNull();
    expect(getEmbedContent(result.document, "keep" as BlockId)).not.toBeNull();
    expect(result.dirtyIds.has("drop" as BlockId)).toBe(true);
  });
});

describe("deleteRange — edge offsets and special cases", () => {
  it("collapsed span (anchor === focus) is a no-op (returns same state, empty dirtyIds)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 2);
    const result = deleteRange(document, createSpan(pos, pos));
    expect(result.document).toBe(document);
    expect([...result.dirtyIds]).toEqual([]);
  });

  it("same-block delete with anchor.offset === 0 (delete from start)", () => {
    // [text("hello")] — delete [0, 3) — keeps "lo".
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const result = deleteRange(document, createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3)));
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "lo" });
  });

  it("same-block delete with focus.offset === inlineContentLength (delete to end)", () => {
    // [text("hello")] — delete [2, 5) — keeps "he".
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const result = deleteRange(document, createSpan(createPosition("p" as BlockId, 2), createPosition("p" as BlockId, 5)));
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "he" });
  });

  it("same-block delete spanning [0, inlineContentLength] (delete entire block content)", () => {
    // [text("hello")] — delete [0, 5) — keeps nothing.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const result = deleteRange(document, createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5)));
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toEqual([]);
  });

  it("reverse-order span normalizes correctly (focus before anchor in doc order)", () => {
    // Delete from p@7 to p@3 — same as [3, 7) after normalization.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello world")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 7), createPosition("p" as BlockId, 3));
    const result = deleteRange(document, span);
    const items = getBlock(result.document, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "helorld" });
  });
});

describe("deleteRange — error cases", () => {
  it("throws when the anchor block does not exist (cross-block)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("missing" as BlockId, 0), createPosition("p" as BlockId, 1));
    expect(() => deleteRange(document, span)).toThrow(/anchor block ".+" not found/);
  });

  it("throws when the focus block does not exist (cross-block)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("missing" as BlockId, 1));
    expect(() => deleteRange(document, span)).toThrow(/focus block ".+" not found/);
  });

  it("throws when the same-block target does not exist", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("missing" as BlockId, 0), createPosition("missing" as BlockId, 1));
    // Same blockId on both endpoints → same-block branch → throws "block not found"
    expect(() => deleteRange(document, span)).toThrow(/block ".+" not found/);
  });

  it("throws when an endpoint references a container block (firstChildId set)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "p" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", nextSiblingId: "p", firstChildId: "inner", lastChildId: "inner" }),
        buildBlock({ id: "inner", type: "paragraph", parentId: "s", inlineContent: inlineContent([text("inside")]) }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "s", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("s" as BlockId, 0), createPosition("p" as BlockId, 1));
    expect(() => deleteRange(document, span)).toThrow(/anchor block ".+" is a container/);
  });

  it("throws when an endpoint has null inlineContent (independent of firstChildId)", () => {
    // Pin the inlineContent === null arm of the container guard.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "p" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", nextSiblingId: "p" }), // null inlineContent AND null firstChildId
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "s", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("s" as BlockId, 0), createPosition("p" as BlockId, 1));
    expect(() => deleteRange(document, span)).toThrow(/anchor block ".+" is a container/);
  });

  it("throws when the focus block is a container (firstChildId set)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "s" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "s", inlineContent: inlineContent([text("hi")]) }),
        buildBlock({ id: "s", type: "section", parentId: "doc", prevSiblingId: "p", firstChildId: "inner", lastChildId: "inner" }),
        buildBlock({ id: "inner", type: "paragraph", parentId: "s", inlineContent: inlineContent([text("inside")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("s" as BlockId, 1));
    expect(() => deleteRange(document, span)).toThrow(/focus block ".+" is a container/);
  });

  it("an OBJECT focus covers its whole block at offset 0 (removed, no join); any other offset is out of range", () => {
    const state = (): Document => buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "q" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "s", inlineContent: inlineContent([text("hi")]) }),
        buildBlock({ id: "s", type: "horizontal-line", parentId: "doc", prevSiblingId: "p", nextSiblingId: "q" }),
        buildBlock({ id: "q", type: "paragraph", parentId: "doc", prevSiblingId: "s", inlineContent: inlineContent([text("yo")]) }),
      ],
    });
    expect(() => deleteRange(state(), createSpan(createPosition("p" as BlockId, 0), createPosition("s" as BlockId, 1)))).toThrow(/focus offset 1 out of range/);
    const result = deleteRange(state(), createSpan(createPosition("p" as BlockId, 1), createPosition("s" as BlockId, 0)));
    expect(flowShape(result.document, "doc")).toBe('p:"h" q:"yo"');
  });

  it("throws when the cross-block span has different parents (cross-parent not supported)", () => {
    // doc > [section1[p_a], section2[p_b]] — span across sections.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section1", lastChildId: "section2" }),
        buildBlock({ id: "section1", type: "section", parentId: "doc", nextSiblingId: "section2", firstChildId: "p_a", lastChildId: "p_a" }),
        buildBlock({ id: "p_a", type: "paragraph", parentId: "section1", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "section2", type: "section", parentId: "doc", prevSiblingId: "section1", firstChildId: "p_b", lastChildId: "p_b" }),
        buildBlock({ id: "p_b", type: "paragraph", parentId: "section2", inlineContent: inlineContent([text("b")]) }),
      ],
    });
    const span = createSpan(createPosition("p_a" as BlockId, 0), createPosition("p_b" as BlockId, 1));
    expect(() => deleteRange(document, span)).toThrow(/cross-parent spans are not supported/);
  });

  it("throws when the cross-block span endpoints are in different selection contexts", () => {
    // p in doc; fn lives in embedContents (separate tree). A span crossing trees
    // (main → embedContents) must be refused — a single resolved `kind` can only
    // cover one tree. Since C.2c T7c, deleteRange's pre-normalize existence guard
    // resolves the focus across ALL three trees (so a legitimate header/footer-body
    // span passes); `fn` is therefore FOUND in embedContents, and the cross-tree
    // refusal now surfaces at `comparePositions`' "no common ancestor" check during
    // normalization. (Before T7c the same intent was caught earlier by the
    // getBlock-only existence guard's "focus block not found"; both errors express
    // the same invariant — refuse cross-tree spans — only the guard site differs.)
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
      embedContents: [
        buildBlock({ id: "fn", type: "footnote-body", firstChildId: "fnp", lastChildId: "fnp" }),
        buildBlock({ id: "fnp", type: "paragraph", parentId: "fn", inlineContent: inlineContent([text("footnote")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("fnp" as BlockId, 1));
    expect(() => deleteRange(document, span)).toThrow(/have no common ancestor/);
  });

  it("throws when anchor offset is negative (same-block)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, -1), createPosition("p" as BlockId, 1));
    expect(() => deleteRange(document, span)).toThrow(/out of range/);
  });

  it("throws when focus offset exceeds inlineContentLength (same-block)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 999));
    expect(() => deleteRange(document, span)).toThrow(/out of range/);
  });

  it("throws when anchor offset exceeds inlineContentLength (cross-block)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hi")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 999), createPosition("p2" as BlockId, 1));
    expect(() => deleteRange(document, span)).toThrow(/out of range/);
  });
});

describe("deleteRangeInTx — transaction guard", () => {
  it("throws when called outside any Y.Doc transaction", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello")]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5));
    const plan = planDeleteRange(document, span);
    expect(plan).not.toBeNull();
    if (plan === null) return;
    expect(() => deleteRangeInTx(document[DOCUMENT_INTERNAL].doc, plan)).toThrow(
      /deleteRange: must be called inside Y\.Doc\.transact/,
    );
  });
});

describe("deleteRange — cross-block focus inside a surrogate pair", () => {
  it("snaps the focus OUT once: the moved suffix starts after the whole cluster", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "b1", lastChildId: "b2" }),
        buildBlock({ id: "b1", type: "paragraph", parentId: "doc", nextSiblingId: "b2", inlineContent: inlineContent([text("ab")]) }),
        buildBlock({ id: "b2", type: "paragraph", parentId: "doc", prevSiblingId: "b1", inlineContent: inlineContent([text("😀cd")]) }),
      ],
    });
    const span = createSpan(createPosition("b1" as BlockId, 1), createPosition("b2" as BlockId, 1));
    const result = deleteRange(document, span);
    expect(getBlock(result.document, "b2" as BlockId)?.inlineContent?.items).toMatchObject([{ text: "acd" }]);
  });
});
