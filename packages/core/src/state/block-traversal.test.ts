import { describe, it, expect } from "vitest";
import { nextBlockInDocOrder, prevBlockInDocOrder } from "./block-traversal";
import { buildBlock, buildState, text } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import type { BlockId } from "./block-id";

describe("nextBlockInDocOrder", () => {
  it("returns the first child when the block has children", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    expect(nextBlockInDocOrder(state, "doc" as BlockId)).toBe("p1");
  });

  it("returns the next sibling when no children but has a next sibling", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
      ],
    });
    expect(nextBlockInDocOrder(state, "p1" as BlockId)).toBe("p2");
  });

  it("ascends to find the parent's next sibling when at the end of a subtree", () => {
    // doc > [section1 > [p1, p2], section2 > [p3]]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s1", lastChildId: "s2" }),
        buildBlock({ id: "s1", type: "section", parentId: "doc", nextSiblingId: "s2", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s1", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "s1", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "s2", type: "section", parentId: "doc", prevSiblingId: "s1", firstChildId: "p3", lastChildId: "p3" }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "s2", inlineContent: createInlineContent([]) }),
      ],
    });
    // p2 has no next sibling, but parent s1 has next sibling s2; we should land on s2 (the next block in doc order, before descending into its children).
    expect(nextBlockInDocOrder(state, "p2" as BlockId)).toBe("s2");
  });

  it("returns null at the end of the document", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([]) }),
      ],
    });
    expect(nextBlockInDocOrder(state, "p1" as BlockId)).toBeNull();
  });

  it("returns null when called on a non-existent id", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(nextBlockInDocOrder(state, "missing" as BlockId)).toBeNull();
  });
});

describe("prevBlockInDocOrder", () => {
  it("returns the parent when this block is the first child", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([]) }),
      ],
    });
    expect(prevBlockInDocOrder(state, "p1" as BlockId)).toBe("doc");
  });

  it("returns the previous sibling's deepest last leaf when there is a prev sibling", () => {
    // doc > [section1 > [p1, p2], section2 > [p3]]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s1", lastChildId: "s2" }),
        buildBlock({ id: "s1", type: "section", parentId: "doc", nextSiblingId: "s2", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s1", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "s1", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "s2", type: "section", parentId: "doc", prevSiblingId: "s1", firstChildId: "p3", lastChildId: "p3" }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "s2", inlineContent: createInlineContent([]) }),
      ],
    });
    // s2 has prev sibling s1; s1's deepest last leaf is p2.
    expect(prevBlockInDocOrder(state, "s2" as BlockId)).toBe("p2");
  });

  it("returns null at the start of the document", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document" })],
    });
    expect(prevBlockInDocOrder(state, "doc" as BlockId)).toBeNull();
  });

  it("returns null when called on a non-existent id", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(prevBlockInDocOrder(state, "missing" as BlockId)).toBeNull();
  });

  it("returns the parent when this is the first child of root with siblings present", () => {
    // Confirms parent-return path even when there are subsequent siblings.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
      ],
    });
    expect(prevBlockInDocOrder(state, "p1" as BlockId)).toBe("doc");
  });
});
