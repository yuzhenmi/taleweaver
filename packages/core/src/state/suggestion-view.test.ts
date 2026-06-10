/**
 * Change-tracking slice 5c-i — `itemVisibleInView`, the pure per-item visibility
 * predicate that is the foundation of the SuggestionView preview projection
 * (what `extractText` / `getWordCount` / render see over a doc with pending
 * tracked changes):
 *   - "suggesting" → the literal doc: everything visible.
 *   - "final" (accept all) → deletion runs + block-join embeds absent.
 *   - "original" (reject all) → insertion runs + block-split embeds absent.
 */
import { describe, it, expect } from "vitest";
import {
  itemVisibleInView,
  blockBoundaryMergesInView,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  FORMATTING_SUGGESTION_ATTR,
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  type SuggestionId,
} from "./suggestions";
import { text, embed } from "../test-utils/state-builders";

const ID = "s1" as SuggestionId;

describe("itemVisibleInView (slice 5c-i projection foundation)", () => {
  describe('"suggesting" view — the literal document (everything visible)', () => {
    it("keeps plain, insertion, deletion, formatting runs and both break embeds", () => {
      expect(itemVisibleInView(text("plain"), "suggesting")).toBe(true);
      expect(itemVisibleInView(text("ins", { [INSERTION_SUGGESTION_ATTR]: ID }), "suggesting")).toBe(true);
      expect(itemVisibleInView(text("del", { [DELETION_SUGGESTION_ATTR]: ID }), "suggesting")).toBe(true);
      expect(itemVisibleInView(text("fmt", { [FORMATTING_SUGGESTION_ATTR]: ID }), "suggesting")).toBe(true);
      expect(itemVisibleInView(embed(BLOCK_SPLIT_SUGGESTION_EMBED_TYPE, { suggestionId: ID }), "suggesting")).toBe(true);
      expect(itemVisibleInView(embed(BLOCK_JOIN_SUGGESTION_EMBED_TYPE, { suggestionId: ID }), "suggesting")).toBe(true);
    });
  });

  describe('"final" view — accept all (deletions removed, insertions kept)', () => {
    it("drops a deletion run and a block-join embed; keeps insertion/formatting/plain/split", () => {
      expect(itemVisibleInView(text("del", { [DELETION_SUGGESTION_ATTR]: ID }), "final")).toBe(false);
      expect(itemVisibleInView(embed(BLOCK_JOIN_SUGGESTION_EMBED_TYPE, { suggestionId: ID }), "final")).toBe(false);
      // kept: the insertion is accepted (becomes real text), formatting stays
      // visible (only its style changes), plain text and the split embed survive.
      expect(itemVisibleInView(text("ins", { [INSERTION_SUGGESTION_ATTR]: ID }), "final")).toBe(true);
      expect(itemVisibleInView(text("fmt", { [FORMATTING_SUGGESTION_ATTR]: ID }), "final")).toBe(true);
      expect(itemVisibleInView(text("plain"), "final")).toBe(true);
      expect(itemVisibleInView(embed(BLOCK_SPLIT_SUGGESTION_EMBED_TYPE, { suggestionId: ID }), "final")).toBe(true);
    });
  });

  describe('"original" view — reject all (insertions removed, deletions kept)', () => {
    it("drops an insertion run and a block-split embed; keeps deletion/formatting/plain/join", () => {
      expect(itemVisibleInView(text("ins", { [INSERTION_SUGGESTION_ATTR]: ID }), "original")).toBe(false);
      expect(itemVisibleInView(embed(BLOCK_SPLIT_SUGGESTION_EMBED_TYPE, { suggestionId: ID }), "original")).toBe(false);
      // kept: the deletion is rejected (text stays), formatting stays visible,
      // plain text and the join embed survive.
      expect(itemVisibleInView(text("del", { [DELETION_SUGGESTION_ATTR]: ID }), "original")).toBe(true);
      expect(itemVisibleInView(text("fmt", { [FORMATTING_SUGGESTION_ATTR]: ID }), "original")).toBe(true);
      expect(itemVisibleInView(text("plain"), "original")).toBe(true);
      expect(itemVisibleInView(embed(BLOCK_JOIN_SUGGESTION_EMBED_TYPE, { suggestionId: ID }), "original")).toBe(true);
    });
  });

  describe("inserted-then-struck run (both insertion + deletion ids)", () => {
    const insDel = text("x", {
      [INSERTION_SUGGESTION_ATTR]: ID,
      [DELETION_SUGGESTION_ATTR]: ID,
    });
    it("is absent in BOTH non-literal views (accept removes via deletion, reject via insertion)", () => {
      expect(itemVisibleInView(insDel, "final")).toBe(false);
      expect(itemVisibleInView(insDel, "original")).toBe(false);
      // still visible literally.
      expect(itemVisibleInView(insDel, "suggesting")).toBe(true);
    });
  });

  describe("non-suggestion embeds are always visible", () => {
    it("an unrelated embed (e.g. footnote-anchor) survives every view", () => {
      const fn = embed("footnote-anchor", { contentBlockId: "fn" });
      for (const view of ["suggesting", "final", "original"] as const) {
        expect(itemVisibleInView(fn, view)).toBe(true);
      }
    });
  });
});

describe("blockBoundaryMergesInView (slice 5c-structural merge predicate)", () => {
  const JOIN = embed(BLOCK_JOIN_SUGGESTION_EMBED_TYPE, { suggestionId: ID });
  const SPLIT = embed(BLOCK_SPLIT_SUGGESTION_EMBED_TYPE, { suggestionId: ID });

  it('"suggesting" never merges (the literal document)', () => {
    expect(blockBoundaryMergesInView([text("a"), JOIN], "suggesting")).toBe(false);
    expect(blockBoundaryMergesInView([text("a"), SPLIT], "suggesting")).toBe(false);
  });

  it('a trailing JOIN embed merges in "final" (deletion accepted) but not "original"', () => {
    expect(blockBoundaryMergesInView([text("a"), JOIN], "final")).toBe(true);
    expect(blockBoundaryMergesInView([text("a"), JOIN], "original")).toBe(false);
  });

  it('a trailing SPLIT embed merges in "original" (insertion rejected) but not "final"', () => {
    expect(blockBoundaryMergesInView([text("a"), SPLIT], "original")).toBe(true);
    expect(blockBoundaryMergesInView([text("a"), SPLIT], "final")).toBe(false);
  });

  it("never merges without a TRAILING break embed (plain block, or break embed not last)", () => {
    expect(blockBoundaryMergesInView([text("a")], "final")).toBe(false);
    expect(blockBoundaryMergesInView([], "final")).toBe(false);
    // a break embed that is NOT the last item does not denote a boundary merge.
    expect(blockBoundaryMergesInView([JOIN, text("a")], "final")).toBe(false);
  });
});
