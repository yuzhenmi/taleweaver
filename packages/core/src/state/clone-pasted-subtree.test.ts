import { describe, it, expect } from "vitest";
import { clonePastedSubtree } from "./clone-pasted-subtree";
import { buildBlock, buildState, text } from "../test-utils/state-builders";
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
