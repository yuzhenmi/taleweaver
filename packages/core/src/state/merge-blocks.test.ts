import { describe, it, expect } from "vitest";
import { mergeAdjacentBlocks } from "./merge-blocks";
import { buildBlock, buildState, text } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import type { BlockId } from "./block-id";

describe("mergeAdjacentBlocks — basic merge of two adjacent leaf siblings", () => {
  // doc > [p1("hello"), p2(" world")]
  // After merge: doc > [p1("hello world")] (run-merged into one item since both have empty attrs)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([text(" world")]) }),
      ],
    });

  it("merges right into left, removes right, rewires the parent's lastChildId", () => {
    const state = fixture();
    const result = mergeAdjacentBlocks(state, "p1" as BlockId, "p2" as BlockId);

    // Left (p1) keeps its id; inlineContent is the concatenation, run-merged into one item.
    const left = result.state.blocks.get("p1" as BlockId);
    expect(left).toBeDefined();
    expect(left?.id).toBe("p1");
    expect(left?.type).toBe("paragraph");
    expect(left?.parentId).toBe("doc");
    expect(left?.prevSiblingId).toBeNull();
    expect(left?.nextSiblingId).toBeNull(); // was "p2"; p2 had no nextSibling, so left.nextSiblingId is now null
    expect(left?.inlineContent?.items).toHaveLength(1);
    expect(left?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "hello world", attrs: {} });

    // Right (p2) is removed from state.blocks.
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);

    // Parent's lastChildId is rewired to p1 (was p2). firstChildId still p1.
    const parent = result.state.blocks.get("doc" as BlockId);
    expect(parent?.firstChildId).toBe("p1");
    expect(parent?.lastChildId).toBe("p1");

    // dirtyIds: { p1 (modified), p2 (removed), doc (lastChildId changed) }.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "doc"]));
  });
});
