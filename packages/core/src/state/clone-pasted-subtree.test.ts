import { describe, it, expect } from "vitest";
import { clonePastedSubtree } from "./clone-pasted-subtree";
import { buildBlock, buildState, text, embed } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import { createTestAllocator, type BlockId } from "./block-id";

describe("clonePastedSubtree — basic single-leaf clone", () => {
  // Source: doc > [p("hello world")]. Clone the paragraph alone.
  // Expected: cloned root has new id from allocator; type/attrs/content preserved;
  // parentId/sibling pointers all null on the clone.
  it("clones a single leaf block with text content", () => {
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          attrs: { textAlign: "left" },
          parentId: "doc",
          inlineContent: createInlineContent([text("hello world")]),
        }),
      ],
    });
    const allocator = createTestAllocator("clone");
    const result = clonePastedSubtree(sourceState, "p" as BlockId, allocator);

    // The cloned root has the first allocator-produced id.
    expect(result.rootId).toBe("clone-0");
    expect(result.blocks.size).toBe(1);

    const clonedRoot = result.blocks.get("clone-0" as BlockId);
    expect(clonedRoot).toBeDefined();
    expect(clonedRoot?.id).toBe("clone-0");
    expect(clonedRoot?.type).toBe("paragraph");
    expect(clonedRoot?.attrs).toEqual({ textAlign: "left" });
    // Root is detached: parentId/sibling pointers all null.
    expect(clonedRoot?.parentId).toBeNull();
    expect(clonedRoot?.prevSiblingId).toBeNull();
    expect(clonedRoot?.nextSiblingId).toBeNull();
    expect(clonedRoot?.firstChildId).toBeNull();
    expect(clonedRoot?.lastChildId).toBeNull();
    // Inline content preserved.
    expect(clonedRoot?.inlineContent?.items).toHaveLength(1);
    expect(clonedRoot?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello world" });
  });
});

describe("clonePastedSubtree — tree shapes", () => {
  it("clones a parent with two children, mapping all internal refs", () => {
    // Source: section > [p1, p2]. Clone the section.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "section", nextSiblingId: "p2", inlineContent: createInlineContent([text("first")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", prevSiblingId: "p1", inlineContent: createInlineContent([text("second")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "section" as BlockId, allocator);

    // 3 blocks cloned: section + p1 + p2. doc is NOT included (it's outside the subtree).
    expect(result.blocks.size).toBe(3);

    const newSectionId = result.rootId;
    const newSection = result.blocks.get(newSectionId);
    expect(newSection).toBeDefined();
    expect(newSection?.type).toBe("section");
    expect(newSection?.parentId).toBeNull(); // root of clone is detached
    expect(newSection?.firstChildId).toBeDefined();
    expect(newSection?.lastChildId).toBeDefined();
    expect(newSection?.firstChildId).not.toBe(newSection?.lastChildId);

    const newP1Id = newSection?.firstChildId;
    const newP2Id = newSection?.lastChildId;
    if (!newP1Id || !newP2Id) throw new Error("missing child ids");

    const newP1 = result.blocks.get(newP1Id);
    expect(newP1?.type).toBe("paragraph");
    expect(newP1?.parentId).toBe(newSectionId);
    expect(newP1?.nextSiblingId).toBe(newP2Id);
    expect(newP1?.prevSiblingId).toBeNull();
    expect(newP1?.inlineContent?.items[0]).toMatchObject({ text: "first" });

    const newP2 = result.blocks.get(newP2Id);
    expect(newP2?.type).toBe("paragraph");
    expect(newP2?.parentId).toBe(newSectionId);
    expect(newP2?.prevSiblingId).toBe(newP1Id);
    expect(newP2?.nextSiblingId).toBeNull();
    expect(newP2?.inlineContent?.items[0]).toMatchObject({ text: "second" });
  });

  it("clones a deeply nested tree (3+ levels)", () => {
    // Source: doc > section > list > [item1, item2]. Clone the section.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "list", lastChildId: "list" }),
        buildBlock({ id: "list", type: "list", parentId: "section", firstChildId: "i1", lastChildId: "i2" }),
        buildBlock({ id: "i1", type: "list-item", parentId: "list", nextSiblingId: "i2", inlineContent: createInlineContent([text("a")]) }),
        buildBlock({ id: "i2", type: "list-item", parentId: "list", prevSiblingId: "i1", inlineContent: createInlineContent([text("b")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "section" as BlockId, allocator);

    // 4 blocks cloned: section + list + i1 + i2.
    expect(result.blocks.size).toBe(4);

    // Walk down: section.firstChildId → list. list.firstChildId → i1. i1.nextSiblingId → i2.
    const newSection = result.blocks.get(result.rootId);
    if (!newSection?.firstChildId) throw new Error("missing list child");
    const newList = result.blocks.get(newSection.firstChildId);
    expect(newList?.type).toBe("list");
    expect(newList?.parentId).toBe(result.rootId);

    if (!newList?.firstChildId) throw new Error("missing i1 child");
    const newI1 = result.blocks.get(newList.firstChildId);
    expect(newI1?.type).toBe("list-item");
    expect(newI1?.inlineContent?.items[0]).toMatchObject({ text: "a" });
    expect(newI1?.parentId).toBe(newSection?.firstChildId); // newList.id (same value, more semantic)
    // Walk one more sibling: i1.nextSiblingId → i2.
    if (!newI1?.nextSiblingId) throw new Error("missing i2 sibling");
    const newI2 = result.blocks.get(newI1.nextSiblingId);
    expect(newI2?.inlineContent?.items[0]).toMatchObject({ text: "b" });
    expect(newI2?.prevSiblingId).toBe(newI1.id);
  });

  it("clones a single-child tree (firstChildId === lastChildId)", () => {
    // Source: doc > section > p_only. Clone section.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "p_only", lastChildId: "p_only" }),
        buildBlock({ id: "p_only", type: "paragraph", parentId: "section", inlineContent: createInlineContent([text("alone")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "section" as BlockId, allocator);

    expect(result.blocks.size).toBe(2);
    const newSection = result.blocks.get(result.rootId);
    expect(newSection?.firstChildId).toBe(newSection?.lastChildId);
    if (!newSection?.firstChildId) throw new Error("missing child");
    const newPOnly = result.blocks.get(newSection.firstChildId);
    expect(newPOnly?.inlineContent?.items[0]).toMatchObject({ text: "alone" });
    expect(newPOnly?.prevSiblingId).toBeNull();
    expect(newPOnly?.nextSiblingId).toBeNull();
  });

  it("clones an empty container (no children)", () => {
    // Source: doc > [empty_section]. Clone the empty section.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "empty_section", lastChildId: "empty_section" }),
        buildBlock({ id: "empty_section", type: "section", parentId: "doc" }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "empty_section" as BlockId, allocator);

    expect(result.blocks.size).toBe(1);
    const newEmpty = result.blocks.get(result.rootId);
    expect(newEmpty?.type).toBe("section");
    expect(newEmpty?.firstChildId).toBeNull();
    expect(newEmpty?.lastChildId).toBeNull();
    expect(newEmpty?.inlineContent).toBeNull();
  });
});

describe("clonePastedSubtree — embed-content cloning", () => {
  it("clones an embed's content block (footnote body) and rewrites contentBlockId", () => {
    // Source: doc > [p1[text + embed("footnote-anchor", { contentBlockId: "fn-body" })]] + standalone fn-body.
    // Clone p1: should also clone fn-body, and the cloned anchor's contentBlockId points to the cloned body.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([
            text("see"),
            embed("footnote-anchor", { contentBlockId: "fn-body" }),
          ]),
        }),
        buildBlock({
          id: "fn-body",
          type: "footnote-body",
          inlineContent: createInlineContent([text("the footnote text")]),
        }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "p1" as BlockId, allocator);

    // 2 blocks cloned: p1 + fn-body. doc is outside.
    expect(result.blocks.size).toBe(2);

    const newP1 = result.blocks.get(result.rootId);
    expect(newP1?.type).toBe("paragraph");
    expect(newP1?.inlineContent?.items).toHaveLength(2);
    expect(newP1?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "see" });

    // The embed's contentBlockId is rewritten — NOT the original "fn-body".
    const embedItem = newP1?.inlineContent?.items[1];
    expect(embedItem?.kind).toBe("embed");
    if (embedItem?.kind !== "embed") throw new Error("expected embed");
    const newCbId = embedItem.properties.contentBlockId;
    expect(typeof newCbId).toBe("string");
    expect(newCbId).not.toBe("fn-body");

    // The cloned fn-body has the rewritten id and preserved content.
    const newFnBody = result.blocks.get(newCbId as BlockId);
    expect(newFnBody).toBeDefined();
    expect(newFnBody?.type).toBe("footnote-body");
    expect(newFnBody?.inlineContent?.items[0]).toMatchObject({ text: "the footnote text" });
    expect(newFnBody?.parentId).toBeNull(); // standalone root, preserved
  });

  it("clones multiple embed-content references", () => {
    // Source: p1 with TWO footnote anchors → two distinct fn-body clones.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([
            text("a"),
            embed("footnote-anchor", { contentBlockId: "fn-a" }),
            text("b"),
            embed("footnote-anchor", { contentBlockId: "fn-b" }),
          ]),
        }),
        buildBlock({ id: "fn-a", type: "footnote-body", inlineContent: createInlineContent([text("body a")]) }),
        buildBlock({ id: "fn-b", type: "footnote-body", inlineContent: createInlineContent([text("body b")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "p1" as BlockId, allocator);

    // 3 blocks cloned: p1 + fn-a + fn-b.
    expect(result.blocks.size).toBe(3);

    const newP1 = result.blocks.get(result.rootId);
    const items = newP1?.inlineContent?.items;
    expect(items).toHaveLength(4);
    if (!items) throw new Error("missing items");

    const embedA = items[1];
    const embedB = items[3];
    if (embedA.kind !== "embed" || embedB.kind !== "embed") throw new Error("expected embeds");
    const newCbA = embedA.properties.contentBlockId as BlockId;
    const newCbB = embedB.properties.contentBlockId as BlockId;
    expect(newCbA).not.toBe(newCbB);
    expect(newCbA).not.toBe("fn-a");
    expect(newCbB).not.toBe("fn-b");

    expect(result.blocks.get(newCbA)?.inlineContent?.items[0]).toMatchObject({ text: "body a" });
    expect(result.blocks.get(newCbB)?.inlineContent?.items[0]).toMatchObject({ text: "body b" });
  });

  it("clones nested embed-content (footnote body containing its own footnote anchor)", () => {
    // Source: p1 has fn-outer, fn-outer-body has fn-inner anchor, fn-inner-body has plain text.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([embed("footnote-anchor", { contentBlockId: "fn-outer" })]),
        }),
        buildBlock({
          id: "fn-outer",
          type: "footnote-body",
          inlineContent: createInlineContent([embed("footnote-anchor", { contentBlockId: "fn-inner" })]),
        }),
        buildBlock({ id: "fn-inner", type: "footnote-body", inlineContent: createInlineContent([text("deep")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "p1" as BlockId, allocator);

    // 3 blocks cloned: p1 + fn-outer + fn-inner.
    expect(result.blocks.size).toBe(3);

    const newP1 = result.blocks.get(result.rootId);
    const outerEmbed = newP1?.inlineContent?.items[0];
    if (outerEmbed?.kind !== "embed") throw new Error("expected embed");
    const newOuterId = outerEmbed.properties.contentBlockId as BlockId;
    expect(newOuterId).not.toBe("fn-outer");

    const newOuter = result.blocks.get(newOuterId);
    const innerEmbed = newOuter?.inlineContent?.items[0];
    if (innerEmbed?.kind !== "embed") throw new Error("expected embed");
    const newInnerId = innerEmbed.properties.contentBlockId as BlockId;
    expect(newInnerId).not.toBe("fn-inner");

    const newInner = result.blocks.get(newInnerId);
    expect(newInner?.inlineContent?.items[0]).toMatchObject({ text: "deep" });
  });
});

describe("clonePastedSubtree — block-level invariants", () => {
  it("does not mutate the source state", () => {
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello")]) }),
      ],
    });
    const beforeP = sourceState.blocks.get("p" as BlockId);
    const beforeDoc = sourceState.blocks.get("doc" as BlockId);
    const allocator = createTestAllocator("c");
    clonePastedSubtree(sourceState, "p" as BlockId, allocator);

    // Source state's blocks unchanged.
    expect(sourceState.blocks.get("p" as BlockId)).toBe(beforeP);
    expect(sourceState.blocks.get("doc" as BlockId)).toBe(beforeDoc);
    // No new blocks added to the source.
    expect(sourceState.blocks.has("c-0" as BlockId)).toBe(false);
  });

  it("the cloned root has parentId/sibling pointers all null, even when the source did not", () => {
    // Source: section > [p1, p2, p3]. Clone p2 (a middle child with both prev and next siblings).
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("b")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("c")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "p2" as BlockId, allocator);

    expect(result.blocks.size).toBe(1);
    const newP2 = result.blocks.get(result.rootId);
    expect(newP2?.parentId).toBeNull();
    expect(newP2?.prevSiblingId).toBeNull();
    expect(newP2?.nextSiblingId).toBeNull();
    expect(newP2?.inlineContent?.items[0]).toMatchObject({ text: "b" });
  });

  it("preserves type, attrs, text content, and embed properties exactly (excluding rewritten contentBlockId)", () => {
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li", lastChildId: "li" }),
        buildBlock({
          id: "li",
          type: "list-item",
          attrs: { level: 2, ordered: true, custom: { meta: "x" } },
          parentId: "doc",
          inlineContent: createInlineContent([
            text("hello", { bold: true, color: "red" }),
            embed("image", { src: "img.png", width: 200 }, { link: "https://example.com" }),
          ]),
        }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "li" as BlockId, allocator);

    const newLi = result.blocks.get(result.rootId);
    expect(newLi?.type).toBe("list-item");
    expect(newLi?.attrs).toEqual({ level: 2, ordered: true, custom: { meta: "x" } });

    const items = newLi?.inlineContent?.items;
    if (!items) throw new Error("missing items");
    expect(items[0]).toMatchObject({ kind: "text", text: "hello", attrs: { bold: true, color: "red" } });
    expect(items[1]).toMatchObject({
      kind: "embed",
      embedType: "image",
      properties: { src: "img.png", width: 200 },
      attrs: { link: "https://example.com" },
    });
  });

  it("all internal references in the result point to ids in result.blocks (no leaked source ids)", () => {
    // Source with multiple internal refs.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "section", nextSiblingId: "p2", inlineContent: createInlineContent([text("first"), embed("footnote-anchor", { contentBlockId: "fn" })]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", prevSiblingId: "p1", inlineContent: createInlineContent([text("second")]) }),
        buildBlock({ id: "fn", type: "footnote-body", inlineContent: createInlineContent([text("footnote text")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "section" as BlockId, allocator);

    // 4 blocks: section, p1, p2, fn.
    expect(result.blocks.size).toBe(4);

    // For each block in the result, every non-null reference must be a key in result.blocks (or null).
    const allIds = new Set(result.blocks.keys());
    for (const [, b] of result.blocks) {
      const refs = [b.parentId, b.prevSiblingId, b.nextSiblingId, b.firstChildId, b.lastChildId];
      for (const ref of refs) {
        if (ref !== null) {
          expect(allIds.has(ref)).toBe(true);
        }
      }
      if (b.inlineContent) {
        for (const item of b.inlineContent.items) {
          if (item.kind === "embed") {
            const cbId = item.properties.contentBlockId;
            if (typeof cbId === "string") {
              expect(allIds.has(cbId as BlockId)).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe("clonePastedSubtree — edge cases", () => {
  it("clones a leaf with empty inlineContent.items", () => {
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "p" as BlockId, allocator);

    expect(result.blocks.size).toBe(1);
    const newP = result.blocks.get(result.rootId);
    expect(newP?.inlineContent?.items).toEqual([]);
  });

  it("clones an embed item without a contentBlockId (no recursion needed)", () => {
    // Image embed with primitive properties only — no contentBlockId.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([embed("image", { src: "x.png" })]),
        }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "p" as BlockId, allocator);

    expect(result.blocks.size).toBe(1); // only p — no embed-content to follow.
    const newP = result.blocks.get(result.rootId);
    const item = newP?.inlineContent?.items[0];
    if (item?.kind !== "embed") throw new Error("expected embed");
    expect(item.embedType).toBe("image");
    expect(item.properties).toEqual({ src: "x.png" }); // contentBlockId not present, properties pass through.
  });

  it("each clonePastedSubtree call uses fresh allocator-produced ids", () => {
    // Same source, two clones with different allocators → all blocks have distinct ids.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });

    const a1 = createTestAllocator("first");
    const a2 = createTestAllocator("second");
    const r1 = clonePastedSubtree(sourceState, "p" as BlockId, a1);
    const r2 = clonePastedSubtree(sourceState, "p" as BlockId, a2);

    expect(r1.rootId).toBe("first-0");
    expect(r2.rootId).toBe("second-0");
    expect(r1.rootId).not.toBe(r2.rootId);
  });
});
