import { describe, it, expect } from "vitest";
import { nextBlockInDocOrder, prevBlockInDocOrder, ancestorChain, firstLeafBlock, lastLeafBlock } from "./block-traversal";
import { buildBlock, buildDocument, text, inlineContent } from "../test-utils/document-builders";
import type { BlockId } from "./block-id";
import { getBlock, type Document } from "./document";

/** The document's final section: the root's child, the parent of a section-less doc's blocks. */
const fin = (s: Document): string | null => getBlock(s, s.rootId)?.firstChildId ?? null;

describe("nextBlockInDocOrder", () => {
  it("returns the first child when the block has children", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    expect(nextBlockInDocOrder(document, "doc" as BlockId)).toBe(fin(document));
    expect(nextBlockInDocOrder(document, fin(document) as BlockId)).toBe("p1");
  });

  it("returns the next sibling when no children but has a next sibling", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });
    expect(nextBlockInDocOrder(document, "p1" as BlockId)).toBe("p2");
  });

  it("ascends to find the parent's next sibling when at the end of a subtree", () => {
    // doc > [section1 > [p1, p2], section2 > [p3]]
    const document = buildDocument({
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
    expect(nextBlockInDocOrder(document, "p2" as BlockId)).toBe("s2");
  });

  it("returns null at the end of the document", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    expect(nextBlockInDocOrder(document, "p1" as BlockId)).toBeNull();
  });

  it("returns null when called on a non-existent id", () => {
    const document = buildDocument({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(nextBlockInDocOrder(document, "missing" as BlockId)).toBeNull();
  });
});

describe("prevBlockInDocOrder", () => {
  it("returns the parent when this block is the first child", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    expect(prevBlockInDocOrder(document, "p1" as BlockId)).toBe(fin(document));
  });

  it("returns the previous sibling's deepest last leaf when there is a prev sibling", () => {
    // doc > [section1 > [p1, p2], section2 > [p3]]
    const document = buildDocument({
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
    expect(prevBlockInDocOrder(document, "s2" as BlockId)).toBe("p2");
  });

  it("returns null at the start of the document", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document" })],
    });
    expect(prevBlockInDocOrder(document, "doc" as BlockId)).toBeNull();
  });

  it("returns null when called on a non-existent id", () => {
    const document = buildDocument({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(prevBlockInDocOrder(document, "missing" as BlockId)).toBeNull();
  });

  it("returns the parent when this is the first child of root with siblings present", () => {
    // Confirms parent-return path even when there are subsequent siblings.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });
    expect(prevBlockInDocOrder(document, "p1" as BlockId)).toBe(fin(document));
  });
});

describe("ancestorChain", () => {
  it("returns [self] for the root block", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document" })],
    });
    expect(ancestorChain(document, "doc" as BlockId)).toEqual(["doc"]);
  });

  it("returns the chain from the block up to the root", () => {
    // doc > section > p
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "s", inlineContent: inlineContent([]) }),
      ],
    });
    expect(ancestorChain(document, "p" as BlockId)).toEqual(["p", "s", "doc"]);
  });

  it("returns an empty array for a non-existent id", () => {
    const document = buildDocument({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(ancestorChain(document, "missing" as BlockId)).toEqual([]);
  });
});

describe("firstLeafBlock", () => {
  it("returns the block itself when it is a leaf (no children)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    expect(firstLeafBlock(document, "p" as BlockId)).toBe("p");
  });

  it("descends to the first leaf via firstChildId", () => {
    // doc > section > [p1, p2]
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "s", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });
    expect(firstLeafBlock(document, "doc" as BlockId)).toBe("p1");
  });

  it("returns null when called on a non-existent id", () => {
    const document = buildDocument({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(firstLeafBlock(document, "missing" as BlockId)).toBeNull();
  });
});

describe("lastLeafBlock", () => {
  it("returns the block itself when it is a leaf", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    expect(lastLeafBlock(document, "p" as BlockId)).toBe("p");
  });

  it("descends to the last leaf via lastChildId", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "s", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });
    expect(lastLeafBlock(document, "doc" as BlockId)).toBe("p2");
  });

  it("returns null when called on a non-existent id", () => {
    const document = buildDocument({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(lastLeafBlock(document, "missing" as BlockId)).toBeNull();
  });
});
