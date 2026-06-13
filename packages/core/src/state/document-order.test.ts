import { describe, it, expect } from "vitest";
import { iterateBlocksInDocumentOrder, iterateLeafBlocksInDocumentOrder } from "./document-order";
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

  it("TERMINATES on a malformed two-parents topology (#510 regression — was an infinite loop)", () => {
    // Invalid per the one-parentId invariant: `c` is the firstChildId of BOTH
    // `a` and `b`, with c.parentId = "a". The old `firstLeafBlock` +
    // `nextBlockInDocOrder` cursor sweep oscillated b⇄c forever (a CPU-bound
    // hang that defeats vitest's --test-timeout and never lets the worker exit).
    // Routing through iterateBlocksInDocumentOrder's active-path guard must make
    // this TERMINATE — the shared leaf `c` is visited once per parent, no live
    // ancestor cycle, no throw.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "doc", firstChildId: "a", lastChildId: "b" }),
        buildBlock({ id: "a", type: "section", parentId: "doc", nextSiblingId: "b", firstChildId: "c", lastChildId: "c" }),
        buildBlock({ id: "b", type: "section", parentId: "doc", prevSiblingId: "a", firstChildId: "c", lastChildId: "c" }),
        buildBlock({ id: "c", type: "paragraph", parentId: "a", inlineContent: { items: [] } }),
      ],
    });
    expect([...iterateLeafBlocksInDocumentOrder(state)].map((b) => b.id)).toEqual(["c", "c"]);
  });
});
