import { describe, it, expect } from "vitest";
import { insertBlock } from "./insert-block";
import { buildBlock, buildState } from "../test-utils/state-builders";
import { createTestAllocator } from "./block-id";
import { createInlineContent } from "./inline-content";
import type { BlockId } from "./block-id";

describe("insertBlock — between siblings", () => {
  // doc > [p1, p2]  →  doc > [p1, NEW, p2]
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
      ],
    });

  it("inserts a new block between two siblings, splicing the linked list", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlock(
      state,
      "doc" as BlockId,
      "p2" as BlockId,
      { type: "paragraph", inlineContent: createInlineContent([]) },
      allocator,
    );
    const newId = "new-0" as BlockId;

    // New block exists with correct linkage:
    const newBlock = result.state.blocks.get(newId);
    expect(newBlock).toBeDefined();
    expect(newBlock?.type).toBe("paragraph");
    expect(newBlock?.parentId).toBe("doc");
    expect(newBlock?.prevSiblingId).toBe("p1");
    expect(newBlock?.nextSiblingId).toBe("p2");

    // p1's nextSiblingId now points to the new block:
    expect(result.state.blocks.get("p1" as BlockId)?.nextSiblingId).toBe(newId);

    // p2's prevSiblingId now points to the new block:
    expect(result.state.blocks.get("p2" as BlockId)?.prevSiblingId).toBe(newId);

    // doc's firstChildId / lastChildId unchanged (still p1 / p2):
    expect(result.state.blocks.get("doc" as BlockId)?.firstChildId).toBe("p1");
    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBe("p2");
  });

  it("returns dirtyIds for new block + parent + both adjacent siblings", () => {
    const state = fixture();
    const allocator = createTestAllocator("new");
    const result = insertBlock(
      state,
      "doc" as BlockId,
      "p2" as BlockId,
      { type: "paragraph" },
      allocator,
    );
    // Expected dirty: new block, doc (parent — its firstChild/lastChild may or may not have changed but parent was inspected/updated), p1 (nextSibling rewired), p2 (prevSibling rewired).
    // Note: when inserting between siblings, doc's first/lastChildId stay the same so dirtying it is conservative but correct.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["new-0", "doc", "p1", "p2"]));
  });
});
