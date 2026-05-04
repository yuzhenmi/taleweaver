import { describe, it, expect } from "vitest";
import { removeBlock } from "./remove-block";
import { buildBlock, buildState } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import type { BlockId } from "./block-id";

describe("removeBlock — middle child", () => {
  // doc > [p1, p2, p3]  →  doc > [p1, p3] (p2 removed)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([]) }),
      ],
    });

  it("removes the block from state.blocks", () => {
    const state = fixture();
    const result = removeBlock(state, "p2" as BlockId);
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);
  });

  it("relinks adjacent siblings (p1.nextSiblingId, p3.prevSiblingId)", () => {
    const state = fixture();
    const result = removeBlock(state, "p2" as BlockId);
    expect(result.state.blocks.get("p1" as BlockId)?.nextSiblingId).toBe("p3");
    expect(result.state.blocks.get("p3" as BlockId)?.prevSiblingId).toBe("p1");
  });

  it("does not change parent's firstChildId / lastChildId for a middle removal", () => {
    const state = fixture();
    const result = removeBlock(state, "p2" as BlockId);
    expect(result.state.blocks.get("doc" as BlockId)?.firstChildId).toBe("p1");
    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBe("p3");
  });

  it("returns dirtyIds for removed block + parent + adjacent siblings", () => {
    const state = fixture();
    const result = removeBlock(state, "p2" as BlockId);
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p2", "doc", "p1", "p3"]));
  });
});

describe("removeBlock — container block with children (subtree cascade)", () => {
  // doc > [section > [p1, p2], p3]
  // Removing `section` must also delete p1 and p2, otherwise they'd
  // be orphaned (their parentId points to a removed block) — violates
  // the spec's "no orphaned blocks" invariant.
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "section", lastChildId: "p3" }),
        buildBlock({ id: "section", type: "section", parentId: "doc", nextSiblingId: "p3", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "section", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "section", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "section", inlineContent: createInlineContent([]) }),
      ],
    });

  it("deletes the named block AND its entire subtree from state.blocks", () => {
    const state = fixture();
    const result = removeBlock(state, "section" as BlockId);
    expect(result.state.blocks.has("section" as BlockId)).toBe(false);
    expect(result.state.blocks.has("p1" as BlockId)).toBe(false);
    expect(result.state.blocks.has("p2" as BlockId)).toBe(false);
    // Sibling p3 is unaffected:
    expect(result.state.blocks.has("p3" as BlockId)).toBe(true);
    // Root unaffected:
    expect(result.state.blocks.has("doc" as BlockId)).toBe(true);
  });

  it("includes every id in the deleted subtree in dirtyIds, plus parent + sibling rewires", () => {
    const state = fixture();
    const result = removeBlock(state, "section" as BlockId);
    // dirty: section (deleted), p1 (deleted descendant), p2 (deleted descendant),
    //        doc (parent — firstChildId rewired), p3 (next sibling — prevSiblingId rewired).
    expect(new Set(result.dirtyIds)).toEqual(new Set(["section", "p1", "p2", "doc", "p3"]));
  });

  it("preserves the no-orphans invariant after a container removal", () => {
    const state = fixture();
    const result = removeBlock(state, "section" as BlockId);
    // Every remaining block must be reachable from rootId via parent/child links.
    // A simple check: every remaining block's parentId is either null (root) or
    // present in the result map.
    for (const [id, b] of result.state.blocks.entries()) {
      if (id === result.state.rootId) continue;
      expect(b.parentId).not.toBeNull();
      if (b.parentId !== null) {
        expect(result.state.blocks.has(b.parentId)).toBe(true);
      }
    }
  });
});

describe("removeBlock — first child", () => {
  // doc > [p1, p2, p3]  →  doc > [p2, p3] (p1 removed)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([]) }),
      ],
    });

  it("updates parent.firstChildId when removing the first child", () => {
    const state = fixture();
    const result = removeBlock(state, "p1" as BlockId);
    expect(result.state.blocks.get("doc" as BlockId)?.firstChildId).toBe("p2");
    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBe("p3");
    expect(result.state.blocks.get("p2" as BlockId)?.prevSiblingId).toBeNull();
  });
});

describe("removeBlock — last child", () => {
  // doc > [p1, p2, p3]  →  doc > [p1, p2] (p3 removed)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([]) }),
      ],
    });

  it("updates parent.lastChildId when removing the last child", () => {
    const state = fixture();
    const result = removeBlock(state, "p3" as BlockId);
    expect(result.state.blocks.get("doc" as BlockId)?.firstChildId).toBe("p1");
    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBe("p2");
    expect(result.state.blocks.get("p2" as BlockId)?.nextSiblingId).toBeNull();
  });
});

describe("removeBlock — only child", () => {
  // doc > [p1]  →  doc > [] (p1 removed; doc becomes empty)
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([]) }),
      ],
    });

  it("clears both firstChildId and lastChildId when removing the only child", () => {
    const state = fixture();
    const result = removeBlock(state, "p1" as BlockId);
    expect(result.state.blocks.get("doc" as BlockId)?.firstChildId).toBeNull();
    expect(result.state.blocks.get("doc" as BlockId)?.lastChildId).toBeNull();
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "doc"]));
  });
});
