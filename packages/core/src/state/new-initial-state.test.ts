import { describe, it, expect } from "vitest";
import { createEmptyDocument } from "./new-initial-state";
import { createTestAllocator } from "./block-id";

describe("createEmptyDocument", () => {
  it("produces a document with one empty paragraph", () => {
    const allocator = createTestAllocator();
    const state = createEmptyDocument(allocator);

    // Two blocks were allocated: the document and the paragraph.
    expect([...state.blocks.keys()].sort()).toEqual(["blk-0", "blk-1"]);

    const root = state.blocks.get(state.rootId);
    expect(root).toBeDefined();
    if (!root) return;
    expect(root.type).toBe("document");
    expect(root.parentId).toBeNull();
    expect(root.firstChildId).toBe("blk-1");
    expect(root.lastChildId).toBe("blk-1");

    const para = state.blocks.get("blk-1" as Parameters<typeof state.blocks.get>[0]);
    expect(para).toBeDefined();
    if (!para) return;
    expect(para.type).toBe("paragraph");
    expect(para.parentId).toBe(root.id);
    expect(para.prevSiblingId).toBeNull();
    expect(para.nextSiblingId).toBeNull();
    expect(para.inlineContent).toEqual({ items: [] });
  });

  it("uses fresh ids for each call (deterministic with the test allocator)", () => {
    const a1 = createTestAllocator();
    const a2 = createTestAllocator();
    const s1 = createEmptyDocument(a1);
    const s2 = createEmptyDocument(a2);
    expect(s1.rootId).toBe(s2.rootId); // both start at blk-0 with their own counters
  });
});
