import { describe, it, expect } from "vitest";
import { compareBlocksInDocOrder, comparePositions, selectionContextOf, spanStart, spanEnd } from "./block-compare";
import { buildBlock, buildState, inlineContent } from "../test-utils/state-builders";
import { createPosition, createSpan } from "./block-position";
import type { BlockId } from "./block-id";

describe("compareBlocksInDocOrder", () => {
  // Common test fixture: doc > [section1 > [p1, p2], section2 > [p3, p4]]
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s1", lastChildId: "s2" }),
        buildBlock({
          id: "s1",
          type: "section",
          parentId: "doc",
          nextSiblingId: "s2",
          firstChildId: "p1",
          lastChildId: "p2",
        }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "s1",
          nextSiblingId: "p2",
          inlineContent: inlineContent([]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "s1",
          prevSiblingId: "p1",
          inlineContent: inlineContent([]),
        }),
        buildBlock({
          id: "s2",
          type: "section",
          parentId: "doc",
          prevSiblingId: "s1",
          firstChildId: "p3",
          lastChildId: "p4",
        }),
        buildBlock({
          id: "p3",
          type: "paragraph",
          parentId: "s2",
          nextSiblingId: "p4",
          inlineContent: inlineContent([]),
        }),
        buildBlock({
          id: "p4",
          type: "paragraph",
          parentId: "s2",
          prevSiblingId: "p3",
          inlineContent: inlineContent([]),
        }),
      ],
    });

  it("returns 0 when comparing a block to itself", () => {
    const state = fixture();
    expect(compareBlocksInDocOrder(state, "p1" as BlockId, "p1" as BlockId)).toBe(0);
  });

  it("returns negative when a comes before b at the same level (siblings)", () => {
    const state = fixture();
    expect(compareBlocksInDocOrder(state, "p1" as BlockId, "p2" as BlockId)).toBeLessThan(0);
  });

  it("returns positive when a comes after b at the same level", () => {
    const state = fixture();
    expect(compareBlocksInDocOrder(state, "p2" as BlockId, "p1" as BlockId)).toBeGreaterThan(0);
  });

  it("returns negative when a is in an earlier subtree than b", () => {
    const state = fixture();
    expect(compareBlocksInDocOrder(state, "p1" as BlockId, "p3" as BlockId)).toBeLessThan(0);
    expect(compareBlocksInDocOrder(state, "p2" as BlockId, "p3" as BlockId)).toBeLessThan(0);
  });

  it("returns positive when a is in a later subtree than b", () => {
    const state = fixture();
    expect(compareBlocksInDocOrder(state, "p4" as BlockId, "p1" as BlockId)).toBeGreaterThan(0);
  });

  it("returns negative when a is an ancestor of b (ancestor comes first)", () => {
    const state = fixture();
    expect(compareBlocksInDocOrder(state, "doc" as BlockId, "p1" as BlockId)).toBeLessThan(0);
    expect(compareBlocksInDocOrder(state, "s1" as BlockId, "p1" as BlockId)).toBeLessThan(0);
  });

  it("returns positive when a is a descendant of b (descendant comes after)", () => {
    const state = fixture();
    expect(compareBlocksInDocOrder(state, "p1" as BlockId, "doc" as BlockId)).toBeGreaterThan(0);
    expect(compareBlocksInDocOrder(state, "p1" as BlockId, "s1" as BlockId)).toBeGreaterThan(0);
  });

  it("throws when one of the ids does not exist", () => {
    const state = fixture();
    expect(() => compareBlocksInDocOrder(state, "missing" as BlockId, "p1" as BlockId)).toThrow();
    expect(() => compareBlocksInDocOrder(state, "p1" as BlockId, "missing" as BlockId)).toThrow();
  });

  it("throws when blocks are in disjoint subtrees (no common ancestor)", () => {
    // Two separate roots — should not happen in practice (single rootId), but defensive.
    const state = buildState({
      rootId: "a",
      blocks: [
        buildBlock({ id: "a", type: "document", inlineContent: inlineContent([]) }),
        buildBlock({ id: "b", type: "document", inlineContent: inlineContent([]) }), // orphan, no parent
      ],
    });
    expect(() => compareBlocksInDocOrder(state, "a" as BlockId, "b" as BlockId)).toThrow();
  });

  it("compares correctly when one block is much deeper than the other (asymmetric chains)", () => {
    // doc > [shallow, outer > section > subsection > deep]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "shallow", lastChildId: "outer" }),
        buildBlock({
          id: "shallow",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "outer",
          inlineContent: inlineContent([]),
        }),
        buildBlock({
          id: "outer",
          type: "section",
          parentId: "doc",
          prevSiblingId: "shallow",
          firstChildId: "section",
          lastChildId: "section",
        }),
        buildBlock({
          id: "section",
          type: "section",
          parentId: "outer",
          firstChildId: "subsection",
          lastChildId: "subsection",
        }),
        buildBlock({
          id: "subsection",
          type: "section",
          parentId: "section",
          firstChildId: "deep",
          lastChildId: "deep",
        }),
        buildBlock({
          id: "deep",
          type: "paragraph",
          parentId: "subsection",
          inlineContent: inlineContent([]),
        }),
      ],
    });
    // shallow chain depth = 2 (shallow, doc); deep chain depth = 5 (deep, subsection, section, outer, doc).
    expect(compareBlocksInDocOrder(state, "shallow" as BlockId, "deep" as BlockId)).toBeLessThan(0);
    expect(compareBlocksInDocOrder(state, "deep" as BlockId, "shallow" as BlockId)).toBeGreaterThan(0);
  });
});

describe("comparePositions", () => {
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });

  it("compares offsets within the same block", () => {
    const state = fixture();
    const a = createPosition("p1" as BlockId, 1);
    const b = createPosition("p1" as BlockId, 5);
    expect(comparePositions(state, a, b)).toBeLessThan(0);
    expect(comparePositions(state, b, a)).toBeGreaterThan(0);
    expect(comparePositions(state, a, a)).toBe(0);
  });

  it("delegates to compareBlocksInDocOrder when blocks differ", () => {
    const state = fixture();
    const a = createPosition("p1" as BlockId, 5);
    const b = createPosition("p2" as BlockId, 0);
    expect(comparePositions(state, a, b)).toBeLessThan(0);
    expect(comparePositions(state, b, a)).toBeGreaterThan(0);
  });
});

describe("spanStart / spanEnd", () => {
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });

  it("returns anchor first / focus second when anchor precedes focus", () => {
    const state = fixture();
    const anchor = createPosition("p1" as BlockId, 1);
    const focus = createPosition("p2" as BlockId, 4);
    const span = createSpan(anchor, focus);
    expect(spanStart(state, span)).toBe(anchor);
    expect(spanEnd(state, span)).toBe(focus);
  });

  it("returns focus first / anchor second when focus precedes anchor", () => {
    const state = fixture();
    const anchor = createPosition("p2" as BlockId, 4);
    const focus = createPosition("p1" as BlockId, 1);
    const span = createSpan(anchor, focus);
    expect(spanStart(state, span)).toBe(focus);
    expect(spanEnd(state, span)).toBe(anchor);
  });
});

describe("selectionContextOf", () => {
  it("returns the root id when called on the root", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document" })],
    });
    expect(selectionContextOf(state, "doc" as BlockId)).toBe("doc");
  });

  it("walks parentId to find the context root", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "s", inlineContent: inlineContent([]) }),
      ],
    });
    expect(selectionContextOf(state, "p" as BlockId)).toBe("doc");
    expect(selectionContextOf(state, "s" as BlockId)).toBe("doc");
  });

  it("returns null when called on a non-existent id", () => {
    const state = buildState({ rootId: "doc", blocks: [buildBlock({ id: "doc", type: "document" })] });
    expect(selectionContextOf(state, "missing" as BlockId)).toBeNull();
  });

  it("returns the block's own root when it is an orphan (parentId === null)", () => {
    // For Phase 2, all blocks are reachable from state.rootId (no embed-content
    // sub-trees yet). Future phases will add embed-content blocks with
    // parentId === null; selectionContextOf should return them as their own
    // context root.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document" }),
        buildBlock({ id: "orphan", type: "footnote-body", inlineContent: inlineContent([]) }), // parentId defaults to null
      ],
    });
    expect(selectionContextOf(state, "orphan" as BlockId)).toBe("orphan");
  });
});
