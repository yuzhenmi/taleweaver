import { describe, it, expect } from "vitest";
import { mergeAdjacentBlocks } from "./merge-blocks";
import { buildBlock, buildState, text, embed } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import type { BlockId } from "./block-id";

describe("mergeAdjacentBlocks — basic merge of two adjacent leaf siblings", () => {
  // doc > [p1("hello"), p2(" world")]
  // After merge: doc > [p1("hello world")] (run-merged into one item since both have empty attrs)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text(" world")]) }),
      ],
    });

  it("merges right into left, removes right, rewires the parent's lastChildId", () => {
    const state = fixture();
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);

    // Left (p1) keeps its id; inlineContent is the concatenation, run-merged into one item.
    const left = result.state.blocks.get("p1" as BlockId);
    expect(left).toBeDefined();
    expect(left?.id).toBe("p1");
    expect(left?.type).toBe("paragraph");
    expect(left?.parentId).toBe("doc");
    expect(left?.prevSiblingId).toBeNull();
    expect(left?.nextSiblingId).toBeNull(); // was "p2"; p2 had no nextSibling, so left.nextSiblingId is now null
    expect(left?.inlineContent?.items).toHaveLength(1);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello world", attrs: {} });

    // Right (p2) is removed from state.blocks.
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);

    // Parent's lastChildId is rewired to p1 (was p2). firstChildId still p1.
    const parent = result.state.blocks.get("doc" as BlockId);
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
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hel", { bold: true })]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text("lo", { bold: true })]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
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
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hel", { bold: true })]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text("lo", { italic: true })]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
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
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("a", { bold: true }), embed("img")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text("b", { bold: true })]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
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
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("a"), text("b", { bold: true })]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text("c", { bold: true }), text("d")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
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
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("one")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("two")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", nextSiblingId: "p4", inlineContent: createInlineContent([text("three")]) }),
        buildBlock({ id: "p4", type: "paragraph", parentId: "doc", prevSiblingId: "p3", inlineContent: createInlineContent([text("four")]) }),
      ],
    });

  it("middle pair (p2 + p3): p2 keeps id; p4.prevSiblingId rewires to p2; parent unchanged", () => {
    const state = fourChildFixture();
    const result = mergeAdjacentBlocks(state, "p2" as BlockId, "p3" as BlockId);

    expect(result.state.blocks.get("p1" as BlockId)?.nextSiblingId).toBe("p2"); // unchanged
    expect(result.state.blocks.get("p2" as BlockId)?.prevSiblingId).toBe("p1");
    expect(result.state.blocks.get("p2" as BlockId)?.nextSiblingId).toBe("p4"); // was "p3"; now skips
    expect(result.state.blocks.get("p4" as BlockId)?.prevSiblingId).toBe("p2"); // was "p3"; rewired
    expect(result.state.blocks.has("p3" as BlockId)).toBe(false); // removed

    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1"); // unchanged
    expect(parent?.lastChildId).toBe("p4"); // unchanged

    // dirtyIds: p2 (modified), p3 (removed), p4 (prevSiblingId rewired). Parent NOT dirty.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p2", "p3", "p4"]));
  });

  it("first pair (p1 + p2): p1 keeps id; firstChildId stays p1; p3.prevSiblingId rewires to p1", () => {
    const state = fourChildFixture();
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);

    expect(result.state.blocks.get("p1" as BlockId)?.prevSiblingId).toBeNull(); // unchanged
    expect(result.state.blocks.get("p1" as BlockId)?.nextSiblingId).toBe("p3"); // was p2
    expect(result.state.blocks.get("p3" as BlockId)?.prevSiblingId).toBe("p1"); // was p2
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);

    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1"); // unchanged (left wins, kept id)
    expect(parent?.lastChildId).toBe("p4"); // unchanged

    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "p3"]));
  });

  it("last pair (p3 + p4): p3 keeps id; parent's lastChildId rewires from p4 to p3", () => {
    const state = fourChildFixture();
    const result = mergeAdjacentBlocks(state, "p3" as BlockId, "p4" as BlockId);

    expect(result.state.blocks.get("p3" as BlockId)?.prevSiblingId).toBe("p2");
    expect(result.state.blocks.get("p3" as BlockId)?.nextSiblingId).toBeNull(); // was p4; now last child
    expect(result.state.blocks.has("p4" as BlockId)).toBe(false);

    const parent = result.state.blocks.get("doc" as BlockId);
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
        buildBlock({ id: "p1", type: "paragraph", parentId: "section", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", prevSiblingId: "p1", inlineContent: createInlineContent([text(" world")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);

    // Section's lastChildId rewires; doc untouched.
    const section = result.state.blocks.get("section" as BlockId);
    expect(section?.firstChildId).toBe("p1");
    expect(section?.lastChildId).toBe("p1");

    const doc = result.state.blocks.get("doc" as BlockId);
    expect(doc?.firstChildId).toBe("section");
    expect(doc?.lastChildId).toBe("section");

    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);

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
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "h", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "h", type: "heading", parentId: "doc", prevSiblingId: "p", inlineContent: createInlineContent([text(" world")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p" as BlockId, "h" as BlockId);
    expect(result.state.blocks.get("p" as BlockId)?.type).toBe("paragraph");
  });

  it("left wins attrs when blocks have different attrs", () => {
    // doc > [li1 { level: 2 }, li2 { level: 3 }] → result keeps { level: 2 }.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li1", lastChildId: "li2" }),
        buildBlock({ id: "li1", type: "list-item", attrs: { level: 2 }, parentId: "doc", nextSiblingId: "li2", inlineContent: createInlineContent([text("a")]) }),
        buildBlock({ id: "li2", type: "list-item", attrs: { level: 3 }, parentId: "doc", prevSiblingId: "li1", inlineContent: createInlineContent([text("b")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "li1" as BlockId, "li2" as BlockId);
    expect(result.state.blocks.get("li1" as BlockId)?.attrs).toEqual({ level: 2 });
  });

  it("preserves embed-referenced contents in right's inline content (no cascade-delete)", () => {
    // doc > [p1[], p2[embed("footnote", { contentBlockId: "fn-body" })]] + standalone fn-body block.
    // Merging p1 + p2 must NOT delete fn-body — the embed reference is still alive in the merged content.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("see")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([embed("footnote-anchor", { contentBlockId: "fn-body" })]) }),
        buildBlock({ id: "fn-body", type: "footnote-body", inlineContent: createInlineContent([text("footnote text")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    // fn-body must still exist.
    expect(result.state.blocks.has("fn-body" as BlockId)).toBe(true);
    // The merged inline content carries the embed reference.
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
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
        buildBlock({ id: "p0", type: "paragraph", parentId: "doc", nextSiblingId: "p1", inlineContent: createInlineContent([text("zero")]) }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", prevSiblingId: "p0", nextSiblingId: "p2", inlineContent: createInlineContent([text("one")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("two")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("three")]) }),
      ],
    });
    const beforeP0 = state.blocks.get("p0" as BlockId);
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    expect(result.state.blocks.get("p0" as BlockId)).toBe(beforeP0);
  });

  it("does not mutate the original state", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text(" world")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);

    expect(result.state).not.toBe(state);
    // Original state still has p2 and p1's nextSibling pointing to p2.
    expect(state.blocks.has("p2" as BlockId)).toBe(true);
    expect(state.blocks.get("p1" as BlockId)?.nextSiblingId).toBe("p2");
  });
});

describe("mergeAdjacentBlocks — empty-block edge cases", () => {
  it("left empty + right with content: result has right's content under left's id", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello" });
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);
  });

  it("left with content + right empty: result has left's content unchanged", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hello" });
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);
  });

  it("both empty: result is one empty block under left's id", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
      ],
    });
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);
    const items = result.state.blocks.get("p1" as BlockId)?.inlineContent?.items;
    expect(items).toEqual([]);
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);
  });
});
