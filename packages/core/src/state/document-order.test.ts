import { describe, it, expect } from "vitest";
import { iterateBlocksInDocumentOrder } from "./document-order";
import { buildState, buildBlock } from "../test-utils/state-builders";

describe("iterateBlocksInDocumentOrder", () => {
  it("yields blocks depth-first: parent, children, then next sibling", () => {
    // root → [a (with child a1), b]
    const state = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "doc", firstChildId: "a", lastChildId: "b" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "root", nextSiblingId: "b", firstChildId: "a1", lastChildId: "a1" }),
        buildBlock({ id: "a1", type: "paragraph", parentId: "a", inlineContent: { items: [] } }),
        buildBlock({ id: "b", type: "paragraph", parentId: "root", prevSiblingId: "a", inlineContent: { items: [] } }),
      ],
    });
    const ids = [...iterateBlocksInDocumentOrder(state)].map((b) => b.id);
    expect(ids).toEqual(["root", "a", "a1", "b"]);
  });

  it("yields just the root for a single-block doc", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "doc" })],
    });
    expect([...iterateBlocksInDocumentOrder(state)].map((b) => b.id)).toEqual(["root"]);
  });

  it("throws (no stack overflow) on a firstChildId ancestor cycle", () => {
    // Corrupted state: root → a, and a.firstChildId points back at root. The
    // recursion's active-path guard must throw rather than recurse forever.
    const state = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "doc", firstChildId: "a", lastChildId: "a" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "root", firstChildId: "root", lastChildId: "root" }),
      ],
    });
    expect(() => [...iterateBlocksInDocumentOrder(state)]).toThrow(/cycle/);
  });
});
