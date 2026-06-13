import { describe, it, expect } from "vitest";
import { deleteRange, deleteRangeInTx, planDeleteRange } from "./delete-range";
import { getBlock, getEmbedContent } from "../state";
import { STATE_INTERNAL } from "../state-internal";
import { buildBlock, buildState, text, embed, inlineContent } from "../../test-utils/state-builders";
import { createPosition, createSpan } from "../block-position";
import type { BlockId } from "../block-id";

describe("deleteRange — basic same-block range delete", () => {
  // doc > [p("hello world")]
  // Delete range [3, 7) — covers "lo w".
  // Expected: p("helorld")
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello world")]) }),
      ],
    });

  it("deletes the range from a single text item, keeping prefix and suffix", () => {
    const state = fixture();
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = deleteRange(state, span);

    const block = getBlock(result.state, "p" as BlockId);
    expect(block?.inlineContent?.items).toHaveLength(1);
    expect(block?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "helorld" });

    // dirtyIds: only the modified block.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p"]));
  });
});

describe("deleteRange — same-block: item shapes and edges", () => {
  it("deletes a range that exactly covers a text item (clean removal at boundary)", () => {
    // [text("hello"), text(" world")] — delete [0, 5) — drops "hello", keeps " world".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello"), text(" world")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5));
    const result = deleteRange(state, span);
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: " world" });
  });

  it("deletes a range that spans multiple text items, splitting both endpoints", () => {
    // [text("ab"), text("cd"), text("ef")] — delete [1, 5) — keeps "a" + "f".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("ab"), text("cd"), text("ef")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 5));
    const result = deleteRange(state, span);
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    // After run-merging: text("a") and text("f") have same attrs ({}), so they merge.
    expect(items?.[0]).toMatchObject({ text: "af", attrs: {} });
  });

  it("deletes an embed item in the range", () => {
    // [text("a"), embed("img"), text("b")] — delete [1, 2) — drops the embed.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("a"), embed("img"), text("b")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 2));
    const result = deleteRange(state, span);
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "ab" }); // run-merged at the seam
  });

  it("preserves attrs on both halves when splitting a styled item mid-text", () => {
    // [text("hello world", { bold: true })] — delete [3, 7) drops "lo w" (4 chars)
    // and leaves "hel" + "orld" → run-merged to text("helorld", {bold:true}).
    // Pins the attrs-preservation contract on both prefix and suffix sides.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello world", { bold: true })]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = deleteRange(state, span);
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "helorld", attrs: { bold: true } });
  });

  it("does NOT merge text across an embed at the seam", () => {
    // [text("a", {bold}), embed("img"), text("X"), text("b", {bold})]
    // Delete [2, 3) — drops text("X").
    // Result: [text("a", {bold}), embed, text("b", {bold})] — embed at seam,
    // text("a") and text("b") have same attrs but separated by embed → no merge.
    const state = buildState({
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
    const result = deleteRange(state, span);
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "img" });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b", attrs: { bold: true } });
  });
});

describe("deleteRange — cross-block (same-parent)", () => {
  it("merges anchor prefix with focus suffix when blocks are adjacent siblings (no intervening)", () => {
    // doc > [p1("hello"), p2(" world")]
    // Delete from p1@2 to p2@3 — keep "he" of p1 + "rld" of p2.
    // Expected: doc > [p1("herld")] — p2 deleted.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text(" world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3));
    const result = deleteRange(state, span);

    const p1 = getBlock(result.state, "p1" as BlockId);
    expect(p1?.inlineContent?.items).toHaveLength(1);
    expect(p1?.inlineContent?.items[0]).toMatchObject({ text: "herld" });
    expect(p1?.nextSiblingId).toBeNull(); // p2 deleted; p2 had no nextSibling
    expect((getBlock(result.state, "p2" as BlockId) !== null)).toBe(false);

    const parent = getBlock(result.state, "doc" as BlockId);
    expect(parent?.lastChildId).toBe("p1"); // rewired from p2

    // dirtyIds: { p1, p2, doc } — p2 was last child so doc.lastChildId changed.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "doc"]));
  });

  it("deletes intervening leaves between anchor and focus", () => {
    // doc > [p1("hello"), p2("middle"), p3("world")]
    // Delete from p1@2 to p3@2 — anchor=p1, focus=p3, intervening=[p2].
    // Result: p1 keeps "he" + p3's "rld" = "herld"; p2 and p3 deleted.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("middle")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([text("world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p3" as BlockId, 2));
    const result = deleteRange(state, span);

    const p1 = getBlock(result.state, "p1" as BlockId);
    expect(p1?.inlineContent?.items).toHaveLength(1);
    expect(p1?.inlineContent?.items[0]).toMatchObject({ text: "herld" });
    expect(p1?.nextSiblingId).toBeNull();

    expect((getBlock(result.state, "p2" as BlockId) !== null)).toBe(false);
    expect((getBlock(result.state, "p3" as BlockId) !== null)).toBe(false);

    const parent = getBlock(result.state, "doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1");
    expect(parent?.lastChildId).toBe("p1");

    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "p3", "doc"]));
  });

  it("refuses a cross-block span whose intervening sibling is a CONTAINER (S-E6)", () => {
    // doc > [p1, tbl(container with a child), p2]. A span p1→p2 crosses
    // `tbl`; flat-deleting it would orphan `li`. deleteRange must refuse.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "tbl", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "tbl", type: "table", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p2", firstChildId: "li", lastChildId: "li" }),
        buildBlock({ id: "li", type: "list-item", parentId: "tbl", inlineContent: inlineContent([text("item")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "tbl", inlineContent: inlineContent([text("world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3));
    expect(() => deleteRange(state, span)).toThrow(
      /intervening sibling "tbl" is a container/,
    );
    // The doc is untouched (the throw happens during planning, pre-mutation).
    expect(getBlock(state, "li" as BlockId)?.type).toBe("list-item");
  });

  it("normalizes a reverse-order cross-block span before deleting (S-E6 cross-path)", () => {
    // doc > [p1("hello"), p2(" world")]. Span given REVERSED (anchor after
    // focus in doc order). normalizeSpan must reorder it to p1@2..p2@3, so the
    // result matches the forward span: p1 = "herld", p2 deleted.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text(" world")]) }),
      ],
    });
    const reversed = createSpan(
      createPosition("p2" as BlockId, 3),
      createPosition("p1" as BlockId, 2),
    );
    const result = deleteRange(state, reversed);
    const p1 = getBlock(result.state, "p1" as BlockId);
    expect(p1?.inlineContent?.items[0]).toMatchObject({ text: "herld" });
    expect(getBlock(result.state, "p2" as BlockId)).toBeNull();
  });

  it("middle pair (anchor not first, focus not last): parent unchanged", () => {
    // doc > [p0, p1, p2, p3] — delete from p1@2 to p2@2.
    // Expected: p0 unchanged, p1 absorbs p2 tail, p2 deleted, p3.prevSibling rewires.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: "p3" }),
        buildBlock({ id: "p0", type: "paragraph", parentId: "doc", nextSiblingId: "p1", inlineContent: inlineContent([text("zero")]) }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", prevSiblingId: "p0", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("world")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([text("end")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 2));
    const result = deleteRange(state, span);

    expect(getBlock(result.state, "p0" as BlockId)?.nextSiblingId).toBe("p1"); // unchanged
    expect(getBlock(result.state, "p1" as BlockId)?.nextSiblingId).toBe("p3"); // rewired
    expect(getBlock(result.state, "p3" as BlockId)?.prevSiblingId).toBe("p1"); // rewired
    expect((getBlock(result.state, "p2" as BlockId) !== null)).toBe(false);

    const parent = getBlock(result.state, "doc" as BlockId);
    expect(parent?.firstChildId).toBe("p0"); // unchanged
    expect(parent?.lastChildId).toBe("p3"); // unchanged

    // dirtyIds: { p1, p2, p3 } — parent NOT dirty.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "p3"]));
  });

  it("anchor is first child, focus is last child (full-children-coverage)", () => {
    // doc > [p1, p2] — delete from p1@0 to p2@end (full content of both blocks deleted).
    // Result: p1 has empty inlineContent (anchor.prefix=[] + focus.suffix=[] = []),
    //   p2 deleted, parent.lastChildId rewires to p1.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("b")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p2" as BlockId, 1));
    const result = deleteRange(state, span);

    const p1 = getBlock(result.state, "p1" as BlockId);
    expect(p1?.inlineContent?.items).toEqual([]);
    expect(p1?.nextSiblingId).toBeNull();

    expect((getBlock(result.state, "p2" as BlockId) !== null)).toBe(false);

    const parent = getBlock(result.state, "doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1");
    expect(parent?.lastChildId).toBe("p1");

    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "doc"]));
  });

  it("nested: anchor and focus inside a section container; section's lastChildId rewires", () => {
    // doc > section > [p1, p2] — delete from p1@2 to p2@2.
    // After: section has [p1] with merged content; doc untouched.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "section", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", prevSiblingId: "p1", inlineContent: inlineContent([text("world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 2));
    const result = deleteRange(state, span);

    const section = getBlock(result.state, "section" as BlockId);
    expect(section?.firstChildId).toBe("p1");
    expect(section?.lastChildId).toBe("p1"); // rewired from p2

    const doc = getBlock(result.state, "doc" as BlockId);
    expect(doc?.firstChildId).toBe("section");
    expect(doc?.lastChildId).toBe("section");

    expect((getBlock(result.state, "p2" as BlockId) !== null)).toBe(false);

    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "section"]));
  });
});

describe("deleteRange — block-level invariants", () => {
  it("anchor wins type when blocks have different types (cross-block)", () => {
    // doc > [p (paragraph), h (heading)] — delete from p@2 to h@2.
    // Result: anchor block keeps its "paragraph" type.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "h" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "h", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "h", type: "heading", parentId: "doc", prevSiblingId: "p", inlineContent: inlineContent([text(" world")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 2), createPosition("h" as BlockId, 2));
    const result = deleteRange(state, span);
    expect(getBlock(result.state, "p" as BlockId)?.type).toBe("paragraph");
  });

  it("anchor wins attrs when blocks have different attrs (cross-block)", () => {
    // doc > [li1 { level: 2 }, li2 { level: 3 }] — delete cross-block.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li1", lastChildId: "li2" }),
        buildBlock({ id: "li1", type: "list-item", attrs: { level: 2 }, parentId: "doc", nextSiblingId: "li2", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "li2", type: "list-item", attrs: { level: 3 }, parentId: "doc", prevSiblingId: "li1", inlineContent: inlineContent([text("b")]) }),
      ],
    });
    const span = createSpan(createPosition("li1" as BlockId, 0), createPosition("li2" as BlockId, 1));
    const result = deleteRange(state, span);
    expect(getBlock(result.state, "li1" as BlockId)?.attrs).toEqual({ level: 2 });
  });

  it("preserves embed-referenced content blocks (no cascade-delete on focus's content)", () => {
    // doc > [p1[], p2[embed("footnote", { contentBlockId: "fn-body" })]] + fn-body in embedContents.
    // Delete from p1@0 to p2@0 — focus's items[0..) keeps the embed; merged into p1.
    // Result: fn-body must still exist in embedContents.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("see")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([embed("footnote-anchor", { contentBlockId: "fn-body" })]) }),
      ],
      embedContents: [
        buildBlock({ id: "fn-body", type: "footnote-body", inlineContent: inlineContent([text("footnote text")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p2" as BlockId, 0));
    const result = deleteRange(state, span);
    expect(getEmbedContent(result.state, "fn-body" as BlockId)).not.toBeNull();
    // p1 absorbed p2's content (embed) since focus.offset=0 → focus.suffix is full focus content.
    const items = getBlock(result.state, "p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "embed", embedType: "footnote-anchor", properties: { contentBlockId: "fn-body" } });
  });

  it("preserves structural sharing: blocks NOT touched by the operation retain object identity", () => {
    // doc > [p0, p1, p2, p3] — delete cross-block from p1@2 to p2@2.
    // p0 is untouched; p3 is touched (prevSiblingId rewires from p2 to p1).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: "p3" }),
        buildBlock({ id: "p0", type: "paragraph", parentId: "doc", nextSiblingId: "p1", inlineContent: inlineContent([text("zero")]) }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", prevSiblingId: "p0", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("world")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([text("end")]) }),
      ],
    });
    const beforeP0 = getBlock(state, "p0" as BlockId);
    const result = deleteRange(state, createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 2)));
    expect(getBlock(result.state, "p0" as BlockId)).toBe(beforeP0);
  });

  it("does not mutate the original state", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text(" world")]) }),
      ],
    });
    const result = deleteRange(state, createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3)));

    expect(result.state).not.toBe(state);
    // Original state still has p2.
    expect((getBlock(state, "p2" as BlockId) !== null)).toBe(true);
    expect(getBlock(state, "p1" as BlockId)?.nextSiblingId).toBe("p2");
  });
});

describe("deleteRange — cascade-delete embed-content references in the DELETED portion", () => {
  it("same-block: deleting a span that covers an embed cascade-deletes its fn-body", () => {
    // p[text("a"), embed("fn-anchor", { contentBlockId: "fn-body" }), text("b")]
    // Delete [1, 2) — drops the embed; fn-body must be removed from embedContents.
    const state = buildState({
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
    expect(getEmbedContent(state, "fn-body" as BlockId)).not.toBeNull();

    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 2));
    const result = deleteRange(state, span);

    expect(getEmbedContent(result.state, "fn-body" as BlockId)).toBeNull();
    expect(result.dirtyIds.has("fn-body" as BlockId)).toBe(true);
  });

  it("same-block: recursively cascade-deletes nested embed-content (footnote in footnote)", () => {
    // p[embed("fn-anchor", { contentBlockId: "outer" })]
    // outer body contains another embed → "inner"
    // Delete the whole inline content → both outer and inner must cascade.
    const state = buildState({
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
    const result = deleteRange(state, span);

    expect(getEmbedContent(result.state, "outer" as BlockId)).toBeNull();
    expect(getEmbedContent(result.state, "inner" as BlockId)).toBeNull();
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
    const state = buildState({
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
    const result = deleteRange(state, span);

    expect(getEmbedContent(result.state, "fn-a" as BlockId)).toBeNull();
    expect(getEmbedContent(result.state, "fn-b" as BlockId)).toBeNull();
    expect(getEmbedContent(result.state, "fn-c" as BlockId)).toBeNull();
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
    const state = buildState({
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
    const result = deleteRange(state, span);

    expect(getEmbedContent(result.state, "drop" as BlockId)).toBeNull();
    expect(getEmbedContent(result.state, "keep" as BlockId)).not.toBeNull();
    expect(result.dirtyIds.has("drop" as BlockId)).toBe(true);
  });
});

describe("deleteRange — edge offsets and special cases", () => {
  it("collapsed span (anchor === focus) is a no-op (returns same state, empty dirtyIds)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 2);
    const result = deleteRange(state, createSpan(pos, pos));
    expect(result.state).toBe(state);
    expect([...result.dirtyIds]).toEqual([]);
  });

  it("same-block delete with anchor.offset === 0 (delete from start)", () => {
    // [text("hello")] — delete [0, 3) — keeps "lo".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const result = deleteRange(state, createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3)));
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "lo" });
  });

  it("same-block delete with focus.offset === inlineContentLength (delete to end)", () => {
    // [text("hello")] — delete [2, 5) — keeps "he".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const result = deleteRange(state, createSpan(createPosition("p" as BlockId, 2), createPosition("p" as BlockId, 5)));
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "he" });
  });

  it("same-block delete spanning [0, inlineContentLength] (delete entire block content)", () => {
    // [text("hello")] — delete [0, 5) — keeps nothing.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const result = deleteRange(state, createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5)));
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toEqual([]);
  });

  it("reverse-order span normalizes correctly (focus before anchor in doc order)", () => {
    // Delete from p@7 to p@3 — same as [3, 7) after normalization.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello world")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 7), createPosition("p" as BlockId, 3));
    const result = deleteRange(state, span);
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "helorld" });
  });
});

describe("deleteRange — error cases", () => {
  it("throws when the anchor block does not exist (cross-block)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("missing" as BlockId, 0), createPosition("p" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/anchor block ".+" not found/);
  });

  it("throws when the focus block does not exist (cross-block)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("missing" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/focus block ".+" not found/);
  });

  it("throws when the same-block target does not exist", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("missing" as BlockId, 0), createPosition("missing" as BlockId, 1));
    // Same blockId on both endpoints → same-block branch → throws "block not found"
    expect(() => deleteRange(state, span)).toThrow(/block ".+" not found/);
  });

  it("throws when an endpoint references a container block (firstChildId set)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "p" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", nextSiblingId: "p", firstChildId: "inner", lastChildId: "inner" }),
        buildBlock({ id: "inner", type: "paragraph", parentId: "s", inlineContent: inlineContent([text("inside")]) }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "s", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("s" as BlockId, 0), createPosition("p" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/anchor block ".+" is a container/);
  });

  it("throws when an endpoint has null inlineContent (independent of firstChildId)", () => {
    // Pin the inlineContent === null arm of the container guard.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "p" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", nextSiblingId: "p" }), // null inlineContent AND null firstChildId
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "s", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("s" as BlockId, 0), createPosition("p" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/anchor block ".+" is a container/);
  });

  it("throws when the focus block is a container (firstChildId set)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "s" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "s", inlineContent: inlineContent([text("hi")]) }),
        buildBlock({ id: "s", type: "section", parentId: "doc", prevSiblingId: "p", firstChildId: "inner", lastChildId: "inner" }),
        buildBlock({ id: "inner", type: "paragraph", parentId: "s", inlineContent: inlineContent([text("inside")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("s" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/focus block ".+" is a container/);
  });

  it("throws when the focus block has null inlineContent (independent of firstChildId)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "s" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "s", inlineContent: inlineContent([text("hi")]) }),
        buildBlock({ id: "s", type: "section", parentId: "doc", prevSiblingId: "p" }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("s" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/focus block ".+" is a container/);
  });

  it("throws when the cross-block span has different parents (cross-parent not supported)", () => {
    // doc > [section1[p_a], section2[p_b]] — span across sections.
    const state = buildState({
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
    expect(() => deleteRange(state, span)).toThrow(/cross-parent spans are not supported/);
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
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
      embedContents: [
        buildBlock({ id: "fn", type: "footnote-body", inlineContent: inlineContent([text("footnote")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("fn" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/have no common ancestor/);
  });

  it("throws when anchor offset is negative (same-block)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, -1), createPosition("p" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/out of range/);
  });

  it("throws when focus offset exceeds inlineContentLength (same-block)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 999));
    expect(() => deleteRange(state, span)).toThrow(/out of range/);
  });

  it("throws when anchor offset exceeds inlineContentLength (cross-block)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hi")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 999), createPosition("p2" as BlockId, 1));
    expect(() => deleteRange(state, span)).toThrow(/out of range/);
  });
});

describe("deleteRangeInTx — transaction guard", () => {
  it("throws when called outside any Y.Doc transaction", () => {
    const state = buildState({
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
    const plan = planDeleteRange(state, span);
    expect(plan).not.toBeNull();
    if (plan === null) return;
    expect(() => deleteRangeInTx(state[STATE_INTERNAL].doc, plan)).toThrow(
      /deleteRange: must be called inside Y\.Doc\.transact/,
    );
  });
});
