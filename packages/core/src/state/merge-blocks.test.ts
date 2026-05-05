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
