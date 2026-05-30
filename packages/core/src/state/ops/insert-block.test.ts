import { describe, it, expect } from "vitest";
import { insertBlock } from "./insert-block";
import { getBlock } from "../state";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import { createTestAllocator } from "../block-id";
import type { BlockId } from "../block-id";
import type { BlockKind, BlockKindResolver } from "../block-kinds";

// Narrow BlockKindResolver covering the built-in taxonomy (mirrors the one in
// set-block-type.test.ts / map-agnostic-ops.test.ts). State ops depend only on
// the BlockKindResolver shape — they don't need the full component registry.
const TYPE_KINDS: Record<string, BlockKind> = {
  document: "container",
  section: "container",
  list: "container",
  paragraph: "inline-bearing-leaf",
  heading: "inline-bearing-leaf",
  "list-item": "inline-bearing-leaf",
  image: "atomic-leaf",
  "horizontal-line": "atomic-leaf",
};
const resolver: BlockKindResolver = {
  getBlockKind: (t) => TYPE_KINDS[t] ?? null,
};

describe("insertBlock — between siblings", () => {
  // doc > [p1, p2]  →  doc > [p1, NEW, p2]
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });

  it("inserts a new block between two siblings, splicing the linked list", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlock(
      state,
      "doc" as BlockId,
      "p2" as BlockId,
      { type: "paragraph", inlineContent: inlineContent([]) },
      allocator,
    );
    const newId = "new-0" as BlockId;

    // New block exists with correct linkage:
    const newBlock = getBlock(result.state, newId);
    expect(newBlock).toBeDefined();
    expect(newBlock?.type).toBe("paragraph");
    expect(newBlock?.parentId).toBe("doc");
    expect(newBlock?.prevSiblingId).toBe("p1");
    expect(newBlock?.nextSiblingId).toBe("p2");

    // p1's nextSiblingId now points to the new block:
    expect(getBlock(result.state, "p1" as BlockId)?.nextSiblingId).toBe(newId);

    // p2's prevSiblingId now points to the new block:
    expect(getBlock(result.state, "p2" as BlockId)?.prevSiblingId).toBe(newId);

    // doc's firstChildId / lastChildId unchanged (still p1 / p2):
    expect(getBlock(result.state, "doc" as BlockId)?.firstChildId).toBe("p1");
    expect(getBlock(result.state, "doc" as BlockId)?.lastChildId).toBe("p2");
  });

  it("returns dirtyIds for new block + both adjacent siblings only — parent unchanged on middle insert", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlock(
      state,
      "doc" as BlockId,
      "p2" as BlockId,
      { type: "paragraph" },
      allocator,
    );
    // Expected dirty: new block, p1 (nextSibling rewired), p2 (prevSibling rewired).
    // Parent (doc) is NOT dirty: neither firstChildId nor lastChildId changed.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["new-0", "p1", "p2"]));
    expect(result.dirtyIds.has("doc" as BlockId)).toBe(false);

    // Snapshot identity preserved for the unchanged parent.
    expect(getBlock(result.state, "doc" as BlockId)).toBe(getBlock(state, "doc" as BlockId));
  });
});

describe("insertBlock — prepend (no prev sibling)", () => {
  // doc > [p1, p2]  →  doc > [NEW, p1, p2]  via beforeSiblingId = "p1"
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });

  it("inserts before the first child and updates parent's firstChildId", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlock(state, "doc" as BlockId, "p1" as BlockId, { type: "paragraph" }, allocator);
    const newId = "new-0" as BlockId;
    const newBlock = getBlock(result.state, newId);
    expect(newBlock?.prevSiblingId).toBeNull();
    expect(newBlock?.nextSiblingId).toBe("p1");
    expect(getBlock(result.state, "p1" as BlockId)?.prevSiblingId).toBe(newId);
    expect(getBlock(result.state, "doc" as BlockId)?.firstChildId).toBe(newId);
    expect(getBlock(result.state, "doc" as BlockId)?.lastChildId).toBe("p2");
    expect(new Set(result.dirtyIds)).toEqual(new Set([newId, "doc", "p1"]));
  });
});

describe("insertBlock — append (beforeSiblingId === null)", () => {
  // doc > [p1, p2]  →  doc > [p1, p2, NEW]  via beforeSiblingId = null
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });

  it("appends after the last child and updates parent's lastChildId", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlock(state, "doc" as BlockId, null, { type: "paragraph" }, allocator);
    const newId = "new-0" as BlockId;
    const newBlock = getBlock(result.state, newId);
    expect(newBlock?.prevSiblingId).toBe("p2");
    expect(newBlock?.nextSiblingId).toBeNull();
    expect(getBlock(result.state, "p2" as BlockId)?.nextSiblingId).toBe(newId);
    expect(getBlock(result.state, "doc" as BlockId)?.firstChildId).toBe("p1");
    expect(getBlock(result.state, "doc" as BlockId)?.lastChildId).toBe(newId);
    expect(new Set(result.dirtyIds)).toEqual(new Set([newId, "doc", "p2"]));
  });
});

describe("insertBlock — first child of empty container", () => {
  // doc > [section] (empty)  →  doc > [section > [NEW]]
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc" }), // no children
      ],
    });

  it("inserts as the only child of an empty container (with beforeSiblingId === null)", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlock(state, "s" as BlockId, null, { type: "paragraph", inlineContent: inlineContent([]) }, allocator);
    const newId = "new-0" as BlockId;
    const newBlock = getBlock(result.state, newId);
    expect(newBlock?.parentId).toBe("s");
    expect(newBlock?.prevSiblingId).toBeNull();
    expect(newBlock?.nextSiblingId).toBeNull();
    expect(getBlock(result.state, "s" as BlockId)?.firstChildId).toBe(newId);
    expect(getBlock(result.state, "s" as BlockId)?.lastChildId).toBe(newId);
  });
});

describe("insertBlock — error cases", () => {
  it("throws when the parent does not exist", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    const allocator = createTestAllocator("new");
    expect(() =>
      insertBlock(state, "missing" as BlockId, null, { type: "paragraph" }, allocator),
    ).toThrow(/parent "missing" not found/);
  });

  it("throws when beforeSiblingId is not a child of parent", () => {
    // doc > [p1]; section > [p2]  — p2 is NOT a child of doc, but we pass it as beforeSiblingId on doc.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
        buildBlock({ id: "section", type: "section" }), // orphan; for test purposes
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", inlineContent: inlineContent([]) }),
      ],
    });
    const allocator = createTestAllocator("new");
    expect(() =>
      insertBlock(state, "doc" as BlockId, "p2" as BlockId, { type: "paragraph" }, allocator),
    ).toThrow(/not a child of parent/);
  });

  it("throws when beforeSiblingId references a missing block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document" })],
    });
    const allocator = createTestAllocator("new");
    expect(() =>
      insertBlock(state, "doc" as BlockId, "missing-sibling" as BlockId, { type: "paragraph" }, allocator),
    ).toThrow(/beforeSibling.*not found/);
  });

  it("throws when a resolver is provided and the parent is a leaf (not a container)", () => {
    // doc > [p1]; attempt to insert a child block UNDER the paragraph p1.
    // Without the resolver this would silently create an invalid tree shape
    // (a block-child under an inline-bearing leaf).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    const allocator = createTestAllocator("new");
    expect(() =>
      insertBlock(
        state,
        "p1" as BlockId,
        null,
        { type: "paragraph", inlineContent: inlineContent([]) },
        allocator,
        resolver,
      ),
    ).toThrow(/is not a container/);
  });

  it("throws when a resolver is provided and the parent's type is unregistered (kind resolves to null)", () => {
    // doc > [mystery]; the "mystery" type is absent from the resolver map, so
    // blockKindOf returns null. A null kind is NOT a container, so the guard
    // must fire (rather than treating the unknown type as insertable-into).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "mystery", lastChildId: "mystery" }),
        buildBlock({ id: "mystery", type: "mystery", parentId: "doc" }),
      ],
    });
    const allocator = createTestAllocator("new");
    expect(() =>
      insertBlock(
        state,
        "mystery" as BlockId,
        null,
        { type: "paragraph", inlineContent: inlineContent([]) },
        allocator,
        resolver,
      ),
    ).toThrow(/is not a container \(kind "null"\)/);
  });

  it("succeeds when a resolver is provided and the parent IS a container", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document" })],
    });
    const allocator = createTestAllocator("new");
    const result = insertBlock(
      state,
      "doc" as BlockId,
      null,
      { type: "paragraph", inlineContent: inlineContent([]) },
      allocator,
      resolver,
    );
    const newId = "new-0" as BlockId;
    expect(getBlock(result.state, newId)?.parentId).toBe("doc");
  });

  it("does NOT throw on a leaf parent when no resolver is provided (back-compat)", () => {
    // Identical fixture to the resolver-leaf case, but with no resolver arg:
    // the kind guard is skipped entirely and the insert proceeds as before.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    const allocator = createTestAllocator("new");
    expect(() =>
      insertBlock(
        state,
        "p1" as BlockId,
        null,
        { type: "paragraph", inlineContent: inlineContent([]) },
        allocator,
      ),
    ).not.toThrow();
  });

  it("throws when the allocator returns a colliding id (already exists in blocks)", () => {
    // Seed state with a block named "collide-0", then provide an allocator
    // whose first allocation also returns "collide-0". Without the dev-mode
    // collision check, the Y.Map.set would silently overwrite the existing
    // "collide-0" block.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "collide-0", lastChildId: "collide-0" }),
        buildBlock({ id: "collide-0", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    // createTestAllocator with prefix "collide" yields "collide-0" first.
    const allocator = createTestAllocator("collide");
    expect(() =>
      insertBlock(state, "doc" as BlockId, null, { type: "paragraph" }, allocator),
    ).toThrow(/allocator returned a colliding id "collide-0"/);
  });
});
