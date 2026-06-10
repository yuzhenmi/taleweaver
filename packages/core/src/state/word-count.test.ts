import { describe, it, expect } from "vitest";
import { getWordCount, countText, getSelectionWordCount } from "./word-count";
import { buildBlock, buildState, text, embed, inlineContent } from "../test-utils/state-builders";
import type { BlockId } from "./block-id";
import { createPosition, createSpan } from "./block-position";

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

/** Build a two-paragraph document p1 → p2 in document order. */
function twoBlocks(t1: string, t2: string) {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
      buildBlock({
        id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2",
        inlineContent: inlineContent([text(t1)]),
      }),
      buildBlock({
        id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1",
        inlineContent: inlineContent([text(t2)]),
      }),
    ],
  });
}

describe("getWordCount", () => {
  it("counts words/characters/excl-spaces for a single block", () => {
    const state = singleBlock("hello world");
    expect(getWordCount(state)).toEqual({
      words: 2,
      characters: 11,
      charactersExcludingSpaces: 10,
    });
  });

  it("sums across multiple blocks; words do NOT straddle block boundaries", () => {
    // "hello world" (2 words) + "foo" (1 word) → 3 words, NOT a merged
    // "world"+"foo" token. characters 11 + 3 = 14; excl-spaces 10 + 3 = 13.
    const state = twoBlocks("hello world", "foo");
    expect(getWordCount(state)).toEqual({
      words: 3,
      characters: 14,
      charactersExcludingSpaces: 13,
    });
  });

  it("treats two adjacent word-fragments across a block break as separate words", () => {
    // "hel" at end of block1 and "lo" at start of block2 are 2 words, not the
    // single word "hello" — words cannot span a paragraph break.
    const state = twoBlocks("hel", "lo");
    const wc = getWordCount(state);
    expect(wc.words).toBe(2);
  });

  it("ignores leading/trailing/multiple internal spaces (no empty words)", () => {
    // "  a   b  " → 2 words. characters counts every space (9). excl-spaces
    // counts only a,b (2).
    const state = singleBlock("  a   b  ");
    expect(getWordCount(state)).toEqual({
      words: 2,
      characters: 9,
      charactersExcludingSpaces: 2,
    });
  });

  it("returns all zeros for an empty block", () => {
    const state = singleBlock("");
    expect(getWordCount(state)).toEqual({
      words: 0,
      characters: 0,
      charactersExcludingSpaces: 0,
    });
  });

  it("counts tab/hard-break embeds as whitespace", () => {
    // Block: "a" + tab + "b" → extracted "a\tb". The tab is whitespace, so it
    // does NOT inflate the word count (2 words, not 1 token "a\tb") and is
    // excluded from charactersExcludingSpaces. characters = 3 (a, \t, b).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([text("a"), embed("tab"), text("b")]),
        }),
      ],
    });
    expect(getWordCount(state)).toEqual({
      words: 2,
      characters: 3,
      charactersExcludingSpaces: 2,
    });
  });

  it("counts a hard-break embed as whitespace within a block", () => {
    // "a" + hard-break + "b" → "a\nb": 2 words, characters 3, excl-spaces 2.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([text("a"), embed("hard-break"), text("b")]),
        }),
      ],
    });
    expect(getWordCount(state)).toEqual({
      words: 2,
      characters: 3,
      charactersExcludingSpaces: 2,
    });
  });

  it("restricts the count to the given blockIds", () => {
    const state = twoBlocks("hello world", "foo bar baz");
    // Only p2: 3 words, characters 11, excl-spaces 9.
    expect(getWordCount(state, { blockIds: ["p2" as BlockId] })).toEqual({
      words: 3,
      characters: 11,
      charactersExcludingSpaces: 9,
    });
  });

  it("honors blockIds order and counts each (sum is order-independent)", () => {
    const state = twoBlocks("hello world", "foo");
    const ids: BlockId[] = ["p2" as BlockId, "p1" as BlockId];
    expect(getWordCount(state, { blockIds: ids })).toEqual({
      words: 3,
      characters: 14,
      charactersExcludingSpaces: 13,
    });
  });

  it("skips blockIds without inline content (container/non-leaf)", () => {
    const state = twoBlocks("hello world", "foo");
    // "doc" is the document container (inlineContent === null) — skipped.
    const ids: BlockId[] = ["doc" as BlockId, "p1" as BlockId];
    expect(getWordCount(state, { blockIds: ids })).toEqual({
      words: 2,
      characters: 11,
      charactersExcludingSpaces: 10,
    });
  });
});

describe("countText", () => {
  it("counts words/characters/excl-spaces for a simple string", () => {
    expect(countText("hello world")).toEqual({
      words: 2,
      characters: 11,
      charactersExcludingSpaces: 10,
    });
  });

  it("returns all zeros for the empty string", () => {
    expect(countText("")).toEqual({
      words: 0,
      characters: 0,
      charactersExcludingSpaces: 0,
    });
  });

  it("ignores leading/trailing/repeated whitespace (no empty tokens)", () => {
    // "  a  b  " → 2 words. characters = full length incl. spaces = 8.
    // excl-spaces = a,b = 2.
    expect(countText("  a  b  ")).toEqual({
      words: 2,
      characters: 8,
      charactersExcludingSpaces: 2,
    });
  });
});

describe("getSelectionWordCount", () => {
  it("counts a partial selection inside one block, partial tokens count as words", () => {
    // "hello world" — select offsets [3, 9) → "lo wor". The partial tokens
    // "lo" and "wor" each count as a word (split semantics): 2 words,
    // characters 6, excl-spaces 5.
    const state = singleBlock("hello world");
    const span = createSpan(
      createPosition("p" as BlockId, 3),
      createPosition("p" as BlockId, 9),
    );
    expect(getSelectionWordCount(state, span)).toEqual({
      words: 2,
      characters: 6,
      charactersExcludingSpaces: 5,
    });
  });

  it("normalizes a backwards selection (anchor after focus)", () => {
    // Same "lo wor" selection but with anchor/focus reversed — must yield the
    // identical result.
    const state = singleBlock("hello world");
    const backwards = createSpan(
      createPosition("p" as BlockId, 9),
      createPosition("p" as BlockId, 3),
    );
    expect(getSelectionWordCount(state, backwards)).toEqual({
      words: 2,
      characters: 6,
      charactersExcludingSpaces: 5,
    });
  });

  it("over a full single block equals getWordCount of that block", () => {
    const state = singleBlock("hello world");
    const fullSpan = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("p" as BlockId, 11),
    );
    expect(getSelectionWordCount(state, fullSpan)).toEqual(
      getWordCount(state, { blockIds: ["p" as BlockId] }),
    );
  });

  it("spanning two blocks counts the inter-block newline separator", () => {
    // p1 = "hello world", p2 = "foo bar". Select from "world" start (offset 6
    // of p1) to end of "foo" (offset 3 of p2). extractText joins the two block
    // fragments with "\n", so the selected text is "world\nfoo".
    //   words: "world" and "foo" → 2 (newline is whitespace, splits them).
    //   characters: "world\nfoo".length = 9 (the \n IS counted — the selection
    //     genuinely spans the paragraph break).
    //   excl-spaces: 8 (everything but the \n).
    const state = twoBlocks("hello world", "foo bar");
    const span = createSpan(
      createPosition("p1" as BlockId, 6),
      createPosition("p2" as BlockId, 3),
    );
    expect(getSelectionWordCount(state, span)).toEqual({
      words: 2,
      characters: 9,
      charactersExcludingSpaces: 8,
    });
  });

  it("returns all zeros for a collapsed selection", () => {
    const state = singleBlock("hello world");
    const collapsed = createSpan(
      createPosition("p" as BlockId, 4),
      createPosition("p" as BlockId, 4),
    );
    expect(getSelectionWordCount(state, collapsed)).toEqual({
      words: 0,
      characters: 0,
      charactersExcludingSpaces: 0,
    });
  });
});

describe("getWordCount / getSelectionWordCount — SuggestionView projection (5c-ii)", () => {
  // doc > p( "alpha " + <ins>"beta "</ins> + <del>"gamma"</del> ) — literal text
  // "alpha beta gamma" = 3 words.
  function build() {
    return buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("alpha "),
            text("beta ", { insertionSuggestionId: "s-ins" }),
            text("gamma", { deletionSuggestionId: "s-del" }),
          ]),
        }),
      ],
    });
  }

  it("getWordCount defaults to the literal document (3 words)", () => {
    expect(getWordCount(build()).words).toBe(3);
  });

  it('getWordCount "final" excludes the deletion → "alpha beta " (2 words)', () => {
    expect(getWordCount(build(), { suggestionView: "final" }).words).toBe(2);
  });

  it('getWordCount "original" excludes the insertion → "alpha gamma" (2 words)', () => {
    expect(getWordCount(build(), { suggestionView: "original" }).words).toBe(2);
  });

  it("getSelectionWordCount honors the view over the selected span", () => {
    const state = build();
    const sel = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 16));
    expect(getSelectionWordCount(state, sel).words).toBe(3);
    expect(getSelectionWordCount(state, sel, "final").words).toBe(2);
    expect(getSelectionWordCount(state, sel, "original").words).toBe(2);
  });
});
