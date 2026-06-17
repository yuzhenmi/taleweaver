import { describe, it, expect } from "vitest";
import { clonePastedSubtree } from "./clone-pasted-subtree";
import { buildBlock, buildState, text, embed, inlineContent } from "../test-utils/state-builders";
import { createTestAllocator, type BlockId } from "./block-id";
import { getBlock } from "./state";
import type { Block } from "./block";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

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
          inlineContent: inlineContent([text("hello world")]),
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
        buildBlock({ id: "p1", type: "paragraph", parentId: "section", nextSiblingId: "p2", inlineContent: inlineContent([text("first")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", prevSiblingId: "p1", inlineContent: inlineContent([text("second")]) }),
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
    // Source: doc > section > table > [item1, item2]. Clone the section.
    // (A generic CONTAINER nesting test — `clonePastedSubtree` is pure
    // structural copy and does not validate component kinds.)
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "table", lastChildId: "table" }),
        buildBlock({ id: "table", type: "table", parentId: "section", firstChildId: "i1", lastChildId: "i2" }),
        buildBlock({ id: "i1", type: "list-item", parentId: "table", nextSiblingId: "i2", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "i2", type: "list-item", parentId: "table", prevSiblingId: "i1", inlineContent: inlineContent([text("b")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "section" as BlockId, allocator);

    // 4 blocks cloned: section + table + i1 + i2.
    expect(result.blocks.size).toBe(4);

    // Walk down: section.firstChildId → table. table.firstChildId → i1. i1.nextSiblingId → i2.
    const newSection = result.blocks.get(result.rootId);
    if (!newSection?.firstChildId) throw new Error("missing table child");
    const newList = result.blocks.get(newSection.firstChildId);
    expect(newList?.type).toBe("table");
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
        buildBlock({ id: "p_only", type: "paragraph", parentId: "section", inlineContent: inlineContent([text("alone")]) }),
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
    // Source: doc > [p1[text + embed("footnote-anchor", { contentBlockId: "fn-body" })]] + fn-body in embedContents.
    // Clone p1: should also clone fn-body (into result.embedContents), and the
    // cloned anchor's contentBlockId points to the cloned body.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("see"),
            embed("footnote-anchor", { contentBlockId: "fn-body" }),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "fn-body",
          type: "footnote-body",
          inlineContent: inlineContent([text("the footnote text")]),
        }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "p1" as BlockId, allocator);

    // 1 block in main tree (p1) and 1 in embedContents (fn-body). doc is outside.
    expect(result.blocks.size).toBe(1);
    expect(result.embedContents.size).toBe(1);

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

    // The cloned fn-body lands in embedContents (NOT blocks).
    expect(result.blocks.has(newCbId as BlockId)).toBe(false);
    const newFnBody = result.embedContents.get(newCbId as BlockId);
    expect(newFnBody).toBeDefined();
    expect(newFnBody?.type).toBe("footnote-body");
    expect(newFnBody?.inlineContent?.items[0]).toMatchObject({ text: "the footnote text" });
    expect(newFnBody?.parentId).toBeNull(); // standalone root, preserved
  });

  it("clones multiple embed-content references", () => {
    // Source: p1 with TWO footnote anchors → two distinct fn-body clones in embedContents.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("a"),
            embed("footnote-anchor", { contentBlockId: "fn-a" }),
            text("b"),
            embed("footnote-anchor", { contentBlockId: "fn-b" }),
          ]),
        }),
      ],
      embedContents: [
        buildBlock({ id: "fn-a", type: "footnote-body", inlineContent: inlineContent([text("body a")]) }),
        buildBlock({ id: "fn-b", type: "footnote-body", inlineContent: inlineContent([text("body b")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "p1" as BlockId, allocator);

    // 1 in main tree (p1), 2 in embedContents (fn-a, fn-b).
    expect(result.blocks.size).toBe(1);
    expect(result.embedContents.size).toBe(2);

    const newP1 = result.blocks.get(result.rootId);
    const items = newP1?.inlineContent?.items;
    expect(items).toHaveLength(4);
    if (!items) throw new Error("missing items");

    const embedA = nth(items, 1, "inline item");
    const embedB = nth(items, 3, "inline item");
    if (embedA.kind !== "embed" || embedB.kind !== "embed") throw new Error("expected embeds");
    const newCbA = embedA.properties.contentBlockId as BlockId;
    const newCbB = embedB.properties.contentBlockId as BlockId;
    expect(newCbA).not.toBe(newCbB);
    expect(newCbA).not.toBe("fn-a");
    expect(newCbB).not.toBe("fn-b");

    // Both cloned bodies land in embedContents.
    expect(result.embedContents.get(newCbA)?.inlineContent?.items[0]).toMatchObject({ text: "body a" });
    expect(result.embedContents.get(newCbB)?.inlineContent?.items[0]).toMatchObject({ text: "body b" });
  });

  it("clones nested embed-content (footnote body containing its own footnote anchor)", () => {
    // Source: p1 has fn-outer, fn-outer-body has fn-inner anchor, fn-inner-body has plain text.
    // Both fn-outer and fn-inner live in embedContents.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([embed("footnote-anchor", { contentBlockId: "fn-outer" })]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "fn-outer",
          type: "footnote-body",
          inlineContent: inlineContent([embed("footnote-anchor", { contentBlockId: "fn-inner" })]),
        }),
        buildBlock({ id: "fn-inner", type: "footnote-body", inlineContent: inlineContent([text("deep")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "p1" as BlockId, allocator);

    // 1 in main tree (p1), 2 in embedContents (fn-outer + fn-inner).
    expect(result.blocks.size).toBe(1);
    expect(result.embedContents.size).toBe(2);

    const newP1 = result.blocks.get(result.rootId);
    const outerEmbed = newP1?.inlineContent?.items[0];
    if (outerEmbed?.kind !== "embed") throw new Error("expected embed");
    const newOuterId = outerEmbed.properties.contentBlockId as BlockId;
    expect(newOuterId).not.toBe("fn-outer");

    const newOuter = result.embedContents.get(newOuterId);
    expect(newOuter).toBeDefined();
    const innerEmbed = newOuter?.inlineContent?.items[0];
    if (innerEmbed?.kind !== "embed") throw new Error("expected embed");
    const newInnerId = innerEmbed.properties.contentBlockId as BlockId;
    expect(newInnerId).not.toBe("fn-inner");

    const newInner = result.embedContents.get(newInnerId);
    expect(newInner?.inlineContent?.items[0]).toMatchObject({ text: "deep" });
    // The cloned bodies are NOT in result.blocks.
    expect(result.blocks.has(newOuterId)).toBe(false);
    expect(result.blocks.has(newInnerId)).toBe(false);
  });

  it("cloned tree block lands in result.blocks, not result.embedContents (segregation)", () => {
    // A plain paragraph with no embeds: lives only in result.blocks.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "p" as BlockId, allocator);

    expect(result.blocks.size).toBe(1);
    expect(result.embedContents.size).toBe(0);
    expect(result.blocks.has(result.rootId)).toBe(true);
    expect(result.embedContents.has(result.rootId)).toBe(false);
  });

  it("an embed-content block's children are also cloned into result.embedContents", () => {
    // Source: p1 references fn-body; fn-body contains a child (e.g. a paragraph inside the footnote body).
    // Both fn-body AND fn-body's child should land in result.embedContents.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([embed("footnote-anchor", { contentBlockId: "fn-body" })]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "fn-body",
          type: "footnote-body",
          firstChildId: "fn-child",
          lastChildId: "fn-child",
        }),
        buildBlock({
          id: "fn-child",
          type: "paragraph",
          parentId: "fn-body",
          inlineContent: inlineContent([text("inside the body")]),
        }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "p1" as BlockId, allocator);

    expect(result.blocks.size).toBe(1);
    expect(result.embedContents.size).toBe(2);

    const newP1 = result.blocks.get(result.rootId);
    const embedItem = newP1?.inlineContent?.items[0];
    if (embedItem?.kind !== "embed") throw new Error("expected embed");
    const newFnBodyId = embedItem.properties.contentBlockId as BlockId;
    const newFnBody = result.embedContents.get(newFnBodyId);
    expect(newFnBody).toBeDefined();
    expect(newFnBody?.firstChildId).not.toBeNull();
    const newChildId = newFnBody?.firstChildId;
    if (newChildId === null || newChildId === undefined) throw new Error("missing child");
    const newChild = result.embedContents.get(newChildId);
    expect(newChild?.type).toBe("paragraph");
    expect(newChild?.parentId).toBe(newFnBodyId);
    expect(newChild?.inlineContent?.items[0]).toMatchObject({ text: "inside the body" });
  });
});

describe("clonePastedSubtree — block-level invariants", () => {
  it("does not mutate the source state", () => {
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const beforeP = getBlock(sourceState, "p" as BlockId);
    const beforeDoc = getBlock(sourceState, "doc" as BlockId);
    const allocator = createTestAllocator("c");
    clonePastedSubtree(sourceState, "p" as BlockId, allocator);

    // Source state's blocks unchanged.
    expect(getBlock(sourceState, "p" as BlockId)).toBe(beforeP);
    expect(getBlock(sourceState, "doc" as BlockId)).toBe(beforeDoc);
    // No new blocks added to the source.
    expect(getBlock(sourceState, "c-0" as BlockId)).toBeNull();
  });

  it("the cloned root has parentId/sibling pointers all null, even when the source did not", () => {
    // Source: section > [p1, p2, p3]. Clone p2 (a middle child with both prev and next siblings).
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("b")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([text("c")]) }),
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
          inlineContent: inlineContent([
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

  it("all internal references in the result point to ids in result.blocks or result.embedContents (no leaked source ids)", () => {
    // Source with multiple internal refs. fn is an embed-content body
    // referenced by p1's footnote anchor.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "section", nextSiblingId: "p2", inlineContent: inlineContent([text("first"), embed("footnote-anchor", { contentBlockId: "fn" })]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", prevSiblingId: "p1", inlineContent: inlineContent([text("second")]) }),
      ],
      embedContents: [
        buildBlock({ id: "fn", type: "footnote-body", inlineContent: inlineContent([text("footnote text")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    const result = clonePastedSubtree(sourceState, "section" as BlockId, allocator);

    // 3 in main tree (section, p1, p2); 1 in embedContents (fn).
    expect(result.blocks.size).toBe(3);
    expect(result.embedContents.size).toBe(1);

    // For each block in EITHER result map, every non-null reference must
    // resolve to a key in result.blocks OR result.embedContents.
    const allIds = new Set<BlockId>([...result.blocks.keys(), ...result.embedContents.keys()]);
    const allClonedBlocks = [...result.blocks.values(), ...result.embedContents.values()];
    for (const b of allClonedBlocks) {
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
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
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
          inlineContent: inlineContent([embed("image", { src: "x.png" })]),
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
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
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

describe("clonePastedSubtree — error cases", () => {
  it("throws when sourceRootId is not in sourceState.blocks", () => {
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const allocator = createTestAllocator("c");
    expect(() => clonePastedSubtree(sourceState, "missing" as BlockId, allocator)).toThrow(
      /source root ".+" not found/,
    );
  });

  it("throws when a child reference points to a missing block (corrupted source)", () => {
    // section.firstChildId references "ghost" which doesn't exist in state.blocks.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "ghost", lastChildId: "ghost" }),
      ],
    });
    const allocator = createTestAllocator("c");
    expect(() => clonePastedSubtree(sourceState, "section" as BlockId, allocator)).toThrow(
      /block ".+" not found/,
    );
  });

  it("throws when an embed's contentBlockId references a missing block", () => {
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([embed("footnote-anchor", { contentBlockId: "ghost" })]),
        }),
      ],
    });
    const allocator = createTestAllocator("c");
    expect(() => clonePastedSubtree(sourceState, "p" as BlockId, allocator)).toThrow(
      /block ".+" not found/,
    );
  });

  it("throws when the allocator returns a colliding id (already exists in source state)", () => {
    // Seed source state with a block named "c-0", then provide an allocator
    // whose first allocation also returns "c-0". Without the dev-mode
    // collision check, the cloned subtree would contain id-references that
    // overlap with the source state's namespace, breaking downstream insertion
    // (where the cloned blocks merge into a single Y.Doc).
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "c-0" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "c-0", inlineContent: inlineContent([text("hello")]) }),
        // A block with the id the allocator's first allocation will return.
        buildBlock({ id: "c-0", type: "paragraph", parentId: "doc", prevSiblingId: "p", inlineContent: inlineContent([])}),
      ],
    });
    const allocator = createTestAllocator("c");
    expect(() => clonePastedSubtree(sourceState, "p" as BlockId, allocator)).toThrow(
      /allocator returned a colliding id "c-0"/,
    );
  });

  it("handles cycles in the source state without infinite recursion (cycle defense)", () => {
    // Pathological source state: section.firstChildId points to itself (cycle).
    // The walker should add "section" to visited on first encounter and skip on second.
    // This is malformed state, but the operation should not infinite-loop.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "section", lastChildId: "section" }), // self-loop
      ],
    });
    const allocator = createTestAllocator("c");
    // Should NOT throw, and should NOT hang. The cycle defense in collectSubtreeIds
    // skips already-visited ids. The cloned section will have firstChildId/lastChildId
    // pointing to ITSELF in the cloned namespace (the self-loop is preserved
    // structurally). This is documented "garbage in, garbage out" — the operation
    // doesn't repair malformed source state.
    const result = clonePastedSubtree(sourceState, "section" as BlockId, allocator);
    expect(result.blocks.size).toBe(1);
    const cloned = result.blocks.get(result.rootId);
    expect(cloned?.firstChildId).toBe(result.rootId); // self-loop preserved in cloned namespace
    expect(cloned?.lastChildId).toBe(result.rootId); // both child pointers self-loop, both rewritten consistently
  });
});

describe("clonePastedSubtree — id-collision check namespace (S-B4)", () => {
  const sourceFixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("x")]) }),
      ],
    });

  it("checks newly-allocated ids against the DESTINATION namespace, not the source", () => {
    const sourceState = sourceFixture(); // ids: "doc", "p" — no "clone-0"
    // Destination ALREADY contains "clone-0" — the first id the counter allocator mints.
    const destinationState = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "document", firstChildId: "clone-0", lastChildId: "clone-0" }),
        buildBlock({ id: "clone-0", type: "paragraph", parentId: "root", inlineContent: inlineContent([]) }),
      ],
    });
    const allocator = createTestAllocator("clone");
    // Pre-fix (checked source) this would NOT throw — source has no "clone-0".
    expect(() =>
      clonePastedSubtree(sourceState, "p" as BlockId, allocator, destinationState),
    ).toThrow(/colliding id "clone-0"/);
  });

  it("same-document clone (no destination arg) defaults to source and still works", () => {
    const sourceState = sourceFixture();
    const allocator = createTestAllocator("clone");
    const result = clonePastedSubtree(sourceState, "p" as BlockId, allocator);
    expect(result.rootId).toBe("clone-0");
    expect(result.blocks.size).toBe(1);
  });
});

describe("clonePastedSubtree — cross-reference pointer (targetId)", () => {
  // A cross-reference's `properties.targetId` is a POINTER (not an owned
  // `contentBlockId`). The walkers never follow it, so it's in the clone's id-map
  // ONLY when the target was independently part of the copied subtree.
  type EmbedProps = { embedType: string; properties: { targetId?: unknown; refMode?: unknown } };
  function findBlockByType(blocks: ReadonlyMap<BlockId, Block>, type: string): Block | undefined {
    for (const b of blocks.values()) if (b.type === type) return b;
    return undefined;
  }
  function crossRefOf(block: Block | undefined): EmbedProps | undefined {
    const items = block?.inlineContent?.items ?? [];
    return items.find((i) => (i as unknown as EmbedProps).embedType === "cross-reference") as
      | EmbedProps
      | undefined;
  }

  it("REBINDS targetId to the cloned target when the target was copied with the reference", () => {
    // section > [heading "h", paragraph "p" [text + cross-reference → "h"]]. Clone the
    // whole section: the heading is cloned too, so the reference rebinds to the clone.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "section" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", firstChildId: "h", lastChildId: "p" }),
        buildBlock({ id: "h", type: "heading", parentId: "section", nextSiblingId: "p", attrs: { level: 1 }, inlineContent: inlineContent([text("Title")]) }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "section",
          prevSiblingId: "h",
          inlineContent: inlineContent([text("see "), embed("cross-reference", { targetId: "h", refMode: "text" })]),
        }),
      ],
    });
    const allocator = createTestAllocator("clone");
    const result = clonePastedSubtree(sourceState, "section" as BlockId, allocator);

    const clonedHeading = findBlockByType(result.blocks, "heading");
    const clonedPara = findBlockByType(result.blocks, "paragraph");
    expect(clonedHeading).toBeDefined();
    const ref = crossRefOf(clonedPara);
    expect(ref).toBeDefined();
    // Rebound to the CLONED heading's id — NOT the original "h".
    expect(ref?.properties.targetId).toBe(clonedHeading?.id);
    expect(ref?.properties.targetId).not.toBe("h");
    expect(ref?.properties.refMode).toBe("text");
  });

  it("PRESERVES targetId pointing at the original when the target is OUTSIDE the copied subtree", () => {
    // Clone ONLY the paragraph; its target heading "h" is not part of the paste.
    const sourceState = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "h", lastChildId: "p" }),
        buildBlock({ id: "h", type: "heading", parentId: "doc", nextSiblingId: "p", attrs: { level: 1 }, inlineContent: inlineContent([text("Title")]) }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "h",
          inlineContent: inlineContent([text("see "), embed("cross-reference", { targetId: "h", refMode: "text" })]),
        }),
      ],
    });
    const allocator = createTestAllocator("clone");
    const result = clonePastedSubtree(sourceState, "p" as BlockId, allocator);

    const ref = crossRefOf(result.blocks.get(result.rootId));
    expect(ref).toBeDefined();
    // Unchanged — still points at the original target outside the paste.
    expect(ref?.properties.targetId).toBe("h");
  });
});
