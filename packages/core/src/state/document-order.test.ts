import { describe, it, expect } from "vitest";
import { iterateBlocksInDocumentOrder, iterateLeafBlocksInDocumentOrder } from "./document-order";
import { TEST_RESOLVER, testContainer, buildState, buildBlock } from "../test-utils/state-builders";
import { getBlock } from "./state";
import type { BlockId } from "./block-id";

// Host container types the default registry lacks (file-local registry instance).
TEST_RESOLVER.register(testContainer("blockquote"));

describe("iterateBlocksInDocumentOrder", () => {
  it("yields blocks depth-first: parent, children, then next sibling", () => {
    // root → [a (with child a1), b]
    const state = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "doc", firstChildId: "a", lastChildId: "b" }),
        buildBlock({ id: "a", type: "blockquote", parentId: "root", nextSiblingId: "b", firstChildId: "a1", lastChildId: "a1" }),
        buildBlock({ id: "a1", type: "paragraph", parentId: "a", inlineContent: { items: [] } }),
        buildBlock({ id: "b", type: "paragraph", parentId: "root", prevSiblingId: "a", inlineContent: { items: [] } }),
      ],
    });
    const ids = [...iterateBlocksInDocumentOrder(state)].map((b) => b.id);
    // The root's child is its final section, which holds the top-level blocks.
    expect(ids).toEqual(["root", getBlock(state, "root" as BlockId)?.firstChildId, "a", "a1", "b"]);
  });

  it("walks a long flat chain in linear time", () => {
    // 10,000 siblings: past the guard's lazy threshold, the block-count bound must be
    // computed once per walk — a per-step O(blocks) bound made this ~60M map iterations.
    const n = 10_000;
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const blocks = [
      buildBlock({ id: "root", type: "doc", firstChildId: "p0", lastChildId: `p${n - 1}` }),
      ...ids.map((id, i) =>
        buildBlock({
          id,
          type: "paragraph",
          parentId: "root",
          prevSiblingId: i > 0 ? `p${i - 1}` : null,
          nextSiblingId: i < n - 1 ? `p${i + 1}` : null,
          inlineContent: { items: [] },
        }),
      ),
    ];
    const t = performance.now();
    expect([...iterateBlocksInDocumentOrder(buildState({ rootId: "root", blocks }))].length).toBe(n + 2); // + the final section
    // Coarse bound (shared machines are noisy): linear is milliseconds; the quadratic bug was
    // tens of seconds (~60M map iterations).
    expect(performance.now() - t).toBeLessThan(5000);
    // (The derived tree cannot cycle — no cycle-detection case remains.)
  });

  it("yields the root, its final section and the one empty paragraph of a childless doc", () => {
    // Rev 11: the creator writes a childless flow's one ¶; the root always holds its final section.
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "doc" })],
    });
    const got = [...iterateBlocksInDocumentOrder(state)];
    expect(got.map((b) => b.type)).toEqual(["doc", "section", "paragraph"]);
    expect(got[2]?.inlineContent).toEqual({ items: [] });
  });
});

describe("iterateLeafBlocksInDocumentOrder", () => {
  it("yields only leaf blocks (no firstChildId) in document order, skipping containers", () => {
    // root → [a (container, child a1), b]. Only a1 and b are leaves.
    const state = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "doc", firstChildId: "a", lastChildId: "b" }),
        buildBlock({ id: "a", type: "section", parentId: "root", nextSiblingId: "b", firstChildId: "a1", lastChildId: "a1" }),
        buildBlock({ id: "a1", type: "paragraph", parentId: "a", inlineContent: { items: [] } }),
        buildBlock({ id: "b", type: "paragraph", parentId: "root", prevSiblingId: "a", inlineContent: { items: [] } }),
      ],
    });
    expect([...iterateLeafBlocksInDocumentOrder(state)].map((b) => b.id)).toEqual(["a1", "b"]);
  });
});
