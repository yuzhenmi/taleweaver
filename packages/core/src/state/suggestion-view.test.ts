/**
 * Change-tracking slice 5c-i — `itemVisibleInView`, the pure per-item visibility
 * predicate that is the foundation of the SuggestionView preview projection
 * (what `extractText` / `getWordCount` / render see over a doc with pending
 * tracked changes):
 *   - "suggesting" → the literal doc: everything visible.
 *   - "final" (accept all) → deletion runs absent.
 *   - "original" (reject all) → insertion runs absent.
 * Plus `boundaryMergesInView`, the paragraph-boundary merge predicate over the
 * break-suggestion TAGS (a join merges in "final", a split in "original").
 */
import { describe, it, expect } from "vitest";
import {
  itemVisibleInView,
  INSERTION_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  formattingSuggestionKey,
  type SuggestionId,
} from "./suggestions";
import { boundaryMergesInView } from "./break-suggestions";
import { markParagraphMarkDeletion } from "./ops/merge-blocks";
import { splitWithSuggestion } from "./ops/split-block";
import { getBlock, type State } from "./state";
import { createPosition } from "./block-position";
import { createTestAllocator, type BlockId } from "./block-id";
import { text, embed, buildBlock, buildState, inlineContent } from "../test-utils/state-builders";

const ID = "s1" as SuggestionId;

describe("itemVisibleInView (slice 5c-i projection foundation)", () => {
  describe('"suggesting" view — the literal document (everything visible)', () => {
    it("keeps plain, insertion, deletion and formatting runs", () => {
      expect(itemVisibleInView(text("plain"), "suggesting")).toBe(true);
      expect(itemVisibleInView(text("ins", { [INSERTION_SUGGESTION_ATTR]: ID }), "suggesting")).toBe(true);
      expect(itemVisibleInView(text("del", { [DELETION_SUGGESTION_ATTR]: ID }), "suggesting")).toBe(true);
      expect(itemVisibleInView(text("fmt", { [formattingSuggestionKey(ID)]: true }), "suggesting")).toBe(true);
    });
  });

  describe('"final" view — accept all (deletions removed, insertions kept)', () => {
    it("drops a deletion run; keeps insertion/formatting/plain", () => {
      expect(itemVisibleInView(text("del", { [DELETION_SUGGESTION_ATTR]: ID }), "final")).toBe(false);
      // kept: the insertion is accepted (becomes real text), formatting stays
      // visible (only its style changes), plain text survives.
      expect(itemVisibleInView(text("ins", { [INSERTION_SUGGESTION_ATTR]: ID }), "final")).toBe(true);
      expect(itemVisibleInView(text("fmt", { [formattingSuggestionKey(ID)]: true }), "final")).toBe(true);
      expect(itemVisibleInView(text("plain"), "final")).toBe(true);
    });
  });

  describe('"original" view — reject all (insertions removed, deletions kept)', () => {
    it("drops an insertion run; keeps deletion/formatting/plain", () => {
      expect(itemVisibleInView(text("ins", { [INSERTION_SUGGESTION_ATTR]: ID }), "original")).toBe(false);
      // kept: the deletion is rejected (text stays), formatting stays visible,
      // plain text survives.
      expect(itemVisibleInView(text("del", { [DELETION_SUGGESTION_ATTR]: ID }), "original")).toBe(true);
      expect(itemVisibleInView(text("fmt", { [formattingSuggestionKey(ID)]: true }), "original")).toBe(true);
      expect(itemVisibleInView(text("plain"), "original")).toBe(true);
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

describe("boundaryMergesInView (paragraph-boundary merge predicate over break tags)", () => {
  const INPUT = { id: ID, author: "alice", createdAt: 1 };
  /** doc > [ p1("a"), p2("b") ] — re-seeded per call (ops mutate the shared Y.Doc). */
  function twoBlocks(): State {
    return buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("b")]) }),
      ],
    });
  }
  function merges(s: State, left: string, right: string, view: "suggesting" | "final" | "original"): boolean {
    const l = getBlock(s, left as BlockId);
    const r = getBlock(s, right as BlockId);
    if (l === null || r === null) throw new Error("expected both blocks");
    return boundaryMergesInView(s, l, r, view);
  }
  const joined = (): State => markParagraphMarkDeletion(twoBlocks(), "p1" as BlockId, INPUT).state;
  // A split: the NEW head H carries the inserted ¶; p1 keeps the tail.
  const split = (): { s: State; head: BlockId } => {
    const r = splitWithSuggestion(twoBlocks(), createPosition("p1" as BlockId, 1), createTestAllocator("n"), INPUT);
    return { s: r.state, head: r.newBlockId };
  };

  it('"suggesting" never merges (the literal document)', () => {
    expect(merges(joined(), "p1", "p2", "suggesting")).toBe(false);
    const { s, head } = split();
    expect(merges(s, head, "p1", "suggesting")).toBe(false);
  });

  it('a JOIN tag merges in "final" (deletion accepted) but not "original"', () => {
    const s = joined();
    expect(merges(s, "p1", "p2", "final")).toBe(true);
    expect(merges(s, "p1", "p2", "original")).toBe(false);
  });

  it('a SPLIT tag merges in "original" (insertion rejected) but not "final"', () => {
    const { s, head } = split();
    expect(merges(s, head, "p1", "original")).toBe(true);
    expect(merges(s, head, "p1", "final")).toBe(false);
  });

  it("never merges an untagged boundary, or a non-adjacent pair", () => {
    expect(merges(twoBlocks(), "p1", "p2", "final")).toBe(false);
    expect(merges(twoBlocks(), "p1", "p2", "original")).toBe(false);
    // the key on ¶p1 names the p1|p2 boundary only — p2 → p1 is not a boundary.
    expect(merges(joined(), "p2", "p1", "final")).toBe(false);
  });
});
