import { describe, it, expect } from "vitest";
import { splitBlockAtPosition } from "./split-block";
import { buildBlock, buildState, text } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import { createPosition } from "./block-position";
import { createTestAllocator, type BlockId } from "./block-id";

describe("splitBlockAtPosition — single-block, mid-text-item split", () => {
  // doc > [p("hello world")]
  // Split at offset 5: p_left = "hello", new block = " world"
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world")]) }),
      ],
    });

  it("splits the leaf block into two adjacent siblings", () => {
    const state = fixture();
    const allocator = createTestAllocator("p2");
    const result = splitBlockAtPosition(state, createPosition("p" as BlockId, 5), allocator);

    // Original block: same id, content "hello", nextSibling rewired to new block.
    const left = result.state.blocks.get("p" as BlockId);
    expect(left).toBeDefined();
    expect(left?.id).toBe("p");
    expect(left?.inlineContent?.items).toHaveLength(1);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello" });
    expect(left?.nextSiblingId).toBe("p2-0");

    // New block: id from allocator, content " world", parentId same as original.
    const right = result.state.blocks.get("p2-0" as BlockId);
    expect(right).toBeDefined();
    expect(right?.type).toBe("paragraph");
    expect(right?.parentId).toBe("doc");
    expect(right?.prevSiblingId).toBe("p");
    expect(right?.nextSiblingId).toBeNull();
    expect(right?.firstChildId).toBeNull();
    expect(right?.lastChildId).toBeNull();
    expect(right?.inlineContent?.items).toHaveLength(1);
    expect(right?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: " world" });

    // Parent: lastChildId updated to new block (original was the only/last child).
    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p");
    expect(parent?.lastChildId).toBe("p2-0");

    // dirtyIds: { p, p2-0, doc }. (No nextSibling existed to rewire; parent.lastChildId changed → parent dirty.)
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p", "p2-0", "doc"]));
  });
});
