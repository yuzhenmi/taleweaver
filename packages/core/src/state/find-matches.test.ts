import { describe, it, expect } from "vitest";
import { findMatches } from "./find-matches";
import { buildBlock, buildState, text, embed, inlineContent } from "../test-utils/state-builders";
import type { BlockId } from "./block-id";
import { COMMENT_START_EMBED_TYPE, COMMENT_END_EMBED_TYPE } from "./comments";
import { BLOCK_JOIN_SUGGESTION_EMBED_TYPE } from "./suggestions";

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

  it("counts an embed as length 1 — match offsets stay aligned with the Position model (#407)", () => {
    // LOAD-BEARING: a TextMatch offset must map 1:1 to a { blockId, offset }
    // Position so a match can become a selection/highlight. An embed counts as
    // length 1 in extractText AND in inlineContentLength, so text AFTER an embed
    // is offset by exactly 1. Block: "abc" + hard-break + "def" → "abc\ndef".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([text("abc"), embed("hard-break"), text("def")]),
        }),
      ],
    });
    // "def" begins at offset 4: a(0) b(1) c(2) +embed(3) d(4) — the embed is
    // length 1, NOT 0 and NOT its serialized-string length.
    expect(findMatches(state, "def")).toEqual([
      { blockId: "p" as BlockId, start: 4, end: 7 },
    ]);
    // "abc" before the embed is unaffected.
    expect(findMatches(state, "abc")).toEqual([
      { blockId: "p" as BlockId, start: 0, end: 3 },
    ]);
    // The hard-break itself serializes to "\n" (one char) at offset 3, so it is
    // matchable and occupies exactly one offset slot.
    expect(findMatches(state, "\n")).toEqual([
      { blockId: "p" as BlockId, start: 3, end: 4 },
    ]);
  });

  it("a ZERO-WIDTH comment marker counts as length 1 — match offsets stay 1:1 with the Position model (#407 / B1)", () => {
    // Comment-start/-end markers serialize to "" (zero-width) in extractText, but
    // STILL occupy ONE Position offset each (inlineContentLength counts them as 1).
    // A match AFTER a marker must report its POSITION offset, NOT the marker-
    // collapsed haystack index — else replaceRange splices at the wrong Position,
    // corrupting the marker AND replacing the wrong text (data loss).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([
            text("hello "),
            embed(COMMENT_START_EMBED_TYPE, { commentId: "c1" }),
            text("world"),
          ]),
        }),
      ],
    });
    // Position offsets: "hello "=[0,6), comment-start@6, "world"=[7,12).
    // "world" begins at offset 7 — the marker occupies offset 6 — NOT 6.
    expect(findMatches(state, "world")).toEqual([
      { blockId: "p" as BlockId, start: 7, end: 12 },
    ]);
    // Text BEFORE the marker is unaffected.
    expect(findMatches(state, "hello")).toEqual([
      { blockId: "p" as BlockId, start: 0, end: 5 },
    ]);
    // A query SPANNING the invisible marker still matches (markers are transparent
    // to matching — Google-Docs parity); its Position span [0,12) includes the
    // marker offset, which replaceRange handles at the boundary.
    expect(findMatches(state, "hello world")).toEqual([
      { blockId: "p" as BlockId, start: 0, end: 12 },
    ]);
  });

  it("a match wrapped EXACTLY by a comment excludes the trailing end-marker from the span (#463)", () => {
    // Block: "see " + [comment-start] + "here" + [comment-end] + " now". The
    // comment wraps exactly "here". A search for "here" must report the span of
    // "here" ALONE — NOT extend past the comment-end marker. If `end` mapped to
    // the next VISIBLE char's Position it would jump over the zero-width end-
    // marker and replaceRange would delete it, corrupting the comment.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([
            text("see "),
            embed(COMMENT_START_EMBED_TYPE, { commentId: "c1" }),
            text("here"),
            embed(COMMENT_END_EMBED_TYPE, { commentId: "c1" }),
            text(" now"),
          ]),
        }),
      ],
    });
    // Position offsets: "see "=[0,4), start@4, "here"=[5,9), end@9, " now"=[10,14).
    // "here" begins at 5; its span is [5,9) — the end-marker at offset 9 is
    // OUTSIDE the match (end = last-matched-char Position + 1 = 8 + 1 = 9).
    expect(findMatches(state, "here")).toEqual([
      { blockId: "p" as BlockId, start: 5, end: 9 },
    ]);
  });

  it("a ZERO-WIDTH change-tracking break-suggestion marker also counts as length 1 (B1)", () => {
    // The same zero-width-marker class as comments: block-join/split suggestion
    // embeds (change-tracking) serialize to "" yet occupy ONE Position offset.
    // A match after one must report its Position offset, not the collapsed index.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([
            text("foo "),
            embed(BLOCK_JOIN_SUGGESTION_EMBED_TYPE, { suggestionId: "s1" }),
            text("bar"),
          ]),
        }),
      ],
    });
    // "foo "=[0,4), join-suggestion@4, "bar"=[5,8) — "bar" begins at 5, NOT 4.
    expect(findMatches(state, "bar")).toEqual([
      { blockId: "p" as BlockId, start: 5, end: 8 },
    ]);
  });
});
