import { describe, it, expect } from "vitest";
import { compareBlocksInDocOrder } from "./block-compare";
import { buildBlock, buildState } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
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
          inlineContent: createInlineContent([]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "s1",
          prevSiblingId: "p1",
          inlineContent: createInlineContent([]),
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
          inlineContent: createInlineContent([]),
        }),
        buildBlock({
          id: "p4",
          type: "paragraph",
          parentId: "s2",
          prevSiblingId: "p3",
          inlineContent: createInlineContent([]),
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
        buildBlock({ id: "a", type: "document", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "b", type: "document", inlineContent: createInlineContent([]) }), // orphan, no parent
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
          inlineContent: createInlineContent([]),
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
          inlineContent: createInlineContent([]),
        }),
      ],
    });
    // shallow chain depth = 2 (shallow, doc); deep chain depth = 5 (deep, subsection, section, outer, doc).
    expect(compareBlocksInDocOrder(state, "shallow" as BlockId, "deep" as BlockId)).toBeLessThan(0);
    expect(compareBlocksInDocOrder(state, "deep" as BlockId, "shallow" as BlockId)).toBeGreaterThan(0);
  });
});
