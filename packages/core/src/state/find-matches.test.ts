import { describe, it, expect } from "vitest";
import { findMatches } from "./find-matches";
import { buildBlock, buildState, text, inlineContent } from "../test-utils/state-builders";
import type { BlockId } from "./block-id";

/**
 * Build a single-paragraph document with the given block text.
 * The paragraph block has id "p" so tests can assert against it.
 */
function singleBlock(blockText: string) {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text(blockText)]),
      }),
    ],
  });
}

/** Build a three-paragraph document p1 → p2 → p3 in document order. */
function threeBlocks(t1: string, t2: string, t3: string) {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
      buildBlock({
        id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2",
        inlineContent: inlineContent([text(t1)]),
      }),
      buildBlock({
        id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3",
        inlineContent: inlineContent([text(t2)]),
      }),
      buildBlock({
        id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2",
        inlineContent: inlineContent([text(t3)]),
      }),
    ],
  });
}

describe("findMatches", () => {
  it("finds a single match in one block with correct blockId/start/end", () => {
    const state = singleBlock("hello world");
    expect(findMatches(state, "world")).toEqual([
      { blockId: "p" as BlockId, start: 6, end: 11 },
    ]);
  });

  it("finds multiple NON-OVERLAPPING matches in one block", () => {
    // "aa" in "aaaa" → matches at 0 and 2 (NOT 0,1,2 — non-overlapping).
    const state = singleBlock("aaaa");
    expect(findMatches(state, "aa")).toEqual([
      { blockId: "p" as BlockId, start: 0, end: 2 },
      { blockId: "p" as BlockId, start: 2, end: 4 },
    ]);
  });

  it("yields exactly one match for 'aa' in 'aaa' (non-overlapping)", () => {
    const state = singleBlock("aaa");
    expect(findMatches(state, "aa")).toEqual([
      { blockId: "p" as BlockId, start: 0, end: 2 },
    ]);
  });

  it("returns matches across multiple blocks in document order", () => {
    const state = threeBlocks("cat one", "cat two", "cat three");
    expect(findMatches(state, "cat")).toEqual([
      { blockId: "p1" as BlockId, start: 0, end: 3 },
      { blockId: "p2" as BlockId, start: 0, end: 3 },
      { blockId: "p3" as BlockId, start: 0, end: 3 },
    ]);
  });

  it("is case-insensitive by default ('the' matches 'The')", () => {
    const state = singleBlock("The theatre");
    expect(findMatches(state, "the")).toEqual([
      { blockId: "p" as BlockId, start: 0, end: 3 },
      { blockId: "p" as BlockId, start: 4, end: 7 },
    ]);
  });

  it("caseSensitive:true does an exact match", () => {
    const state = singleBlock("The theatre");
    expect(findMatches(state, "the", { caseSensitive: true })).toEqual([
      { blockId: "p" as BlockId, start: 4, end: 7 },
    ]);
  });

  it("wholeWord:true matches a standalone word but not a substring", () => {
    // "cat" matches inside "a cat sat" but NOT inside "category".
    const state = singleBlock("a cat sat near category");
    expect(findMatches(state, "cat", { wholeWord: true })).toEqual([
      { blockId: "p" as BlockId, start: 2, end: 5 },
    ]);
  });

  it("default (wholeWord:false) matches inside 'category'", () => {
    const state = singleBlock("category");
    expect(findMatches(state, "cat")).toEqual([
      { blockId: "p" as BlockId, start: 0, end: 3 },
    ]);
  });

  it("returns [] for the empty query", () => {
    const state = singleBlock("anything at all");
    expect(findMatches(state, "")).toEqual([]);
  });

  it("returns [] when the query is longer than any text / not found", () => {
    const state = singleBlock("short");
    expect(findMatches(state, "this is way longer than the text")).toEqual([]);
    expect(findMatches(state, "absent")).toEqual([]);
  });

  it("finds whitespace matches (a ' ' query is a valid search)", () => {
    const state = singleBlock("a b c");
    expect(findMatches(state, " ")).toEqual([
      { blockId: "p" as BlockId, start: 1, end: 2 },
      { blockId: "p" as BlockId, start: 3, end: 4 },
    ]);
  });

  it("restricts the search to the given blockIds", () => {
    const state = threeBlocks("cat one", "cat two", "cat three");
    const ids: BlockId[] = ["p3" as BlockId, "p1" as BlockId];
    // blockIds order is honored as given (p3 before p1).
    expect(findMatches(state, "cat", { blockIds: ids })).toEqual([
      { blockId: "p3" as BlockId, start: 0, end: 3 },
      { blockId: "p1" as BlockId, start: 0, end: 3 },
    ]);
  });

  it("skips blockIds that have no inline content (container/non-leaf)", () => {
    const state = threeBlocks("cat one", "cat two", "cat three");
    // "doc" is the document container (inlineContent === null) — skipped silently.
    const ids: BlockId[] = ["doc" as BlockId, "p2" as BlockId];
    expect(findMatches(state, "cat", { blockIds: ids })).toEqual([
      { blockId: "p2" as BlockId, start: 0, end: 3 },
    ]);
  });
});
