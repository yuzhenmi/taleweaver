import { describe, it, expect } from "vitest";
import {
  applySectionBreak,
  buildSectionBreakPlan,
  applySectionBreakInTx,
} from "./section-break";
import { applyOperation, getBlock } from "../state";
import { createPosition } from "../block-position";
import { firstLeafBlock } from "../block-traversal";
import { createTestAllocator } from "../block-id";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import { STATE_INTERNAL } from "../state-internal";
import type { BlockId } from "../block-id";

/**
 * Read every structural pointer of a block as a plain object so assertions
 * can compare the whole 5-pointer shape at once.
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

/** Walk a container's child chain via firstChildId/nextSiblingId. */
function childIds(state: ReturnType<typeof buildState>, parentId: string): string[] {
  const parent = getBlock(state, parentId as BlockId);
  if (parent === null) throw new Error(`block ${parentId} not found`);
  const out: string[] = [];
  let cur = parent.firstChildId;
  let guard = 0;
  while (cur !== null) {
    if (++guard > 10000) throw new Error("childIds: runaway chain");
    out.push(cur);
    const b = getBlock(state, cur);
    if (b === null) throw new Error(`block ${cur} not found mid-chain`);
    cur = b.nextSiblingId;
  }
  return out;
}

const bid = (s: string) => s as BlockId;

describe("applySectionBreak — implicit doc [p1,p2,p3,p4], cursor in p3", () => {
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p4" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", nextSiblingId: "p4", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p4", type: "paragraph", parentId: "doc", prevSiblingId: "p3", inlineContent: inlineContent([]) }),
      ],
    });

  it("splits root into two sections A=[p1,p2], B=[p3,p4]", () => {
    const state = fixture();
    const result = applySectionBreak(state, createPosition(bid("p3"), 0), createTestAllocator("sec"));

    // Root now has exactly two children, both sections.
    const rootChildren = childIds(result.state, "doc");
    expect(rootChildren.length).toBe(2);
    const [aId, bId] = rootChildren;
    if (aId === undefined || bId === undefined) throw new Error("missing section ids");

    const a = getBlock(result.state, bid(aId));
    const b = getBlock(result.state, bid(bId));
    if (a === null || b === null) throw new Error("sections not found");
    expect(a.type).toBe("section");
    expect(b.type).toBe("section");
    expect(a.parentId).toBe("doc");
    expect(b.parentId).toBe("doc");
    expect(a.attrs).toEqual({});
    expect(b.attrs).toEqual({});

    // A children [p1,p2]; B children [p3,p4].
    expect(childIds(result.state, aId)).toEqual(["p1", "p2"]);
    expect(childIds(result.state, bId)).toEqual(["p3", "p4"]);

    // Section sibling chain: A.prev=null, A.next=B, B.prev=A, B.next=null.
    expect(pointers(result.state, aId)).toEqual({
      parentId: "doc",
      prevSiblingId: null,
      nextSiblingId: bId,
      firstChildId: "p1",
      lastChildId: "p2",
    });
    expect(pointers(result.state, bId)).toEqual({
      parentId: "doc",
      prevSiblingId: aId,
      nextSiblingId: null,
      firstChildId: "p3",
      lastChildId: "p4",
    });

    // root pointers
    expect(getBlock(result.state, bid("doc"))?.firstChildId).toBe(aId);
    expect(getBlock(result.state, bid("doc"))?.lastChildId).toBe(bId);

    // Moved blocks' parents updated; internal chains preserved.
    expect(pointers(result.state, "p1")).toEqual({
      parentId: aId,
      prevSiblingId: null,
      nextSiblingId: "p2",
      firstChildId: null,
      lastChildId: null,
    });
    expect(pointers(result.state, "p2")).toEqual({
      parentId: aId,
      prevSiblingId: "p1",
      nextSiblingId: null,
      firstChildId: null,
      lastChildId: null,
    });
    expect(pointers(result.state, "p3")).toEqual({
      parentId: bId,
      prevSiblingId: null,
      nextSiblingId: "p4",
      firstChildId: null,
      lastChildId: null,
    });
    expect(pointers(result.state, "p4")).toEqual({
      parentId: bId,
      prevSiblingId: "p3",
      nextSiblingId: null,
      firstChildId: null,
      lastChildId: null,
    });
  });

  it("returns newCursorBlockId === firstLeaf(p3) and dirtyIds ⊇ {root,A,B,p1..p4}", () => {
    const state = fixture();
    const result = applySectionBreak(state, createPosition(bid("p3"), 0), createTestAllocator("sec"));

    const rootChildren = childIds(result.state, "doc");
    const [aId, bId] = rootChildren;
    if (aId === undefined || bId === undefined) throw new Error("missing section ids");

    expect(result.newCursorBlockId).toBe(firstLeafBlock(result.state, bid("p3")));
    // p3 is a leaf, so firstLeaf(p3) === p3.
    expect(result.newCursorBlockId).toBe("p3");

    const ids = new Set(result.dirtyIds);
    for (const id of ["doc", aId, bId, "p1", "p2", "p3", "p4"]) {
      expect(ids.has(id as BlockId)).toBe(true);
    }
  });
});

describe("applySectionBreak — break-at-start no-op (implicit)", () => {
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });

  it("cursor in p1 (first top-level block) → state unchanged, dirtyIds empty, cursor === p1", () => {
    const state = fixture();
    const result = applySectionBreak(state, createPosition(bid("p1"), 0), createTestAllocator("sec"));
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
    expect(result.newCursorBlockId).toBe("p1");
    // No section was created: root children unchanged.
    expect(childIds(result.state, "doc")).toEqual(["p1", "p2"]);
  });
});

describe("applySectionBreak — nested boundary (cursor inside a nested container's child)", () => {
  // root → [p1, tbl([li1,li2]), p2]; cursor in li1 → boundary = tbl.
  // (`tbl` is a generic CONTAINER; applySectionBreak is a pure state op and
  // does not validate component kinds — list-item children just exercise the
  // first-leaf walk.)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "tbl", inlineContent: inlineContent([]) }),
        buildBlock({ id: "tbl", type: "table", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p2", firstChildId: "li1", lastChildId: "li2" }),
        buildBlock({ id: "li1", type: "list-item", parentId: "tbl", nextSiblingId: "li2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "li2", type: "list-item", parentId: "tbl", prevSiblingId: "li1", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "tbl", inlineContent: inlineContent([]) }),
      ],
    });

  it("boundary is the top-level container; A=[p1], B=[tbl,p2]; cursor === firstLeaf(tbl)=li1", () => {
    const state = fixture();
    const result = applySectionBreak(state, createPosition(bid("li1"), 0), createTestAllocator("sec"));

    const rootChildren = childIds(result.state, "doc");
    expect(rootChildren.length).toBe(2);
    const [aId, bId] = rootChildren;
    if (aId === undefined || bId === undefined) throw new Error("missing section ids");

    expect(childIds(result.state, aId)).toEqual(["p1"]);
    expect(childIds(result.state, bId)).toEqual(["tbl", "p2"]);

    // The container keeps its children intact; only its parent moved.
    expect(childIds(result.state, "tbl")).toEqual(["li1", "li2"]);
    expect(getBlock(result.state, bid("tbl"))?.parentId).toBe(bId);

    expect(result.newCursorBlockId).toBe(firstLeafBlock(result.state, bid("tbl")));
    expect(result.newCursorBlockId).toBe("li1");
  });
});

describe("applySectionBreak — explicit split of an existing section", () => {
  // root → [S([p1,p2,p3])]; cursor in p2 → root [S,S']; S=[p1]; S'=[p2,p3].
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "S", lastChildId: "S" }),
        buildBlock({ id: "S", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "S", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "S", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "S", prevSiblingId: "p2", inlineContent: inlineContent([]) }),
      ],
    });

  it("creates S' after S; S keeps [p1]; S' takes [p2,p3]; cursor === firstLeaf(p2)", () => {
    const state = fixture();
    const result = applySectionBreak(state, createPosition(bid("p2"), 0), createTestAllocator("sec"));

    const rootChildren = childIds(result.state, "doc");
    expect(rootChildren.length).toBe(2);
    const [sId, sPrimeId] = rootChildren;
    if (sId === undefined || sPrimeId === undefined) throw new Error("missing section ids");
    expect(sId).toBe("S");

    const sPrime = getBlock(result.state, bid(sPrimeId));
    if (sPrime === null) throw new Error("S' not found");
    expect(sPrime.type).toBe("section");
    expect(sPrime.parentId).toBe("doc");
    expect(sPrime.attrs).toEqual({});

    expect(childIds(result.state, "S")).toEqual(["p1"]);
    expect(childIds(result.state, sPrimeId)).toEqual(["p2", "p3"]);

    // S keeps p1, lastChild updated, next=S'
    expect(pointers(result.state, "S")).toEqual({
      parentId: "doc",
      prevSiblingId: null,
      nextSiblingId: sPrimeId,
      firstChildId: "p1",
      lastChildId: "p1",
    });
    // S' is a flat doc-root sibling after S
    expect(pointers(result.state, sPrimeId)).toEqual({
      parentId: "doc",
      prevSiblingId: "S",
      nextSiblingId: null,
      firstChildId: "p2",
      lastChildId: "p3",
    });
    // root.lastChildId became S'
    expect(getBlock(result.state, bid("doc"))?.lastChildId).toBe(sPrimeId);

    // p1 detached from p2 in S
    expect(getBlock(result.state, bid("p1"))?.nextSiblingId).toBe(null);
    // p2 head of S'
    expect(pointers(result.state, "p2")).toEqual({
      parentId: sPrimeId,
      prevSiblingId: null,
      nextSiblingId: "p3",
      firstChildId: null,
      lastChildId: null,
    });
    expect(pointers(result.state, "p3")).toEqual({
      parentId: sPrimeId,
      prevSiblingId: "p2",
      nextSiblingId: null,
      firstChildId: null,
      lastChildId: null,
    });

    expect(result.newCursorBlockId).toBe(firstLeafBlock(result.state, bid("p2")));
    expect(result.newCursorBlockId).toBe("p2");
  });

  it("relinks sOldNext when S is not the last doc-root section", () => {
    // root → [S([p1,p2]), T([q1])]; cursor in p2 → root [S, S', T].
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "S", lastChildId: "T" }),
        buildBlock({ id: "S", type: "section", parentId: "doc", nextSiblingId: "T", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "T", type: "section", parentId: "doc", prevSiblingId: "S", firstChildId: "q1", lastChildId: "q1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "S", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "S", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
        buildBlock({ id: "q1", type: "paragraph", parentId: "T", inlineContent: inlineContent([]) }),
      ],
    });
    const result = applySectionBreak(state, createPosition(bid("p2"), 0), createTestAllocator("sec"));

    const rootChildren = childIds(result.state, "doc");
    expect(rootChildren.length).toBe(3);
    const [sId, sPrimeId, tId] = rootChildren;
    expect(sId).toBe("S");
    expect(tId).toBe("T");
    if (sPrimeId === undefined) throw new Error("missing S'");

    expect(childIds(result.state, "S")).toEqual(["p1"]);
    expect(childIds(result.state, sPrimeId)).toEqual(["p2"]);

    // S' threads between S and T.
    expect(getBlock(result.state, bid("S"))?.nextSiblingId).toBe(sPrimeId);
    expect(getBlock(result.state, bid(sPrimeId))?.prevSiblingId).toBe("S");
    expect(getBlock(result.state, bid(sPrimeId))?.nextSiblingId).toBe("T");
    expect(getBlock(result.state, bid("T"))?.prevSiblingId).toBe(sPrimeId);
    // root.lastChildId stays T.
    expect(getBlock(result.state, bid("doc"))?.lastChildId).toBe("T");
  });
});

describe("applySectionBreak — explicit break-at-start no-op", () => {
  // root → [S([p1,p2])]; cursor in p1 (S's first child) → no-op.
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "S", lastChildId: "S" }),
        buildBlock({ id: "S", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "S", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "S", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });

  it("cursor in p1 → state unchanged, no S' created, cursor === p1", () => {
    const state = fixture();
    const result = applySectionBreak(state, createPosition(bid("p1"), 0), createTestAllocator("sec"));
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
    expect(result.newCursorBlockId).toBe("p1");
    expect(childIds(result.state, "doc")).toEqual(["S"]);
  });
});

describe("applySectionBreak — atomicity (single applyOperation)", () => {
  it("returns one consistent OperationResult: all created + moved blocks coherent in the single returned state", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p4" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", nextSiblingId: "p4", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p4", type: "paragraph", parentId: "doc", prevSiblingId: "p3", inlineContent: inlineContent([]) }),
      ],
    });
    const result = applySectionBreak(state, createPosition(bid("p3"), 0), createTestAllocator("sec"));

    // Single-transaction proof: ONE applyOperation captures every block touched
    // by BOTH the before→A and atAfter→B reparents in one dirtyIds set. A
    // two-transaction implementation would return only the second transaction's
    // change record, dropping the first run's blocks — so asserting that
    // dirtyIds covers the union {doc, A, B, p1..p4} fails any split impl.
    const [aId, bId] = childIds(result.state, "doc");
    if (aId === undefined || bId === undefined) throw new Error("missing section ids");
    const dirty = new Set(result.dirtyIds);
    for (const id of ["doc", aId, bId, "p1", "p2", "p3", "p4"]) {
      expect(dirty.has(id as BlockId)).toBe(true);
    }

    // Every block in the result is internally consistent: each non-root block's
    // parentId names a block that lists it as a child (chain reachable from root).
    const reachable = new Set<string>();
    const visit = (id: string) => {
      if (reachable.has(id)) return;
      reachable.add(id);
      for (const c of childIds(result.state, id)) visit(c);
    };
    visit("doc");
    for (const id of ["p1", "p2", "p3", "p4"]) {
      expect(reachable.has(id)).toBe(true);
    }
    // Exactly two sections + root + 4 paragraphs reachable.
    expect(reachable.size).toBe(7);
  });
});

describe("buildSectionBreakPlan + applySectionBreakInTx — plan/InTx pair", () => {
  it("(implicit) plan drives the same two-section split through applyOperation", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p4" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", nextSiblingId: "p4", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p4", type: "paragraph", parentId: "doc", prevSiblingId: "p3", inlineContent: inlineContent([]) }),
      ],
    });
    const plan = buildSectionBreakPlan(
      state,
      createPosition(bid("p3"), 0),
      createTestAllocator("sec"),
    );
    expect(plan).not.toBeNull();
    if (plan === null) throw new Error("expected a non-null implicit plan");
    expect(plan.kind).toBe("implicit");
    expect(plan.boundary).toBe("p3");

    // Drive the InTx primitive directly through applyOperation (the same
    // harness the public op uses internally).
    const { state: next } = applyOperation(state, (doc) => {
      applySectionBreakInTx(doc, plan);
    });

    const rootChildren = childIds(next, "doc");
    expect(rootChildren.length).toBe(2);
    const [aId, bId] = rootChildren;
    if (aId === undefined || bId === undefined) throw new Error("missing section ids");
    expect(getBlock(next, bid(aId))?.type).toBe("section");
    expect(getBlock(next, bid(bId))?.type).toBe("section");
    expect(childIds(next, aId)).toEqual(["p1", "p2"]);
    expect(childIds(next, bId)).toEqual(["p3", "p4"]);
    expect(pointers(next, aId)).toEqual({
      parentId: "doc",
      prevSiblingId: null,
      nextSiblingId: bId,
      firstChildId: "p1",
      lastChildId: "p2",
    });
    expect(pointers(next, bId)).toEqual({
      parentId: "doc",
      prevSiblingId: aId,
      nextSiblingId: null,
      firstChildId: "p3",
      lastChildId: "p4",
    });
    expect(getBlock(next, bid("doc"))?.firstChildId).toBe(aId);
    expect(getBlock(next, bid("doc"))?.lastChildId).toBe(bId);
  });

  it("(explicit) plan drives the in-place section split through applyOperation", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "S", lastChildId: "T" }),
        buildBlock({ id: "S", type: "section", parentId: "doc", nextSiblingId: "T", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "T", type: "section", parentId: "doc", prevSiblingId: "S", firstChildId: "q1", lastChildId: "q1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "S", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "S", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
        buildBlock({ id: "q1", type: "paragraph", parentId: "T", inlineContent: inlineContent([]) }),
      ],
    });
    const plan = buildSectionBreakPlan(
      state,
      createPosition(bid("p2"), 0),
      createTestAllocator("sec"),
    );
    expect(plan).not.toBeNull();
    if (plan === null) throw new Error("expected a non-null explicit plan");
    expect(plan.kind).toBe("explicit");
    expect(plan.boundary).toBe("p2");

    const { state: next } = applyOperation(state, (doc) => {
      applySectionBreakInTx(doc, plan);
    });

    const rootChildren = childIds(next, "doc");
    expect(rootChildren.length).toBe(3);
    const [sId, sPrimeId, tId] = rootChildren;
    expect(sId).toBe("S");
    expect(tId).toBe("T");
    if (sPrimeId === undefined) throw new Error("missing S'");
    expect(getBlock(next, bid(sPrimeId))?.type).toBe("section");
    expect(childIds(next, "S")).toEqual(["p1"]);
    expect(childIds(next, sPrimeId)).toEqual(["p2"]);
    // S' threads between S and T.
    expect(getBlock(next, bid("S"))?.nextSiblingId).toBe(sPrimeId);
    expect(getBlock(next, bid(sPrimeId))?.prevSiblingId).toBe("S");
    expect(getBlock(next, bid(sPrimeId))?.nextSiblingId).toBe("T");
    expect(getBlock(next, bid("T"))?.prevSiblingId).toBe(sPrimeId);
    expect(getBlock(next, bid("doc"))?.lastChildId).toBe("T");
  });

  it("(no-op) buildSectionBreakPlan returns null when boundary is the container's first child", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });
    const plan = buildSectionBreakPlan(
      state,
      createPosition(bid("p1"), 0),
      createTestAllocator("sec"),
    );
    expect(plan).toBeNull();
  });

  it("(guard) applySectionBreakInTx throws outside any Y.Doc transaction", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([]) }),
      ],
    });
    const plan = buildSectionBreakPlan(
      state,
      createPosition(bid("p2"), 0),
      createTestAllocator("sec"),
    );
    expect(plan).not.toBeNull();
    if (plan === null) throw new Error("expected a non-null plan");
    expect(() => applySectionBreakInTx(state[STATE_INTERNAL].doc, plan)).toThrow(
      /applySectionBreak: must be called inside Y\.Doc\.transact/,
    );
  });
});

describe("applySectionBreak — cursor block not under root throws", () => {
  it("throws when the cursor block's chain does not reach the document root", () => {
    // An orphan block (parentId null, not the root) is not under the doc root.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
        buildBlock({ id: "orphan", type: "paragraph", parentId: null, inlineContent: inlineContent([]) }),
      ],
    });
    expect(() =>
      applySectionBreak(state, createPosition(bid("orphan"), 0), createTestAllocator("sec")),
    ).toThrow(/not under document root/);
  });
});
