import { describe, it, expect } from "vitest";
import { mergeAdjacentBlocks } from "./merge-blocks";
import { getBlock, getEmbedContent } from "../state";
import { buildBlock, buildState, text, embed, inlineContent } from "../../test-utils/state-builders";
import type { BlockId } from "../block-id";

describe("mergeAdjacentBlocks — basic merge of two adjacent leaf siblings", () => {
  // doc > [p1("hello"), p2(" world")]
  // After merge: doc > [p1("hello world")] (run-merged into one item since both have empty attrs)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text(" world")]) }),
      ],
    });

  it("merges right into left, removes right, rewires the parent's lastChildId", () => {
    const state = fixture();
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);

    // Left (p1) keeps its id; inlineContent is the concatenation, run-merged into one item.
    const left = getBlock(result.state, "p1" as BlockId);
    expect(left).toBeDefined();
    expect(left?.id).toBe("p1");
    expect(left?.type).toBe("paragraph");
    expect(left?.parentId).toBe("doc");
    expect(left?.prevSiblingId).toBeNull();
    expect(left?.nextSiblingId).toBeNull(); // was "p2"; p2 had no nextSibling, so left.nextSiblingId is now null
    expect(left?.inlineContent?.items).toHaveLength(1);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello world", attrs: {} });

    // Right (p2) is removed from state.blocks.
    expect(getBlock(result.state, "p2" as BlockId)).toBeNull();

    // Parent's lastChildId is rewired to p1 (was p2). firstChildId still p1.
    const parent = getBlock(result.state, "doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1");
    expect(parent?.lastChildId).toBe("p1");

    // dirtyIds: { p1 (modified), p2 (removed), doc (lastChildId changed) }.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "doc"]));
  });
});

describe("mergeAdjacentBlocks — item shapes and run-merging across the seam", () => {
  it("merges left's last text item with right's first text item when they share attrs (run-merging)", () => {
    // doc > [p1[text("hel", {bold})], p2[text("lo", {bold})]]
    // After merge: p1.items = [text("hello", {bold})] (one item, run-merged across seam).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hel", { bold: true })]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("lo", { bold: true })]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = getBlock(result.state, "p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello", attrs: { bold: true } });
  });

  it("preserves both items at the seam when their attrs differ", () => {
    // doc > [p1[text("hel", {bold})], p2[text("lo", {italic})]]
    // After merge: p1.items = [text("hel", {bold}), text("lo", {italic})] (two items; no run-merge).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hel", { bold: true })]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("lo", { italic: true })]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = getBlock(result.state, "p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hel", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "lo", attrs: { italic: true } });
  });

  it("does NOT merge across an embed at the seam, even when text neighbors share attrs", () => {
    // doc > [p1[text("a", {bold}), embed("img")], p2[text("b", {bold})]]
    // The embed is a barrier — the text("a") on left and text("b") on right both have
    // {bold:true} attrs but they are separated by the embed, so no run-merge across.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("a", { bold: true }), embed("img")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("b", { bold: true })]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = getBlock(result.state, "p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "img" });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b", attrs: { bold: true } });
  });

  it("concatenates multi-item left + multi-item right with seam-merging only between the touching items", () => {
    // doc > [p1[text("a"), text("b", {bold})], p2[text("c", {bold}), text("d")]]
    // Concat: [text("a"), text("b", {bold}), text("c", {bold}), text("d")]
    // Run-merge: items[1] and items[2] both {bold} → merge to text("bc", {bold}).
    // Final: [text("a"), text("bc", {bold}), text("d")]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("a"), text("b", { bold: true })]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("c", { bold: true }), text("d")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = getBlock(result.state, "p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "bc", attrs: { bold: true } });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "d", attrs: {} });
  });
});

describe("mergeAdjacentBlocks — linked-list correctness across positional cases", () => {
  // doc > [p1, p2, p3, p4]
  const fourChildFixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p4" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("one")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("two")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", nextSiblingId: "p4", inlineContent: inlineContent([text("three")]) }),
        buildBlock({ id: "p4", type: "paragraph", parentId: "doc", prevSiblingId: "p3", inlineContent: inlineContent([text("four")]) }),
      ],
    });

  it("middle pair (p2 + p3): p2 keeps id; p4.prevSiblingId rewires to p2; parent unchanged", () => {
    const state = fourChildFixture();
    const result = mergeAdjacentBlocks(state, "p2" as BlockId, "p3" as BlockId);

    expect(getBlock(result.state, "p1" as BlockId)?.nextSiblingId).toBe("p2"); // unchanged
    expect(getBlock(result.state, "p2" as BlockId)?.prevSiblingId).toBe("p1");
    expect(getBlock(result.state, "p2" as BlockId)?.nextSiblingId).toBe("p4"); // was "p3"; now skips
    expect(getBlock(result.state, "p4" as BlockId)?.prevSiblingId).toBe("p2"); // was "p3"; rewired
    expect(getBlock(result.state, "p3" as BlockId)).toBeNull(); // removed

    const parent = getBlock(result.state, "doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1"); // unchanged
    expect(parent?.lastChildId).toBe("p4"); // unchanged

    // dirtyIds: p2 (modified), p3 (removed), p4 (prevSiblingId rewired). Parent NOT dirty.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p2", "p3", "p4"]));
  });

  it("first pair (p1 + p2): p1 keeps id; firstChildId stays p1; p3.prevSiblingId rewires to p1", () => {
    const state = fourChildFixture();
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);

    expect(getBlock(result.state, "p1" as BlockId)?.prevSiblingId).toBeNull(); // unchanged
    expect(getBlock(result.state, "p1" as BlockId)?.nextSiblingId).toBe("p3"); // was p2
    expect(getBlock(result.state, "p3" as BlockId)?.prevSiblingId).toBe("p1"); // was p2
    expect(getBlock(result.state, "p2" as BlockId)).toBeNull();

    const parent = getBlock(result.state, "doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1"); // unchanged (left wins, kept id)
    expect(parent?.lastChildId).toBe("p4"); // unchanged

    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "p3"]));
  });

  it("last pair (p3 + p4): p3 keeps id; parent's lastChildId rewires from p4 to p3", () => {
    const state = fourChildFixture();
    const result = mergeAdjacentBlocks(state, "p3" as BlockId, "p4" as BlockId);

    expect(getBlock(result.state, "p3" as BlockId)?.prevSiblingId).toBe("p2");
    expect(getBlock(result.state, "p3" as BlockId)?.nextSiblingId).toBeNull(); // was p4; now last child
    expect(getBlock(result.state, "p4" as BlockId)).toBeNull();

    const parent = getBlock(result.state, "doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1");
    expect(parent?.lastChildId).toBe("p3"); // rewired from p4

    // dirtyIds: p3 (modified), p4 (removed), doc (lastChildId rewired).
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p3", "p4", "doc"]));
  });

  it("nested-block pair: doc > section > [p1, p2] → merging uses the immediate container as parent", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "section", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", prevSiblingId: "p1", inlineContent: inlineContent([text(" world")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);

    // Section's lastChildId rewires; doc untouched.
    const section = getBlock(result.state, "section" as BlockId);
    expect(section?.firstChildId).toBe("p1");
    expect(section?.lastChildId).toBe("p1");

    const doc = getBlock(result.state, "doc" as BlockId);
    expect(doc?.firstChildId).toBe("section");
    expect(doc?.lastChildId).toBe("section");

    expect(getBlock(result.state, "p2" as BlockId)).toBeNull();

    // dirtyIds: p1, p2, section. doc NOT dirty.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "section"]));
  });
});

describe("mergeAdjacentBlocks — block-level invariants", () => {
  it("left wins type when blocks have different types", () => {
    // doc > [p (paragraph), h (heading)] → merge p + h → result keeps p's type "paragraph".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "h" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "h", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "h", type: "heading", parentId: "doc", prevSiblingId: "p", inlineContent: inlineContent([text(" world")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p" as BlockId, "h" as BlockId);
    expect(getBlock(result.state, "p" as BlockId)?.type).toBe("paragraph");
  });

  it("left wins attrs when blocks have different attrs", () => {
    // doc > [li1 { level: 2 }, li2 { level: 3 }] → result keeps { level: 2 }.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li1", lastChildId: "li2" }),
        buildBlock({ id: "li1", type: "list-item", attrs: { level: 2 }, parentId: "doc", nextSiblingId: "li2", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "li2", type: "list-item", attrs: { level: 3 }, parentId: "doc", prevSiblingId: "li1", inlineContent: inlineContent([text("b")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "li1" as BlockId, "li2" as BlockId);
    expect(getBlock(result.state, "li1" as BlockId)?.attrs).toEqual({ level: 2 });
  });

  it("preserves embed-referenced contents in right's inline content (no cascade-delete)", () => {
    // doc > [p1[], p2[embed("footnote", { contentBlockId: "fn-body" })]] + fn-body in embedContents.
    // Merging p1 + p2 must NOT delete fn-body — the embed reference is still alive in the merged content.
    // mergeAdjacentBlocks calls yBlocks.delete(right) directly (not removeBlock), so Task 5's
    // cascade-delete does not fire; fn-body in embedContents survives.
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
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    // fn-body must still exist in embedContents.
    expect(getEmbedContent(result.state, "fn-body" as BlockId)).not.toBeNull();
    // The merged inline content carries the embed reference.
    const items = getBlock(result.state, "p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "see" });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "footnote-anchor", properties: { contentBlockId: "fn-body" } });
  });

  it("preserves structural sharing: blocks NOT touched by the merge retain object identity", () => {
    // doc > [p0, p1, p2, p3] — merge p1 + p2; p0 and p3 untouched (p3 is touched: prev rewired).
    // Actually p3 IS touched (prevSiblingId rewires). So only p0 has untouched identity.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p0", lastChildId: "p3" }),
        buildBlock({ id: "p0", type: "paragraph", parentId: "doc", nextSiblingId: "p1", inlineContent: inlineContent([text("zero")]) }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", prevSiblingId: "p0", nextSiblingId: "p2", inlineContent: inlineContent([text("one")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("two")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([text("three")]) }),
      ],
    });
    const beforeP0 = getBlock(state, "p0" as BlockId);
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
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
    // Cache pre-op snapshots BEFORE the op so the pre-op State.snapshotCache
    // holds them. (Y.Doc itself is mutated in place; per-State view stability
    // comes from each State's cache, not from Y.Doc immutability.)
    const beforeP1 = getBlock(state, "p1" as BlockId);
    const beforeP2 = getBlock(state, "p2" as BlockId);
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);

    expect(result.state).not.toBe(state);
    // Original state still has p2 and p1's nextSibling pointing to p2.
    expect(getBlock(state, "p2" as BlockId)).toBe(beforeP2);
    expect(getBlock(state, "p1" as BlockId)).toBe(beforeP1);
    expect(getBlock(state, "p1" as BlockId)?.nextSiblingId).toBe("p2");
  });
});

describe("mergeAdjacentBlocks — empty-block edge cases", () => {
  it("left empty + right with content: result has right's content under left's id", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = getBlock(result.state, "p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello" });
    expect(getBlock(result.state, "p2" as BlockId)).toBeNull();
  });

  it("left with content + right empty: result has left's content unchanged", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = getBlock(result.state, "p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello" });
    expect(getBlock(result.state, "p2" as BlockId)).toBeNull();
  });

  it("both empty: result is one empty block under left's id", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = getBlock(result.state, "p1" as BlockId)?.inlineContent?.items;
    expect(items).toEqual([]);
    expect(getBlock(result.state, "p2" as BlockId)).toBeNull();
  });
});

describe("mergeAdjacentBlocks — error cases", () => {
  // Common fixture: two adjacent leaves under doc.
  const adjacentFixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("b")]) }),
      ],
    });

  it("throws when leftId === rightId (cannot merge a block with itself)", () => {
    const state = adjacentFixture();
    expect(() =>
      mergeAdjacentBlocks(state, "p1" as BlockId, "p1" as BlockId),
    ).toThrow(/same block/);
  });

  it("throws when the left block does not exist", () => {
    const state = adjacentFixture();
    expect(() =>
      mergeAdjacentBlocks(state, "missing" as BlockId, "p2" as BlockId),
    ).toThrow(/left block ".+" not found/);
  });

  it("throws when the right block does not exist", () => {
    const state = adjacentFixture();
    expect(() =>
      mergeAdjacentBlocks(state, "p1" as BlockId, "missing" as BlockId),
    ).toThrow(/right block ".+" not found/);
  });

  it("throws when the left block is a container (firstChildId set)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "p" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", nextSiblingId: "p", firstChildId: "inner", lastChildId: "inner" }),
        buildBlock({ id: "inner", type: "paragraph", parentId: "s", inlineContent: inlineContent([text("inside")]) }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "s", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "s" as BlockId, "p" as BlockId),
    ).toThrow(/left block ".+" is a container/);
  });

  it("throws when the left block has null inlineContent (independent of firstChildId)", () => {
    // Pin the inlineContent === null arm of the left container guard so a future
    // regression that drops it (|| → &&) is caught.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "p" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", nextSiblingId: "p" }), // null inlineContent AND null firstChildId
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "s", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "s" as BlockId, "p" as BlockId),
    ).toThrow(/left block ".+" is a container/);
  });

  it("throws when the right block is a container (firstChildId set)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "s" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "s", inlineContent: inlineContent([text("hi")]) }),
        buildBlock({ id: "s", type: "section", parentId: "doc", prevSiblingId: "p", firstChildId: "inner", lastChildId: "inner" }),
        buildBlock({ id: "inner", type: "paragraph", parentId: "s", inlineContent: inlineContent([text("inside")]) }),
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "p" as BlockId, "s" as BlockId),
    ).toThrow(/right block ".+" is a container/);
  });

  it("throws when the right block has null inlineContent (independent of firstChildId)", () => {
    // Pin the inlineContent === null arm of the right container guard.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "s" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "s", inlineContent: inlineContent([text("hi")]) }),
        buildBlock({ id: "s", type: "section", parentId: "doc", prevSiblingId: "p" }), // null inlineContent AND null firstChildId
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "p" as BlockId, "s" as BlockId),
    ).toThrow(/right block ".+" is a container/);
  });

  it("throws when blocks have different parents", () => {
    // doc > [section1[p_a], section2[p_b]] — p_a and p_b are leaves but parented under different sections.
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
    expect(() =>
      mergeAdjacentBlocks(state, "p_a" as BlockId, "p_b" as BlockId),
    ).toThrow(/different parents/);
  });

  it("throws when left.nextSiblingId !== rightId (non-adjacent — adjacency arm A)", () => {
    // doc > [p1, p2, p3] — try to merge p1 and p3 (skipping p2).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("b")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([text("c")]) }),
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "p1" as BlockId, "p3" as BlockId),
    ).toThrow(/not adjacent siblings/);
  });

  it("throws when right.prevSiblingId !== leftId (malformed adjacency — adjacency arm B)", () => {
    // doc > [p1, p2] — left.nextSiblingId === "p2" (correct) but right.prevSiblingId is fabricated as null
    // to simulate a malformed-state case where the bidirectional invariant is broken.
    // The guard's second arm catches this; pinning it prevents a future regression that drops the AND.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: null, inlineContent: inlineContent([text("b")]) }),
      ],
    });
    expect(() =>
      mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId),
    ).toThrow(/not adjacent siblings/);
  });
});
