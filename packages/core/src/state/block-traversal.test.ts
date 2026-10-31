import { describe, it, expect } from "vitest";
import { nextBlockInDocOrder, prevBlockInDocOrder, ancestorChain, firstLeafBlock, lastLeafBlock } from "./block-traversal";
import { buildBlock, buildState, text, inlineContent } from "../test-utils/state-builders";
import type { BlockId } from "./block-id";
import { getBlock, type Document } from "./state";

/** The document's final section: the root's child, the parent of a section-less doc's blocks. */
const fin = (s: Document): string | null => getBlock(s, s.rootId)?.firstChildId ?? null;

describe("nextBlockInDocOrder", () => {
  it("returns the first child when the block has children", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    expect(nextBlockInDocOrder(state, "doc" as BlockId)).toBe(fin(state));
    expect(nextBlockInDocOrder(state, fin(state) as BlockId)).toBe("p1");
  });

  it("returns the next sibling when no children but has a next sibling", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
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
        buildBlock({ id: "p1", type: "paragraph", parentId: "s1", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "s1", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
        buildBlock({ id: "s2", type: "section", parentId: "doc", prevSiblingId: "s1", firstChildId: "p3", lastChildId: "p3" }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "s2", inlineContent: inlineContent([]) }),
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
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
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
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    expect(prevBlockInDocOrder(state, "p1" as BlockId)).toBe(fin(state));
  });

  it("returns the previous sibling's deepest last leaf when there is a prev sibling", () => {
    // doc > [section1 > [p1, p2], section2 > [p3]]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s1", lastChildId: "s2" }),
        buildBlock({ id: "s1", type: "section", parentId: "doc", nextSiblingId: "s2", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s1", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "s1", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
        buildBlock({ id: "s2", type: "section", parentId: "doc", prevSiblingId: "s1", firstChildId: "p3", lastChildId: "p3" }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "s2", inlineContent: inlineContent([]) }),
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
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });
    expect(prevBlockInDocOrder(state, "p1" as BlockId)).toBe(fin(state));
  });
});

describe("ancestorChain", () => {
  it("returns [self] for the root block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document" })],
    });
    expect(ancestorChain(state, "doc" as BlockId)).toEqual(["doc"]);
  });

  it("returns the chain from the block up to the root", () => {
    // doc > section > p
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "s", inlineContent: inlineContent([]) }),
      ],
    });
    expect(ancestorChain(state, "p" as BlockId)).toEqual(["p", "s", "doc"]);
  });

  it("returns an empty array for a non-existent id", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(ancestorChain(state, "missing" as BlockId)).toEqual([]);
  });
});

describe("firstLeafBlock", () => {
  it("returns the block itself when it is a leaf (no children)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    expect(firstLeafBlock(state, "p" as BlockId)).toBe("p");
  });

  it("descends to the first leaf via firstChildId", () => {
    // doc > section > [p1, p2]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "s", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });
    expect(firstLeafBlock(state, "doc" as BlockId)).toBe("p1");
  });

  it("returns null when called on a non-existent id", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(firstLeafBlock(state, "missing" as BlockId)).toBeNull();
  });
});

describe("lastLeafBlock", () => {
  it("returns the block itself when it is a leaf", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    expect(lastLeafBlock(state, "p" as BlockId)).toBe("p");
  });

  it("descends to the last leaf via lastChildId", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "s", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });
    expect(lastLeafBlock(state, "doc" as BlockId)).toBe("p2");
  });

  it("returns null when called on a non-existent id", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(lastLeafBlock(state, "missing" as BlockId)).toBeNull();
  });
});
