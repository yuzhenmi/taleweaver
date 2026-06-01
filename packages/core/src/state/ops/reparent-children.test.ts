import { describe, it, expect } from "vitest";
import {
  reparentChildren,
  reparentChildrenInTx,
  planReparentChildren,
  computeReparentWrites,
  type BlockFieldWrite,
} from "./reparent-children";
import { getBlock } from "../state";
import { STATE_INTERNAL } from "../state-internal";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import type { BlockId } from "../block-id";

/**
 * Helper: read every structural pointer of a block as a plain object so
 * assertions can compare the whole 5-pointer shape at once.
 */
function pointers(state: ReturnType<typeof buildState>, id: string) {
  const b = getBlock(state, id as BlockId);
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
    buildState({
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
    const state = fixture();
    const result = reparentChildren(state, ["b" as BlockId], "Q" as BlockId);

    // P: now [a, c]
    expect(pointers(result.state, "P")).toEqual({
      parentId: "doc",
      prevSiblingId: null,
      nextSiblingId: "Q",
      firstChildId: "a",
      lastChildId: "c",
    });
    // a ↔ c become adjacent
    expect(getBlock(result.state, "a" as BlockId)?.nextSiblingId).toBe("c");
    expect(getBlock(result.state, "c" as BlockId)?.prevSiblingId).toBe("a");

    // Q: now [x, b]
    expect(pointers(result.state, "Q")).toEqual({
      parentId: "doc",
      prevSiblingId: "P",
      nextSiblingId: null,
      firstChildId: "x",
      lastChildId: "b",
    });
    expect(getBlock(result.state, "x" as BlockId)?.nextSiblingId).toBe("b");

    // b: re-parented under Q, appended after x
    expect(pointers(result.state, "b")).toEqual({
      parentId: "Q",
      prevSiblingId: "x",
      nextSiblingId: null,
      firstChildId: null,
      lastChildId: null,
    });
  });

  it("dirtyIds contains P, Q, the moved block, and re-linked siblings", () => {
    const state = fixture();
    const result = reparentChildren(state, ["b" as BlockId], "Q" as BlockId);
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
    buildState({
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
    const state = fixture();
    const result = reparentChildren(state, ["b2" as BlockId, "b3" as BlockId], "Q" as BlockId, "y2" as BlockId);

    // P: now [b1, b4]
    expect(getBlock(result.state, "P" as BlockId)?.firstChildId).toBe("b1");
    expect(getBlock(result.state, "P" as BlockId)?.lastChildId).toBe("b4");
    expect(getBlock(result.state, "b1" as BlockId)?.nextSiblingId).toBe("b4");
    expect(getBlock(result.state, "b4" as BlockId)?.prevSiblingId).toBe("b1");

    // Q: now [y1, b2, b3, y2]
    expect(getBlock(result.state, "Q" as BlockId)?.firstChildId).toBe("y1");
    expect(getBlock(result.state, "Q" as BlockId)?.lastChildId).toBe("y2");
    expect(getBlock(result.state, "y1" as BlockId)?.nextSiblingId).toBe("b2");
    expect(pointers(result.state, "b2")).toEqual({
      parentId: "Q",
      prevSiblingId: "y1",
      nextSiblingId: "b3",
      firstChildId: null,
      lastChildId: null,
    });
    // run-internal chain preserved
    expect(pointers(result.state, "b3")).toEqual({
      parentId: "Q",
      prevSiblingId: "b2",
      nextSiblingId: "y2",
      firstChildId: null,
      lastChildId: null,
    });
    expect(getBlock(result.state, "y2" as BlockId)?.prevSiblingId).toBe("b3");
  });
});

describe("reparentChildren — move the FIRST child of P (updates P.firstChildId)", () => {
  // doc > [P > [a, b], Q > []]   move [a] into Q (append)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "Q" }),
        buildBlock({ id: "P", type: "section", parentId: "doc", nextSiblingId: "Q", firstChildId: "a", lastChildId: "b" }),
        buildBlock({ id: "Q", type: "section", parentId: "doc", prevSiblingId: "P" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "P", nextSiblingId: "b", inlineContent: inlineContent([]) }),
        buildBlock({ id: "b", type: "paragraph", parentId: "P", prevSiblingId: "a", inlineContent: inlineContent([]) }),
      ],
    });

  it("updates P.firstChildId to b and clears b.prevSiblingId", () => {
    const state = fixture();
    const result = reparentChildren(state, ["a" as BlockId], "Q" as BlockId);
    expect(getBlock(result.state, "P" as BlockId)?.firstChildId).toBe("b");
    expect(getBlock(result.state, "P" as BlockId)?.lastChildId).toBe("b");
    expect(getBlock(result.state, "b" as BlockId)?.prevSiblingId).toBeNull();
    expect(pointers(result.state, "a")).toEqual({
      parentId: "Q",
      prevSiblingId: null,
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
  // doc > [P > [a, b], Q > []]   move [b] into Q (append)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "Q" }),
        buildBlock({ id: "P", type: "section", parentId: "doc", nextSiblingId: "Q", firstChildId: "a", lastChildId: "b" }),
        buildBlock({ id: "Q", type: "section", parentId: "doc", prevSiblingId: "P" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "P", nextSiblingId: "b", inlineContent: inlineContent([]) }),
        buildBlock({ id: "b", type: "paragraph", parentId: "P", prevSiblingId: "a", inlineContent: inlineContent([]) }),
      ],
    });

  it("updates P.lastChildId to a and clears a.nextSiblingId", () => {
    const state = fixture();
    const result = reparentChildren(state, ["b" as BlockId], "Q" as BlockId);
    expect(getBlock(result.state, "P" as BlockId)?.firstChildId).toBe("a");
    expect(getBlock(result.state, "P" as BlockId)?.lastChildId).toBe("a");
    expect(getBlock(result.state, "a" as BlockId)?.nextSiblingId).toBeNull();
    expect(getBlock(result.state, "Q" as BlockId)?.firstChildId).toBe("b");
    expect(getBlock(result.state, "Q" as BlockId)?.lastChildId).toBe("b");
    // P's lastChildId boundary changed → P is dirty; moved block + new parent too.
    expect(result.dirtyIds.has("P" as BlockId)).toBe(true);
    expect(result.dirtyIds.has("Q" as BlockId)).toBe(true);
    expect(result.dirtyIds.has("b" as BlockId)).toBe(true);
  });
});

describe("reparentChildren — move into an EMPTY container Q", () => {
  // doc > [P > [a, b, c], Q > []]   move [a, b] into empty Q
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "Q" }),
        buildBlock({ id: "P", type: "section", parentId: "doc", nextSiblingId: "Q", firstChildId: "a", lastChildId: "c" }),
        buildBlock({ id: "Q", type: "section", parentId: "doc", prevSiblingId: "P" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "P", nextSiblingId: "b", inlineContent: inlineContent([]) }),
        buildBlock({ id: "b", type: "paragraph", parentId: "P", prevSiblingId: "a", nextSiblingId: "c", inlineContent: inlineContent([]) }),
        buildBlock({ id: "c", type: "paragraph", parentId: "P", prevSiblingId: "b", inlineContent: inlineContent([]) }),
      ],
    });

  it("Q.firstChildId/lastChildId become the run ends", () => {
    const state = fixture();
    const result = reparentChildren(state, ["a" as BlockId, "b" as BlockId], "Q" as BlockId);
    // Q gets [a, b]
    expect(getBlock(result.state, "Q" as BlockId)?.firstChildId).toBe("a");
    expect(getBlock(result.state, "Q" as BlockId)?.lastChildId).toBe("b");
    expect(pointers(result.state, "a")).toEqual({
      parentId: "Q",
      prevSiblingId: null,
      nextSiblingId: "b",
      firstChildId: null,
      lastChildId: null,
    });
    expect(pointers(result.state, "b")).toEqual({
      parentId: "Q",
      prevSiblingId: "a",
      nextSiblingId: null,
      firstChildId: null,
      lastChildId: null,
    });
    // P now [c] only
    expect(getBlock(result.state, "P" as BlockId)?.firstChildId).toBe("c");
    expect(getBlock(result.state, "P" as BlockId)?.lastChildId).toBe("c");
    expect(getBlock(result.state, "c" as BlockId)?.prevSiblingId).toBeNull();
  });
});

describe("reparentChildren — validation", () => {
  const fixture = () =>
    buildState({
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
    const state = fixture();
    expect(() =>
      reparentChildren(state, ["missing" as BlockId], "Q" as BlockId),
    ).toThrow(/block "missing" not found/);
  });

  it("throws when newParent is a leaf (inlineContent !== null)", () => {
    const state = fixture();
    // x is a paragraph (leaf) — cannot be a container.
    expect(() =>
      reparentChildren(state, ["a" as BlockId], "x" as BlockId),
    ).toThrow();
  });

  it("throws when newParent does not exist", () => {
    const state = fixture();
    expect(() =>
      reparentChildren(state, ["a" as BlockId], "missing" as BlockId),
    ).toThrow();
  });

  it("throws on a non-contiguous run", () => {
    // [a, x] are not contiguous siblings (a is under P, x under Q) — and even
    // within one parent, a non-adjacent pair must throw.
    const state = fixture();
    expect(() =>
      reparentChildren(state, ["a" as BlockId, "x" as BlockId], "doc" as BlockId),
    ).toThrow(/contiguous/i);
  });

  it("throws when moved blocks span two parents", () => {
    const state = fixture();
    // a (under P) and x (under Q): not a single-parent run.
    expect(() =>
      reparentChildren(state, ["a" as BlockId, "x" as BlockId], "Q" as BlockId),
    ).toThrow();
  });

  it("throws on a cycle (reparent an ancestor under its descendant)", () => {
    // Move P under Q-descendant? Build a deeper tree so that newParent is a
    // descendant of the moved block.
    // doc > [P > [child > [grand]]]   move [P] under grand → cycle.
    const cyclic = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "P" }),
        buildBlock({ id: "P", type: "section", parentId: "doc", firstChildId: "child", lastChildId: "child" }),
        buildBlock({ id: "child", type: "section", parentId: "P", firstChildId: "grand", lastChildId: "grand" }),
        buildBlock({ id: "grand", type: "section", parentId: "child" }),
      ],
    });
    expect(() =>
      reparentChildren(cyclic, ["P" as BlockId], "grand" as BlockId),
    ).toThrow(/cannot reparent a block under its own descendant/);
  });

  it("throws when beforeSiblingId is not a child of newParent", () => {
    const state = fixture();
    // Move [b] into Q before "a". "a" is a child of P (not Q) and is NOT in the
    // moved set — so this exercises the "not a child of newParent" rule (V5),
    // not the "beforeSiblingId ∈ moved" rule (V6).
    expect(() =>
      reparentChildren(state, ["b" as BlockId], "Q" as BlockId, "a" as BlockId),
    ).toThrow(/is not a child of newParent/);
  });

  it("throws when beforeSiblingId is one of the moved blocks", () => {
    const state = fixture();
    // Move [a, b] under P (same parent) before a — a is in the moved set.
    expect(() =>
      reparentChildren(state, ["a" as BlockId, "b" as BlockId], "P" as BlockId, "a" as BlockId),
    ).toThrow(/beforeSiblingId cannot be one of the moved blocks/);
  });
});

describe("reparentChildren — no-op (empty blockIds)", () => {
  it("returns the same state reference and empty dirtyIds", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "P" }),
        buildBlock({ id: "P", type: "section", parentId: "doc" }),
      ],
    });
    const result = reparentChildren(state, [], "P" as BlockId);
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
  });
});

describe("reparentChildren — self-move identity no-op", () => {
  // doc > [P > [a, b, c]]
  const fixture = () =>
    buildState({
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
    const state = fixture();
    // [c] is already the last child of P; appending it to P changes nothing.
    const result = reparentChildren(state, ["c" as BlockId], "P" as BlockId);
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
  });

  it("inserting the run before its current next sibling is a no-op", () => {
    const state = fixture();
    // [a] is already immediately before b; inserting it before b changes nothing.
    const result = reparentChildren(state, ["a" as BlockId], "P" as BlockId, "b" as BlockId);
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
  });
});

describe("computeReparentWrites — pure unit tests", () => {
  /** Sort + stringify a write-list for order-insensitive comparison. */
  function asSet(writes: readonly BlockFieldWrite[]): Set<string> {
    return new Set(writes.map((w) => `${w.blockId}.${w.field}=${w.value ?? "null"}`));
  }

  it("append into a non-empty new parent (single block, middle of source)", () => {
    // source P [a, b, c], Q [x]; move [b] append into Q.
    const writes = computeReparentWrites({
      moved: ["b" as BlockId],
      sourceParentId: "P" as BlockId,
      sourceFirstChildId: "a" as BlockId,
      sourceLastChildId: "c" as BlockId,
      movedPrevSiblingId: "a" as BlockId,
      movedNextSiblingId: "c" as BlockId,
      newParentId: "Q" as BlockId,
      newParentLastChildId: "x" as BlockId,
      beforeSiblingId: null,
      beforeSiblingPrevId: null,
    });
    const set = asSet(writes);
    // Detach: a.next=c, c.prev=a (P boundaries unchanged since b is middle)
    expect(set.has("a.nextSiblingId=c")).toBe(true);
    expect(set.has("c.prevSiblingId=a")).toBe(true);
    // Re-parent: b.parent=Q
    expect(set.has("b.parentId=Q")).toBe(true);
    // Append: b.prev=x, b.next=null, x.next=b, Q.last=b
    expect(set.has("b.prevSiblingId=x")).toBe(true);
    expect(set.has("b.nextSiblingId=null")).toBe(true);
    expect(set.has("x.nextSiblingId=b")).toBe(true);
    expect(set.has("Q.lastChildId=b")).toBe(true);
    // Q.firstChildId is NOT rewritten (newParentLastChildId was non-null).
    expect(set.has("Q.firstChildId=b")).toBe(false);
  });

  it("before an existing child of new parent", () => {
    // Q [y1, y2]; move run [b2, b3] before y2.
    const writes = computeReparentWrites({
      moved: ["b2" as BlockId, "b3" as BlockId],
      sourceParentId: "P" as BlockId,
      sourceFirstChildId: "b1" as BlockId,
      sourceLastChildId: "b4" as BlockId,
      movedPrevSiblingId: "b1" as BlockId,
      movedNextSiblingId: "b4" as BlockId,
      newParentId: "Q" as BlockId,
      newParentLastChildId: "y2" as BlockId,
      beforeSiblingId: "y2" as BlockId,
      beforeSiblingPrevId: "y1" as BlockId,
    });
    const set = asSet(writes);
    // Detach: b1.next=b4, b4.prev=b1
    expect(set.has("b1.nextSiblingId=b4")).toBe(true);
    expect(set.has("b4.prevSiblingId=b1")).toBe(true);
    // Re-parent both
    expect(set.has("b2.parentId=Q")).toBe(true);
    expect(set.has("b3.parentId=Q")).toBe(true);
    // Insert before y2: m0=b2.prev=y1, mk=b3.next=y2, y2.prev=b3, y1.next=b2
    expect(set.has("b2.prevSiblingId=y1")).toBe(true);
    expect(set.has("b3.nextSiblingId=y2")).toBe(true);
    expect(set.has("y2.prevSiblingId=b3")).toBe(true);
    expect(set.has("y1.nextSiblingId=b2")).toBe(true);
    // run-internal chain (b2.next=b3, b3.prev=b2) is preserved — NOT rewritten.
    expect(set.has("b2.nextSiblingId=b3")).toBe(false);
    expect(set.has("b3.prevSiblingId=b2")).toBe(false);
  });

  it("into an empty new parent", () => {
    // Q empty; move [a, b] append.
    const writes = computeReparentWrites({
      moved: ["a" as BlockId, "b" as BlockId],
      sourceParentId: "P" as BlockId,
      sourceFirstChildId: "a" as BlockId,
      sourceLastChildId: "c" as BlockId,
      movedPrevSiblingId: null,
      movedNextSiblingId: "c" as BlockId,
      newParentId: "Q" as BlockId,
      newParentLastChildId: null,
      beforeSiblingId: null,
      beforeSiblingPrevId: null,
    });
    const set = asSet(writes);
    // Detach: a was first child → P.first=c (movedNext); c.prev=null (movedPrev)
    expect(set.has("P.firstChildId=c")).toBe(true);
    expect(set.has("c.prevSiblingId=null")).toBe(true);
    // Re-parent both
    expect(set.has("a.parentId=Q")).toBe(true);
    expect(set.has("b.parentId=Q")).toBe(true);
    // Append into empty Q: m0=a.prev=null, mk=b.next=null, Q.first=a, Q.last=b
    expect(set.has("a.prevSiblingId=null")).toBe(true);
    expect(set.has("b.nextSiblingId=null")).toBe(true);
    expect(set.has("Q.firstChildId=a")).toBe(true);
    expect(set.has("Q.lastChildId=b")).toBe(true);
  });

  it("returns [] for an empty moved list", () => {
    expect(
      computeReparentWrites({
        moved: [],
        sourceParentId: "P" as BlockId,
        sourceFirstChildId: null,
        sourceLastChildId: null,
        movedPrevSiblingId: null,
        movedNextSiblingId: null,
        newParentId: "Q" as BlockId,
        newParentLastChildId: null,
        beforeSiblingId: null,
        beforeSiblingPrevId: null,
      }),
    ).toEqual([]);
  });
});

describe("reparentChildrenInTx — transaction guard", () => {
  it("throws when called outside any Y.Doc transaction", () => {
    // doc > [P > [c1], Q]; move c1 from P to Q.
    const state = buildState({
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
        }),
        buildBlock({
          id: "c1",
          type: "paragraph",
          parentId: "P",
          inlineContent: inlineContent([]),
        }),
      ],
    });
    const plan = planReparentChildren(state, ["c1" as BlockId], "Q" as BlockId, null);
    expect(plan.writes.length).toBeGreaterThan(0);
    expect(() => reparentChildrenInTx(state[STATE_INTERNAL].doc, plan)).toThrow(
      /reparentChildren: must be called inside Y\.Doc\.transact/,
    );
  });
});
