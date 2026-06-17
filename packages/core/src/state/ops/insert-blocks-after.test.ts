import { describe, it, expect } from "vitest";
import {
  insertBlocksAfter,
  planInsertBlocksAfter,
  insertBlocksAfterInTx,
} from "./insert-blocks-after";
import { getBlock, applyOperation } from "../state";
import { STATE_INTERNAL } from "../state-internal";
import { buildBlock, buildState, inlineContent, text } from "../../test-utils/state-builders";
import { createTestAllocator } from "../block-id";
import type { BlockId } from "../block-id";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

// doc > [p1, p2, p3]
const fixture = () =>
  buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
      buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
      buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([]) }),
      buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([]) }),
    ],
  });

describe("insertBlocksAfter — middle insert (one block)", () => {
  it("(a) splices one block after a middle child; parent NOT dirty", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlocksAfter(
      state,
      "p1" as BlockId,
      [{ type: "paragraph", inlineContent: inlineContent([]) }],
      allocator,
    );
    expect(result.newBlockIds).toEqual(["new-0"]);
    const newId = "new-0" as BlockId;

    // New block linkage: afterBlock → new → oldNext.
    const newBlock = getBlock(result.state, newId);
    expect(newBlock?.type).toBe("paragraph");
    expect(newBlock?.parentId).toBe("doc");
    expect(newBlock?.prevSiblingId).toBe("p1");
    expect(newBlock?.nextSiblingId).toBe("p2");

    // afterBlock.next → new.
    expect(getBlock(result.state, "p1" as BlockId)?.nextSiblingId).toBe(newId);
    // oldNext.prev → new.
    expect(getBlock(result.state, "p2" as BlockId)?.prevSiblingId).toBe(newId);

    // parent boundaries unchanged.
    expect(getBlock(result.state, "doc" as BlockId)?.firstChildId).toBe("p1");
    expect(getBlock(result.state, "doc" as BlockId)?.lastChildId).toBe("p3");
    expect(result.dirtyIds.has("doc" as BlockId)).toBe(false);
  });
});

describe("insertBlocksAfter — append after last child (three blocks)", () => {
  it("(b) sets parent.lastChildId to run tail; chain correct; parent IN dirtyIds", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlocksAfter(
      state,
      "p3" as BlockId,
      [
        { type: "paragraph", inlineContent: inlineContent([]) },
        { type: "paragraph", inlineContent: inlineContent([]) },
        { type: "paragraph", inlineContent: inlineContent([]) },
      ],
      allocator,
    );
    expect(result.newBlockIds).toEqual(["new-0", "new-1", "new-2"]);
    const n0 = nth(result.newBlockIds, 0, "new block");
    const n1 = nth(result.newBlockIds, 1, "new block");
    const n2 = nth(result.newBlockIds, 2, "new block");

    // afterBlock.next → first new.
    expect(getBlock(result.state, "p3" as BlockId)?.nextSiblingId).toBe(n0);

    // first new.prev → afterBlock; last new.next → null (was last child).
    expect(getBlock(result.state, n0)?.prevSiblingId).toBe("p3");
    expect(getBlock(result.state, n2)?.nextSiblingId).toBeNull();

    // parent.lastChildId now the run tail; firstChildId unchanged.
    expect(getBlock(result.state, "doc" as BlockId)?.lastChildId).toBe(n2);
    expect(getBlock(result.state, "doc" as BlockId)?.firstChildId).toBe("p1");

    // parent IS dirty on append.
    expect(result.dirtyIds.has("doc" as BlockId)).toBe(true);

    // sanity: all new parents → doc.
    expect(getBlock(result.state, n0)?.parentId).toBe("doc");
    expect(getBlock(result.state, n1)?.parentId).toBe("doc");
    expect(getBlock(result.state, n2)?.parentId).toBe("doc");
  });
});

describe("insertBlocksAfter — order preserved", () => {
  it("(c) newBlockIds[i].nextSiblingId === newBlockIds[i+1]", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlocksAfter(
      state,
      "p1" as BlockId,
      [
        { type: "paragraph", inlineContent: inlineContent([]) },
        { type: "paragraph", inlineContent: inlineContent([]) },
        { type: "paragraph", inlineContent: inlineContent([]) },
      ],
      allocator,
    );
    const ids = result.newBlockIds;
    for (let i = 0; i < ids.length - 1; i++) {
      expect(getBlock(result.state, nth(ids, i, "id"))?.nextSiblingId).toBe(ids[i + 1]);
      expect(getBlock(result.state, nth(ids, i + 1, "id"))?.prevSiblingId).toBe(ids[i]);
    }
    // run boundaries.
    expect(getBlock(result.state, nth(ids, 0, "id"))?.prevSiblingId).toBe("p1");
    expect(getBlock(result.state, nth(ids, ids.length - 1, "id"))?.nextSiblingId).toBe("p2");
  });
});

describe("insertBlocksAfter — empty inits", () => {
  it("(d) returns same State ref, empty newBlockIds, empty dirtyIds, no transaction", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlocksAfter(state, "p1" as BlockId, [], allocator);
    expect(result.state).toBe(state);
    expect(result.newBlockIds).toEqual([]);
    expect(result.dirtyIds.size).toBe(0);
  });
});

describe("insertBlocksAfter — error cases", () => {
  it("(e) throws when afterBlockId is missing", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    expect(() =>
      insertBlocksAfter(state, "missing" as BlockId, [{ type: "paragraph" }], allocator),
    ).toThrow(/afterBlock "missing" not found/);
  });

  it("(e) throws when afterBlock has a null parent (the root)", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    expect(() =>
      insertBlocksAfter(state, "doc" as BlockId, [{ type: "paragraph" }], allocator),
    ).toThrow(/afterBlock "doc" has null parent/);
  });
});

describe("insertBlocksAfter — dirtyIds exactness", () => {
  it("(f-middle) dirtyIds === {newIds, afterBlockId, oldNext}", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlocksAfter(
      state,
      "p1" as BlockId,
      [{ type: "paragraph", inlineContent: inlineContent([]) }],
      allocator,
    );
    // new block, p1 (afterBlock.next rewired), p2 (oldNext.prev rewired). NOT doc.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["new-0", "p1", "p2"]));
  });

  it("(f-append) dirtyIds === {newIds, afterBlockId, parent}", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlocksAfter(
      state,
      "p3" as BlockId,
      [{ type: "paragraph", inlineContent: inlineContent([]) }],
      allocator,
    );
    // new block, p3 (afterBlock.next rewired), doc (parent.lastChildId rewired). NOT p2.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["new-0", "p3", "doc"]));
  });
});

describe("insertBlocksAfter — inlineContent passthrough", () => {
  it("(g) round-trips inlineContent text", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlocksAfter(
      state,
      "p1" as BlockId,
      [{ type: "paragraph", inlineContent: inlineContent([text("hello world")]) }],
      allocator,
    );
    const newBlock = getBlock(result.state, "new-0" as BlockId);
    expect(newBlock?.inlineContent?.items.length).toBe(1);
    const item = newBlock?.inlineContent?.items[0];
    expect(item).toBeDefined();
    if (item === undefined || item.kind !== "text") {
      throw new Error("expected a text item (guarded above)");
    }
    expect(item.text).toBe("hello world");
  });

  it("(g2) omitted inlineContent defaults to null (container-shaped), matching insertBlock", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlocksAfter(
      state,
      "p1" as BlockId,
      [{ type: "section" }],
      allocator,
    );
    // No inlineContent provided → null, NOT { items: [] }.
    expect(getBlock(result.state, "new-0" as BlockId)?.inlineContent).toBeNull();
  });
});

describe("planInsertBlocksAfter / insertBlocksAfterInTx — composition primitive", () => {
  it("(i) drives the run through an open transaction: ids, ordering, boundary relink", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const plan = planInsertBlocksAfter(
      state,
      "p1" as BlockId,
      [
        { type: "paragraph", inlineContent: inlineContent([]) },
        { type: "paragraph", inlineContent: inlineContent([]) },
      ],
      allocator,
    );
    expect(plan).not.toBeNull();
    if (plan === null) return;

    // Plan captured the pre-mutation boundary.
    expect(plan.parentId).toBe("doc");
    expect(plan.afterBlockId).toBe("p1");
    expect(plan.oldNextId).toBe("p2");
    expect(plan.entries.map((e) => e.id)).toEqual(["new-0", "new-1"]);

    // Drive the InTx primitive directly through applyOperation (which opens
    // the surrounding transaction and yields a fresh State snapshot to read
    // back from) — the same harness the public op uses internally.
    const { state: next } = applyOperation(state, () => {
      insertBlocksAfterInTx(state[STATE_INTERNAL].doc, plan);
    });

    const entryIds = plan.entries.map((e) => e.id);
    const n0 = nth(entryIds, 0, "entry id");
    const n1 = nth(entryIds, 1, "entry id");

    // afterBlock.next → run head; oldNext.prev → run tail.
    expect(getBlock(next, "p1" as BlockId)?.nextSiblingId).toBe(n0);
    expect(getBlock(next, "p2" as BlockId)?.prevSiblingId).toBe(n1);

    // Run chain + boundaries.
    expect(getBlock(next, n0)?.prevSiblingId).toBe("p1");
    expect(getBlock(next, n0)?.nextSiblingId).toBe(n1);
    expect(getBlock(next, n1)?.prevSiblingId).toBe(n0);
    expect(getBlock(next, n1)?.nextSiblingId).toBe("p2");
    expect(getBlock(next, n0)?.parentId).toBe("doc");
    expect(getBlock(next, n1)?.parentId).toBe("doc");

    // Middle insert: parent boundaries unchanged.
    expect(getBlock(next, "doc" as BlockId)?.firstChildId).toBe("p1");
    expect(getBlock(next, "doc" as BlockId)?.lastChildId).toBe("p3");
  });

  it("(i2) appended run rewires parent.lastChildId to the run tail", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const plan = planInsertBlocksAfter(
      state,
      "p3" as BlockId,
      [{ type: "paragraph", inlineContent: inlineContent([]) }],
      allocator,
    );
    expect(plan).not.toBeNull();
    if (plan === null) return;
    expect(plan.oldNextId).toBeNull();

    const { state: next } = applyOperation(state, () => {
      insertBlocksAfterInTx(state[STATE_INTERNAL].doc, plan);
    });

    const tail = nth(plan.entries, plan.entries.length - 1, "entry").id;
    expect(getBlock(next, "p3" as BlockId)?.nextSiblingId).toBe(tail);
    expect(getBlock(next, tail)?.nextSiblingId).toBeNull();
    expect(getBlock(next, "doc" as BlockId)?.lastChildId).toBe(tail);
  });

  it("(i3) planInsertBlocksAfter returns null for empty inits", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    expect(planInsertBlocksAfter(state, "p1" as BlockId, [], allocator)).toBeNull();
  });

  it("(i4) insertBlocksAfterInTx throws when called outside any Y.Doc transaction", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const plan = planInsertBlocksAfter(
      state,
      "p1" as BlockId,
      [{ type: "paragraph", inlineContent: inlineContent([]) }],
      allocator,
    );
    expect(plan).not.toBeNull();
    if (plan === null) return;
    expect(() => insertBlocksAfterInTx(state[STATE_INTERNAL].doc, plan)).toThrow(
      /insertBlocksAfter: must be called inside Y\.Doc\.transact/,
    );
  });
});

describe("insertBlocksAfter — insert after the ONLY child of a parent", () => {
  it("(h) updates parent.lastChildId to run tail; firstChildId + only-child.prev untouched", () => {
    // doc > sec > [only]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "sec", lastChildId: "sec" }),
        buildBlock({ id: "sec", type: "section", parentId: "doc", firstChildId: "only", lastChildId: "only" }),
        buildBlock({ id: "only", type: "paragraph", parentId: "sec", inlineContent: inlineContent([]) }),
      ],
    });
    const allocator = createTestAllocator("new");
    const result = insertBlocksAfter(
      state,
      "only" as BlockId,
      [
        { type: "paragraph", inlineContent: inlineContent([]) },
        { type: "paragraph", inlineContent: inlineContent([]) },
      ],
      allocator,
    );
    const n0 = nth(result.newBlockIds, 0, "new block");
    const n1 = nth(result.newBlockIds, 1, "new block");
    // only-child is both first and last; appending leaves firstChildId, moves lastChildId.
    expect(getBlock(result.state, "sec" as BlockId)?.firstChildId).toBe("only");
    expect(getBlock(result.state, "sec" as BlockId)?.lastChildId).toBe(n1);
    // The original only-child stays the head: prev null, next → first new.
    expect(getBlock(result.state, "only" as BlockId)?.prevSiblingId).toBeNull();
    expect(getBlock(result.state, "only" as BlockId)?.nextSiblingId).toBe(n0);
    // Run chain + tail terminates.
    expect(getBlock(result.state, n0)?.prevSiblingId).toBe("only");
    expect(getBlock(result.state, n1)?.nextSiblingId).toBeNull();
    // Append path → parent (sec) is dirty.
    expect(result.dirtyIds.has("sec" as BlockId)).toBe(true);
  });
});
