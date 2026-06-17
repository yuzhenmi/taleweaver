/**
 * Identity-preserving deletion-strike applier (#491, Task 2) — direct unit tests
 * for `applyDeletionStrikeInTx`.
 *
 * The applier walks one block's LIVE Y.Array over `[rangeStart, rangeEnd)` and,
 * per item, does EXACTLY what `applyAttrsToBlockRange` does (apply-attrs.ts) plus
 * one branch:
 *   - run wholly outside the range → skipped (Y.Text identity kept);
 *   - text run whole-covered, NOT own-insertion → tagged in place
 *     (`yItem.set("attrs", …)`, Y.Text identity kept) with the deletion id;
 *   - text run whole-covered, deleter's OWN pending insertion → deleted by index
 *     (don't-advance discipline; cursor still advances past the deleted extent);
 *   - text run partially covered → split before/middle/after; middle tagged OR
 *     omitted (own-insertion); the straddler loses Y.Text identity (unavoidable);
 *   - embed in range → kept untagged.
 * A post-pass `mergeAdjacentSameAttrsTextItemsInPlace` restores the normalization
 * invariants, so the live content is BYTE-IDENTICAL to the pure
 * `rebuildBlockForDeletion` + `mergeAdjacentTextItems` oracle.
 *
 * These call the applier directly inside a Y.Doc transaction (mirroring
 * `resolve-applier.test.ts` / `apply-attrs.test.ts`), reading/capturing raw Y
 * types via `getYBlock` and the `STATE_INTERNAL` live-doc accessor. Own-insertion
 * records are seeded via `writeSuggestionRecordInTx`.
 */
import * as Y from "yjs";
import { describe, it, expect } from "vitest";
import { applyDeletionStrikeInTx, rebuildBlockForDeletion } from "./suggestion-ops";
import { getYBlock, runTransaction } from "../yjs-doc";
import { STATE_INTERNAL } from "../state-internal";
import { writeSuggestionRecordInTx } from "../suggestions";
import type { SuggestionId } from "../suggestions";
import {
  DELETION_SUGGESTION_ATTR,
  INSERTION_SUGGESTION_ATTR,
} from "../suggestions";
import {
  buildBlock,
  buildState,
  text,
  embed,
  inlineContent,
} from "../../test-utils/state-builders";
import { mergeAdjacentTextItems } from "../inline-content";
import type { State } from "../state";
import type { ReadonlyAttrs } from "../attrs";
import type { InlineContent, InlineItem } from "../inline-content";
import type { BlockId } from "../block-id";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const DEL_ID = "del-1" as SuggestionId;
const AUTHOR = "alice";

/** doc > [ p(<items>) ] — one leaf block "p" holding the given inline content. */
function oneBlock(content: InlineContent): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: content,
      }),
    ],
  });
}

/** The live Y.Array of block "p"'s inline content (raw Y access for the test). */
function yItemsOf(state: State): Y.Array<Y.Map<unknown>> {
  const doc = state[STATE_INTERNAL].doc;
  const yBlock = getYBlock(doc, "p" as BlockId, "test", "block");
  return yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>>;
}

/** The Y.Text child of the item at `index` (raw Y access). */
function yTextAt(yItems: Y.Array<Y.Map<unknown>>, index: number): Y.Text {
  return yItems.get(index).get("text") as Y.Text;
}

/** The plain attrs object of the item at `index`. */
function attrsAt(yItems: Y.Array<Y.Map<unknown>>, index: number): Record<string, unknown> {
  const yAttrs = yItems.get(index).get("attrs") as Y.Map<unknown>;
  return yAttrs.toJSON() as Record<string, unknown>;
}

/** Read the live Y.Array back into a plain InlineItem[] for oracle comparison. */
function liveItems(yItems: Y.Array<Y.Map<unknown>>): InlineItem[] {
  const out: InlineItem[] = [];
  for (let i = 0; i < yItems.length; i++) {
    const yItem = yItems.get(i);
    const attrs = attrsAt(yItems, i);
    if (yItem.get("kind") === "text") {
      out.push({ kind: "text", text: yTextAt(yItems, i).toString(), attrs });
    } else {
      out.push({
        kind: "embed",
        embedType: yItem.get("embedType") as string,
        attrs,
        properties: (yItem.get("properties") as Y.Map<unknown>).toJSON() as Record<string, unknown>,
      });
    }
  }
  return out;
}

/** Run the applier on block "p" over [start, end) with the standard id/author. */
function strike(state: State, start: number, end: number): boolean {
  const doc = state[STATE_INTERNAL].doc;
  let tagged = false;
  runTransaction(doc, () => {
    tagged = applyDeletionStrikeInTx(
      doc,
      "p" as BlockId,
      "block",
      start,
      end,
      DEL_ID,
      AUTHOR,
      undefined,
      "test",
    ).tagged;
  });
  return tagged;
}

/** Seed an `insertion` record by `AUTHOR` for `id`, so it counts as own-insertion. */
function seedOwnInsertion(state: State, id: string): void {
  const doc = state[STATE_INTERNAL].doc;
  runTransaction(doc, () => {
    writeSuggestionRecordInTx(doc, {
      id: id as SuggestionId,
      kind: "insertion",
      author: AUTHOR,
      createdAt: 0,
    });
  });
}

describe("applyDeletionStrikeInTx", () => {
  it("tags a whole-covered run in place — preserves its Y.Text identity", () => {
    // items: text("xx", {bold:true}), text("yy", {italic:true})
    // strike [0,2): the "xx" run is fully covered, not an own-insertion → tagged
    // in place. Distinct neighbor attrs ⇒ no coalesce ⇒ Y.Text MUST survive (===).
    const state = oneBlock(
      inlineContent([text("xx", { bold: true }), text("yy", { italic: true })]),
    );
    const yItems = yItemsOf(state);
    const xxText = yTextAt(yItems, 0);

    const tagged = strike(state, 0, 2);

    expect(tagged).toBe(true);
    expect(yItems.length).toBe(2);
    expect(yTextAt(yItems, 0).toString()).toBe("xx");
    expect(attrsAt(yItems, 0)).toEqual({ bold: true, [DELETION_SUGGESTION_ATTR]: DEL_ID });
    expect(yTextAt(yItems, 0)).toBe(xxText); // in-place attrs swap, same Y.Text
    expect(yTextAt(yItems, 1).toString()).toBe("yy");
    expect(attrsAt(yItems, 1)).toEqual({ italic: true });
  });

  it("keeps a run wholly outside the range untouched (Y.Text identity ===)", () => {
    // items: text("aa", {}), text("bb", {bold:true})
    // strike [0,2): only "aa" is covered; "bb" is wholly outside ⇒ never written.
    const state = oneBlock(
      inlineContent([text("aa", {}), text("bb", { bold: true })]),
    );
    const yItems = yItemsOf(state);
    const bbText = yTextAt(yItems, 1);

    strike(state, 0, 2);

    expect(yItems.length).toBe(2);
    expect(yTextAt(yItems, 1).toString()).toBe("bb");
    expect(attrsAt(yItems, 1)).toEqual({ bold: true });
    expect(yTextAt(yItems, 1)).toBe(bbText); // untouched survivor keeps identity
  });

  it("drops a whole-covered own-insertion run by index (not tagged)", () => {
    // items: text("ab", {ins:"i1"}) own-insertion, text("cd", {bold:true})
    // strike [0,2): "ab" is the deleter's own pending insertion → deleted for real.
    const state = oneBlock(
      inlineContent([
        text("ab", { [INSERTION_SUGGESTION_ATTR]: "i1" }),
        text("cd", { bold: true }),
      ]),
    );
    seedOwnInsertion(state, "i1");
    const yItems = yItemsOf(state);
    const cdText = yTextAt(yItems, 1);

    const tagged = strike(state, 0, 2);

    expect(tagged).toBe(false); // nothing tagged — only an own-insertion dropped
    expect(yItems.length).toBe(1);
    expect(yTextAt(yItems, 0).toString()).toBe("cd");
    expect(attrsAt(yItems, 0)).toEqual({ bold: true });
    expect(yTextAt(yItems, 0)).toBe(cdText); // survivor keeps identity
  });

  it("splits a straddling run — before kept (orig attrs), middle tagged", () => {
    // items: text("abcd", {bold:true})
    // strike [2,4): "ab" stays {bold}, "cd" gains the deletion id.
    const state = oneBlock(inlineContent([text("abcd", { bold: true })]));

    const tagged = strike(state, 2, 4);

    expect(tagged).toBe(true);
    expect(yItems2(state)).toEqual([
      { text: "ab", attrs: { bold: true } },
      { text: "cd", attrs: { bold: true, [DELETION_SUGGESTION_ATTR]: DEL_ID } },
    ]);
  });

  it("partial own-insertion — before kept, middle OMITTED, after kept", () => {
    // items: text("a", {ins:"i1"}) own-insertion, text("BCDEF", {bold:true})
    // strike [1,3): "a" kept; the "BC" portion of the second run is dropped only
    // if it is own-insertion — here it is NOT, so it is tagged. To exercise the
    // OWN-insertion partial-drop in isolation (before kept, middle OMITTED, after
    // kept) with NO coalescing masking it, give before/after DISTINCT attrs from
    // each other via a neighbor: text("abcdef", {ins:"i1"}) then a distinct tail.
    const state = oneBlock(
      inlineContent([
        text("abcdef", { [INSERTION_SUGGESTION_ATTR]: "i1" }),
        text("Z", { bold: true }),
      ]),
    );
    seedOwnInsertion(state, "i1");

    const tagged = strike(state, 2, 4);

    expect(tagged).toBe(false);
    // "cd" dropped; "ab" + "ef" are same-attrs adjacent → coalesce into "abef"
    // (byte-identical to the rebuild+merge oracle); the distinct "Z" tail follows.
    expect(yItems2(state)).toEqual([
      { text: "abef", attrs: { [INSERTION_SUGGESTION_ATTR]: "i1" } },
      { text: "Z", attrs: { bold: true } },
    ]);
  });

  it("keeps an embed in range untagged", () => {
    // items: text("ab", {}), embed(footnote-anchor), text("cd", {})
    // strike [0,4): both text runs covered; the embed (offset 2) is kept untagged.
    const state = oneBlock(
      inlineContent([
        text("ab", {}),
        embed("footnote-anchor", { contentBlockId: "fn1" }, {}),
        text("cd", {}),
      ]),
    );

    strike(state, 0, 4);

    const yItems = yItemsOf(state);
    // The embed survives untagged at its position; surrounding text is tagged.
    const embedIdx = liveItems(yItems).findIndex((it) => it.kind === "embed");
    expect(embedIdx).toBeGreaterThanOrEqual(0);
    expect(nth(liveItems(yItems), embedIdx, "embed item").attrs).toEqual({});
  });

  it("coalesces a newly-tagged run into a same-id neighbor (post-pass)", () => {
    // items: text("ab", {del:DEL_ID}) already-tagged, text("cd", {})
    // strike [2,4): tagging "cd" with DEL_ID makes it attrs-equal to "ab" ⇒ merge.
    const state = oneBlock(
      inlineContent([
        text("ab", { [DELETION_SUGGESTION_ATTR]: DEL_ID }),
        text("cd", {}),
      ]),
    );

    strike(state, 2, 4);

    const yItems = yItemsOf(state);
    expect(yItems.length).toBe(1);
    expect(yTextAt(yItems, 0).toString()).toBe("abcd");
    expect(attrsAt(yItems, 0)).toEqual({ [DELETION_SUGGESTION_ATTR]: DEL_ID });
  });

  it("re-striking a run already carrying this exact id fires no change (no-op guard)", () => {
    // items: text("ab", {del:DEL_ID})
    // strike [0,2) with the SAME id → the no-op guard skips the write; Y.Text ===.
    const state = oneBlock(
      inlineContent([text("ab", { [DELETION_SUGGESTION_ATTR]: DEL_ID })]),
    );
    const yItems = yItemsOf(state);
    const abText = yTextAt(yItems, 0);

    strike(state, 0, 2);

    expect(yItems.length).toBe(1);
    expect(yTextAt(yItems, 0)).toBe(abText); // same Y.Text — no write fired
    expect(attrsAt(yItems, 0)).toEqual({ [DELETION_SUGGESTION_ATTR]: DEL_ID });
  });

  it("zero-width range no-ops (rangeStart === rangeEnd)", () => {
    const state = oneBlock(inlineContent([text("ab", {})]));
    const yItems = yItemsOf(state);
    const abText = yTextAt(yItems, 0);

    const tagged = strike(state, 1, 1);

    expect(tagged).toBe(false);
    expect(yItems.length).toBe(1);
    expect(yTextAt(yItems, 0)).toBe(abText);
    expect(attrsAt(yItems, 0)).toEqual({});
  });

  describe("oracle-diff against rebuildBlockForDeletion + mergeAdjacentTextItems", () => {
    interface OracleCase {
      readonly name: string;
      readonly items: ReadonlyArray<InlineItem>;
      readonly start: number;
      readonly end: number;
      readonly ownInsertionIds?: ReadonlyArray<string>;
    }

    const cases: ReadonlyArray<OracleCase> = [
      {
        name: "single-run partial strike",
        items: [text("hello world", { bold: true })],
        start: 2,
        end: 7,
      },
      {
        name: "multi-run strike spanning a boundary",
        items: [text("abc", {}), text("def", { bold: true }), text("ghi", {})],
        start: 1,
        end: 8,
      },
      {
        name: "MANDATED — whole-covered own-insertion precedes another in-range item (drop ab, tag c, keep d)",
        items: [
          text("ab", { [INSERTION_SUGGESTION_ATTR]: "i1" }),
          text("cd", {}),
        ],
        start: 0,
        end: 3,
        ownInsertionIds: ["i1"],
      },
      {
        name: "whole-span own-insertions (taggedAny false)",
        items: [
          text("ab", { [INSERTION_SUGGESTION_ATTR]: "i1" }),
          text("cd", { [INSERTION_SUGGESTION_ATTR]: "i1" }),
        ],
        start: 0,
        end: 4,
        ownInsertionIds: ["i1"],
      },
      {
        name: "embed in range kept untagged",
        items: [
          text("ab", {}),
          embed("footnote-anchor", { contentBlockId: "fn1" }, {}),
          text("cd", {}),
        ],
        start: 0,
        end: 4,
      },
      {
        name: "boundary straddlers on both edges",
        items: [text("abcdefgh", { bold: true })],
        start: 3,
        end: 5,
      },
      {
        name: "coalesce into a same-id neighbor",
        items: [
          text("ab", { [DELETION_SUGGESTION_ATTR]: DEL_ID }),
          text("cdef", {}),
        ],
        start: 2,
        end: 4,
      },
    ];

    for (const c of cases) {
      it(c.name, () => {
        const state = oneBlock(inlineContent([...c.items]));
        for (const id of c.ownInsertionIds ?? []) seedOwnInsertion(state, id);
        const doc = state[STATE_INTERNAL].doc;

        // Oracle: pure rebuild + merge over the SAME items/range/id/author.
        const oracle = mergeAdjacentTextItems(
          rebuildBlockForDeletion(c.items, c.start, c.end, DEL_ID, AUTHOR, doc).items,
        );

        const tagged = strike(state, c.start, c.end);
        // The applier's `tagged` return is the load-bearing cross-check the wiring
        // (markDeletion) dev-asserts against `plan.taggedAny`. Diff it against the
        // oracle too: tagged iff the oracle produced ≥1 run carrying the deletion id.
        const expectedTagged = oracle.some(
          (item) => item.kind === "text" && item.attrs[DELETION_SUGGESTION_ATTR] === DEL_ID,
        );
        expect(tagged).toBe(expectedTagged);

        const live = liveItems(yItemsOf(state));

        expect(live.length).toBe(oracle.length);
        for (let i = 0; i < oracle.length; i++) {
          const expectedItem = nth(oracle, i, "oracle item");
          const actualItem = nth(live, i, "live item");
          expect(actualItem.kind).toBe(expectedItem.kind);
          expect(actualItem.attrs).toEqual(expectedItem.attrs);
          if (expectedItem.kind === "text" && actualItem.kind === "text") {
            expect(actualItem.text).toBe(expectedItem.text);
          } else if (expectedItem.kind === "embed" && actualItem.kind === "embed") {
            expect(actualItem.embedType).toBe(expectedItem.embedType);
            expect(actualItem.properties).toEqual(expectedItem.properties);
          }
        }
      });
    }
  });
});

/**
 * Convenience: read block "p"'s live runs as {text, attrs} for text-only fixtures.
 * Narrows on `kind` (no unsafe cast) and throws clearly if a fixture unexpectedly
 * contains an embed — rather than silently `.toString()`-ing an `undefined` Y.Text.
 */
function yItems2(state: State): ReadonlyArray<{ text: string; attrs: ReadonlyAttrs }> {
  return liveItems(yItemsOf(state)).map((item) => {
    if (item.kind !== "text") {
      throw new Error(`yItems2: expected a text item, got "${item.kind}"`);
    }
    return { text: item.text, attrs: item.attrs };
  });
}
