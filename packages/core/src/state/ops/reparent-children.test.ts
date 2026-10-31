import { describe, it, expect } from "vitest";
import {
  reparentChildren,
  reparentChildrenInTx,
  planReparentChildren,
} from "./reparent-children";
import { getBlock } from "../document";
import { assertInvariantI } from "../../test-utils/invariant-i";
import { DOCUMENT_INTERNAL } from "../document-internal";
import { TEST_RESOLVER, testContainer, buildBlock, buildDocument, inlineContent } from "../../test-utils/document-builders";
import type { BlockId } from "../block-id";

// Host container types the default registry lacks (file-local registry instance).
TEST_RESOLVER.register(testContainer("blockquote"));

/**
 * Helper: read every structural pointer of a block as a plain object so
 * assertions can compare the whole 5-pointer shape at once.
 */
function pointers(document: ReturnType<typeof buildDocument>, id: string) {
  const b = getBlock(document, id as BlockId);
  if (b === null) throw new Error(`block ${id} not found`);
  return {
    parentId: b.parentId,
    prevSiblingId: b.prevSiblingId,
    nextSiblingId: b.nextSiblingId,
    firstChildId: b.firstChildId,
    lastChildId: b.lastChildId,
  };
}

describe("reparentChildren — move a single middle child P → Q (append)", () => {
  // doc > [P > [a, b, c], Q > [x]]   move [b] into Q (append)
  const fixture = () =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "Q" }),
        buildBlock({ id: "P", type: "section", parentId: "doc", nextSiblingId: "Q", firstChildId: "a", lastChildId: "c" }),
        buildBlock({ id: "Q", type: "section", parentId: "doc", prevSiblingId: "P", firstChildId: "x", lastChildId: "x" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "P", nextSiblingId: "b", inlineContent: inlineContent([]) }),
        buildBlock({ id: "b", type: "paragraph", parentId: "P", prevSiblingId: "a", nextSiblingId: "c", inlineContent: inlineContent([]) }),
        buildBlock({ id: "c", type: "paragraph", parentId: "P", prevSiblingId: "b", inlineContent: inlineContent([]) }),
        buildBlock({ id: "x", type: "paragraph", parentId: "Q", inlineContent: inlineContent([]) }),
      ],
    });

  it("detaches b from P (relinks a↔c) and appends it into Q", () => {
    const document = fixture();
    const result = reparentChildren(document, ["b" as BlockId], "Q" as BlockId);

    // P: now [a, c]
    expect(pointers(result.document, "P")).toEqual({
      parentId: "doc",
      prevSiblingId: null,
      nextSiblingId: "Q",
      firstChildId: "a",
      lastChildId: "c",
    });
    // a ↔ c become adjacent
    expect(getBlock(result.document, "a" as BlockId)?.nextSiblingId).toBe("c");
    expect(getBlock(result.document, "c" as BlockId)?.prevSiblingId).toBe("a");

    // Q: now [x, b]
    expect(pointers(result.document, "Q")).toEqual({
      parentId: "doc",
      prevSiblingId: "P",
      nextSiblingId: null,
      firstChildId: "x",
      lastChildId: "b",
    });
    expect(getBlock(result.document, "x" as BlockId)?.nextSiblingId).toBe("b");

    // b: re-parented under Q, appended after x
    expect(pointers(result.document, "b")).toEqual({
      parentId: "Q",
      prevSiblingId: "x",
      nextSiblingId: null,
      firstChildId: null,
      lastChildId: null,
    });
  });

  it("dirtyIds contains P, Q, the moved block, and re-linked siblings", () => {
    const document = fixture();
    const result = reparentChildren(document, ["b" as BlockId], "Q" as BlockId);
    // P (lastChildId unchanged but firstChild/last unchanged? Actually P.firstChild=a,
    // last=c both unchanged — but a.next and c.prev change so P itself isn't dirty
    // unless boundary changed. Here b was a middle child so P's first/last are
    // unchanged; however the relinked siblings a and c ARE dirty. Q gains a child
    // at its boundary (lastChildId), so Q is dirty. x gains a nextSibling, so x dirty.)
    const ids = new Set(result.dirtyIds);
    expect(ids.has("b" as BlockId)).toBe(true);
    expect(ids.has("Q" as BlockId)).toBe(true);
    expect(ids.has("x" as BlockId)).toBe(true);
    expect(ids.has("a" as BlockId)).toBe(true);
    expect(ids.has("c" as BlockId)).toBe(true);
  });
});

describe("reparentChildren — move contiguous run [b2,b3] P → Q before existing child", () => {
  // doc > [P > [b1, b2, b3, b4], Q > [y1, y2]]   move [b2, b3] into Q before y2
  const fixture = () =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "Q" }),
        buildBlock({ id: "P", type: "section", parentId: "doc", nextSiblingId: "Q", firstChildId: "b1", lastChildId: "b4" }),
        buildBlock({ id: "Q", type: "section", parentId: "doc", prevSiblingId: "P", firstChildId: "y1", lastChildId: "y2" }),
        buildBlock({ id: "b1", type: "paragraph", parentId: "P", nextSiblingId: "b2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "b2", type: "paragraph", parentId: "P", prevSiblingId: "b1", nextSiblingId: "b3", inlineContent: inlineContent([]) }),
        buildBlock({ id: "b3", type: "paragraph", parentId: "P", prevSiblingId: "b2", nextSiblingId: "b4", inlineContent: inlineContent([]) }),
        buildBlock({ id: "b4", type: "paragraph", parentId: "P", prevSiblingId: "b3", inlineContent: inlineContent([]) }),
        buildBlock({ id: "y1", type: "paragraph", parentId: "Q", nextSiblingId: "y2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "y2", type: "paragraph", parentId: "Q", prevSiblingId: "y1", inlineContent: inlineContent([]) }),
      ],
    });

  it("moves the run, preserving its internal order, before y2", () => {
    const document = fixture();
    const result = reparentChildren(document, ["b2" as BlockId, "b3" as BlockId], "Q" as BlockId, "y2" as BlockId);

    // P: now [b1, b4]
    expect(getBlock(result.document, "P" as BlockId)?.firstChildId).toBe("b1");
    expect(getBlock(result.document, "P" as BlockId)?.lastChildId).toBe("b4");
    expect(getBlock(result.document, "b1" as BlockId)?.nextSiblingId).toBe("b4");
    expect(getBlock(result.document, "b4" as BlockId)?.prevSiblingId).toBe("b1");

    // Q: now [y1, b2, b3, y2]
    expect(getBlock(result.document, "Q" as BlockId)?.firstChildId).toBe("y1");
    expect(getBlock(result.document, "Q" as BlockId)?.lastChildId).toBe("y2");
    expect(getBlock(result.document, "y1" as BlockId)?.nextSiblingId).toBe("b2");
    expect(pointers(result.document, "b2")).toEqual({
      parentId: "Q",
      prevSiblingId: "y1",
      nextSiblingId: "b3",
      firstChildId: null,
      lastChildId: null,
    });
    // run-internal chain preserved
    expect(pointers(result.document, "b3")).toEqual({
      parentId: "Q",
      prevSiblingId: "b2",
      nextSiblingId: "y2",
      firstChildId: null,
      lastChildId: null,
    });
    expect(getBlock(result.document, "y2" as BlockId)?.prevSiblingId).toBe("b3");
  });
});

describe("reparentChildren — move the FIRST child of P (updates P.firstChildId)", () => {
  // doc > [P > [a, b], Q > [x]]   move [a] into Q (append)
  const fixture = () =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "Q" }),
        buildBlock({ id: "P", type: "section", parentId: "doc", nextSiblingId: "Q", firstChildId: "a", lastChildId: "b" }),
        // Q holds x: an empty section is not in the read model (empty sections are dropped).
        buildBlock({ id: "Q", type: "section", parentId: "doc", prevSiblingId: "P", firstChildId: "x", lastChildId: "x" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "P", nextSiblingId: "b", inlineContent: inlineContent([]) }),
        buildBlock({ id: "b", type: "paragraph", parentId: "P", prevSiblingId: "a", inlineContent: inlineContent([]) }),
        buildBlock({ id: "x", type: "paragraph", parentId: "Q", inlineContent: inlineContent([]) }),
      ],
    });

  it("updates P.firstChildId to b and clears b.prevSiblingId", () => {
    const document = fixture();
    const result = reparentChildren(document, ["a" as BlockId], "Q" as BlockId);
    expect(getBlock(result.document, "P" as BlockId)?.firstChildId).toBe("b");
    expect(getBlock(result.document, "P" as BlockId)?.lastChildId).toBe("b");
    expect(getBlock(result.document, "b" as BlockId)?.prevSiblingId).toBeNull();
    expect(pointers(result.document, "a")).toEqual({
      parentId: "Q",
      prevSiblingId: "x",
      nextSiblingId: null,
      firstChildId: null,
      lastChildId: null,
    });
    // P's firstChildId boundary changed → P is dirty; moved block + new parent too.
    expect(result.dirtyIds.has("P" as BlockId)).toBe(true);
    expect(result.dirtyIds.has("Q" as BlockId)).toBe(true);
    expect(result.dirtyIds.has("a" as BlockId)).toBe(true);
  });
});

describe("reparentChildren — move the LAST child of P (updates P.lastChildId)", () => {
  // doc > [P (blockquote) > [a, b], Q (blockquote) > [x]]   move [b] into Q (append)
  const fixture = () =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "Q" }),
        buildBlock({ id: "P", type: "blockquote", parentId: "doc", nextSiblingId: "Q", firstChildId: "a", lastChildId: "b" }),
        buildBlock({ id: "Q", type: "blockquote", parentId: "doc", prevSiblingId: "P", firstChildId: "x", lastChildId: "x" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "P", nextSiblingId: "b", inlineContent: inlineContent([]) }),
        buildBlock({ id: "b", type: "paragraph", parentId: "P", prevSiblingId: "a", inlineContent: inlineContent([]) }),
        buildBlock({ id: "x", type: "paragraph", parentId: "Q", inlineContent: inlineContent([]) }),
      ],
    });

  it("updates P.lastChildId to a and clears a.nextSiblingId", () => {
    const document = fixture();
    const result = reparentChildren(document, ["b" as BlockId], "Q" as BlockId);
    expect(getBlock(result.document, "P" as BlockId)?.firstChildId).toBe("a");
    expect(getBlock(result.document, "P" as BlockId)?.lastChildId).toBe("a");
    expect(getBlock(result.document, "a" as BlockId)?.nextSiblingId).toBeNull();
    expect(getBlock(result.document, "Q" as BlockId)?.firstChildId).toBe("x");
    expect(getBlock(result.document, "Q" as BlockId)?.lastChildId).toBe("b");
    expect(result.dirtyIds.has("P" as BlockId)).toBe(true);
    expect(result.dirtyIds.has("Q" as BlockId)).toBe(true);
    expect(result.dirtyIds.has("b" as BlockId)).toBe(true);
  });
});

describe("reparentChildren — move into an EMPTY container Q", () => {
  it("an empty container holds its one paragraph (Word: every story ends with a ¶); the run follows it", () => {
    // doc > [P (blockquote) > [a, b, c], Q (blockquote) > []] → move [a, b] into Q.
    const built = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "Q" }),
        buildBlock({ id: "P", type: "blockquote", parentId: "doc", nextSiblingId: "Q", firstChildId: "a", lastChildId: "c" }),
        buildBlock({ id: "Q", type: "blockquote", parentId: "doc", prevSiblingId: "P" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "P", nextSiblingId: "b", inlineContent: inlineContent([]) }),
        buildBlock({ id: "b", type: "paragraph", parentId: "P", prevSiblingId: "a", nextSiblingId: "c", inlineContent: inlineContent([]) }),
        buildBlock({ id: "c", type: "paragraph", parentId: "P", prevSiblingId: "b", inlineContent: inlineContent([]) }),
      ],
    });
    const only = pointers(built, "Q").firstChildId;
    expect(only).not.toBeNull();
    expect(pointers(built, "Q").lastChildId).toBe(only);
    const next = reparentChildren(built, ["a" as BlockId, "b" as BlockId], "Q" as BlockId).document;
    expect(pointers(next, "Q")).toMatchObject({ firstChildId: only, lastChildId: "b" });
    expect(pointers(next, "a")).toMatchObject({ parentId: "Q", prevSiblingId: only, nextSiblingId: "b" });
    expect(pointers(next, "P")).toMatchObject({ firstChildId: "c", lastChildId: "c" });
    assertInvariantI(next, "storage");
  });
});

describe("reparentChildren — validation", () => {
  const fixture = () =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "Q" }),
        buildBlock({ id: "P", type: "section", parentId: "doc", nextSiblingId: "Q", firstChildId: "a", lastChildId: "b" }),
        buildBlock({ id: "Q", type: "section", parentId: "doc", prevSiblingId: "P", firstChildId: "x", lastChildId: "x" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "P", nextSiblingId: "b", inlineContent: inlineContent([]) }),
        buildBlock({ id: "b", type: "paragraph", parentId: "P", prevSiblingId: "a", inlineContent: inlineContent([]) }),
        buildBlock({ id: "x", type: "paragraph", parentId: "Q", inlineContent: inlineContent([]) }),
      ],
    });

  it("throws when a moved block does not exist", () => {
    const document = fixture();
    expect(() =>
      reparentChildren(document, ["missing" as BlockId], "Q" as BlockId),
    ).toThrow(/block "missing" not found/);
  });

  it("throws when newParent is a leaf (inlineContent !== null)", () => {
    const document = fixture();
    // x is a paragraph (leaf) — cannot be a container.
    expect(() =>
      reparentChildren(document, ["a" as BlockId], "x" as BlockId),
    ).toThrow();
  });

  it("throws when newParent does not exist", () => {
    const document = fixture();
    expect(() =>
      reparentChildren(document, ["a" as BlockId], "missing" as BlockId),
    ).toThrow();
  });

  it("throws on a non-contiguous run", () => {
    // [a, x] are not contiguous siblings (a is under P, x under Q) — and even
    // within one parent, a non-adjacent pair must throw.
    const document = fixture();
    expect(() =>
      reparentChildren(document, ["a" as BlockId, "x" as BlockId], "doc" as BlockId),
    ).toThrow(/contiguous/i);
  });

  it("throws when moved blocks span two parents", () => {
    const document = fixture();
    // a (under P) and x (under Q): not a single-parent run.
    expect(() =>
      reparentChildren(document, ["a" as BlockId, "x" as BlockId], "Q" as BlockId),
    ).toThrow();
  });

  it("throws on a cycle (reparent an ancestor under its descendant)", () => {
    // Move P under Q-descendant? Build a deeper tree so that newParent is a
    // descendant of the moved block.
    // doc > [P > [child > [grand > [g]]]]   move [P] under grand → cycle.
    const cyclic = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "P" }),
        buildBlock({ id: "P", type: "blockquote", parentId: "doc", firstChildId: "child", lastChildId: "child" }),
        buildBlock({ id: "child", type: "blockquote", parentId: "P", firstChildId: "grand", lastChildId: "grand" }),
        buildBlock({ id: "grand", type: "blockquote", parentId: "child", firstChildId: "g", lastChildId: "g" }),
        buildBlock({ id: "g", type: "paragraph", parentId: "grand", inlineContent: inlineContent([]) }),
      ],
    });
    expect(() =>
      reparentChildren(cyclic, ["P" as BlockId], "grand" as BlockId),
    ).toThrow(/cannot reparent a block under its own descendant/);
  });

  it("throws when beforeSiblingId is not a child of newParent", () => {
    const document = fixture();
    // Move [b] into Q before "a". "a" is a child of P (not Q) and is NOT in the
    // moved set — so this exercises the "not a child of newParent" rule (V5),
    // not the "beforeSiblingId ∈ moved" rule (V6).
    expect(() =>
      reparentChildren(document, ["b" as BlockId], "Q" as BlockId, "a" as BlockId),
    ).toThrow(/is not a child of newParent/);
  });

  it("throws when beforeSiblingId is one of the moved blocks", () => {
    const document = fixture();
    // Move [a, b] under P (same parent) before a — a is in the moved set.
    expect(() =>
      reparentChildren(document, ["a" as BlockId, "b" as BlockId], "P" as BlockId, "a" as BlockId),
    ).toThrow(/beforeSiblingId cannot be one of the moved blocks/);
  });
});

describe("reparentChildren — no-op (empty blockIds)", () => {
  it("returns the same state reference and empty dirtyIds", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "P" }),
        buildBlock({ id: "P", type: "section", parentId: "doc" }),
      ],
    });
    const result = reparentChildren(document, [], "P" as BlockId);
    expect(result.document).toBe(document);
    expect(result.dirtyIds.size).toBe(0);
  });
});

describe("reparentChildren — self-move identity no-op", () => {
  // doc > [P > [a, b, c]]
  const fixture = () =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "P" }),
        buildBlock({ id: "P", type: "section", parentId: "doc", firstChildId: "a", lastChildId: "c" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "P", nextSiblingId: "b", inlineContent: inlineContent([]) }),
        buildBlock({ id: "b", type: "paragraph", parentId: "P", prevSiblingId: "a", nextSiblingId: "c", inlineContent: inlineContent([]) }),
        buildBlock({ id: "c", type: "paragraph", parentId: "P", prevSiblingId: "b", inlineContent: inlineContent([]) }),
      ],
    });

  it("appending the run to the parent it already ends in is a no-op (same state ref)", () => {
    const document = fixture();
    // [c] is already the last child of P; appending it to P changes nothing.
    const result = reparentChildren(document, ["c" as BlockId], "P" as BlockId);
    expect(result.document).toBe(document);
    expect(result.dirtyIds.size).toBe(0);
  });

  it("inserting the run before its current next sibling is a no-op", () => {
    const document = fixture();
    // [a] is already immediately before b; inserting it before b changes nothing.
    const result = reparentChildren(document, ["a" as BlockId], "P" as BlockId, "b" as BlockId);
    expect(result.document).toBe(document);
    expect(result.dirtyIds.size).toBe(0);
  });
});

describe("reparentChildrenInTx — transaction guard", () => {
  it("throws when called outside any Y.Doc transaction", () => {
    // doc > [P > [c1], Q]; move c1 from P to Q.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "Q" }),
        buildBlock({
          id: "P",
          type: "section",
          parentId: "doc",
          nextSiblingId: "Q",
          firstChildId: "c1",
          lastChildId: "c1",
        }),
        buildBlock({
          id: "Q",
          type: "section",
          parentId: "doc",
          prevSiblingId: "P",
          firstChildId: "x",
          lastChildId: "x",
        }),
        buildBlock({
          id: "c1",
          type: "paragraph",
          parentId: "P",
          inlineContent: inlineContent([]),
        }),
        buildBlock({ id: "x", type: "paragraph", parentId: "Q", inlineContent: inlineContent([]) }),
      ],
    });
    const plan = planReparentChildren(document, ["c1" as BlockId], "Q" as BlockId, null);
    expect(plan.blockIds.length).toBeGreaterThan(0);
    expect(() => reparentChildrenInTx(document[DOCUMENT_INTERNAL].doc, plan)).toThrow(
      /reparentChildren: must be called inside Y\.Doc\.transact/,
    );
  });
});
