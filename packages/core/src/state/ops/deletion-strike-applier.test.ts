/**
 * Deletion-strike applier (#491) — direct unit tests for `applyDeletionStrikeInTx`.
 *
 * Offset writes on the block's inline `Y.Text` over `[rangeStart, rangeEnd)`:
 *   - an in-range text run that is NOT the deleter's own pending insertion is
 *     TAGGED with the deletion id (`format` — its characters keep their identity);
 *   - the deleter's OWN pending insertion is deleted for real;
 *   - embeds in range are kept untagged.
 * The resulting read model equals the pure `rebuildBlockForDeletion` +
 * `mergeAdjacentTextItems` oracle.
 */
import { describe, it, expect } from "vitest";
import { applyDeletionStrikeInTx, rebuildBlockForDeletion } from "./suggestion-ops";
import { runTransaction } from "../yjs-doc";
import { inlineItemsFromYText } from "../y-inline";
import { blockText, relAt, survives } from "../../test-utils/relpos-survival";
import { freshState } from "../state";
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
import type { Document } from "../state";
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
function oneBlock(content: InlineContent): Document {
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

/** Block "p"'s live inline items (the read model of its Y.Text). */
function liveItems(state: Document): InlineItem[] {
  return inlineItemsFromYText(blockText(state, "p"));
}

/** `{ text, attrs }` of every text item (compact assertions). */
function yItems2(state: Document): { text: string; attrs: ReadonlyAttrs }[] {
  return liveItems(state).flatMap((it) => (it.kind === "text" ? [{ text: it.text, attrs: it.attrs }] : []));
}

/** Run the applier on block "p" over [start, end) with the standard id/author. */
function strike(state: Document, start: number, end: number): boolean {
  const doc = state[STATE_INTERNAL].doc;
  let tagged = false;
  runTransaction(doc, () => {
    tagged = applyDeletionStrikeInTx(doc, [{ blockId: "p" as BlockId, rangeStart: start, rangeEnd: end }], DEL_ID, AUTHOR, "test", new Set()).tagged;
  });
  return tagged;
}

/** Seed an `insertion` record by `AUTHOR` for `id`, so it counts as own-insertion. */
function seedOwnInsertion(state: Document, id: string): void {
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
  it("tags a covered run in place — every struck character keeps its identity", () => {
    const state = oneBlock(
      inlineContent([text("xx", { bold: true }), text("yy", { italic: true })]),
    );
    const relX = relAt(state, "p", 1);
    const relY = relAt(state, "p", 2);

    const tagged = strike(state, 0, 2);

    expect(tagged).toBe(true);
    expect(yItems2(state)).toEqual([
      { text: "xx", attrs: { bold: true, [DELETION_SUGGESTION_ATTR]: DEL_ID } },
      { text: "yy", attrs: { italic: true } },
    ]);
    const after = freshState(state, new Set(["p" as BlockId]));
    expect(survives(relX, after, "x")).toBe(true);
    expect(survives(relY, after, "y")).toBe(true);
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
    const relC = relAt(state, "p", 2);

    const tagged = strike(state, 0, 2);

    expect(tagged).toBe(false); // nothing tagged — only an own-insertion dropped
    expect(yItems2(state)).toEqual([{ text: "cd", attrs: { bold: true } }]);
    expect(survives(relC, freshState(state, new Set(["p" as BlockId])), "c")).toBe(true);
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

  it("a range endpoint inside a surrogate pair is snapped OUT before tagging (no U+FFFD)", () => {
    const state = oneBlock(inlineContent([text("a😀b")]));

    expect(strike(state, 2, 4)).toBe(true);

    expect(yItems2(state)).toEqual([
      { text: "a", attrs: {} },
      { text: "😀b", attrs: { [DELETION_SUGGESTION_ATTR]: DEL_ID } },
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

    // The embed survives untagged at its position; surrounding text is tagged.
    const embedIdx = liveItems(state).findIndex((it) => it.kind === "embed");
    expect(embedIdx).toBeGreaterThanOrEqual(0);
    expect(nth(liveItems(state), embedIdx, "embed item").attrs).toEqual({});
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

    expect(yItems2(state)).toEqual([{ text: "abcd", attrs: { [DELETION_SUGGESTION_ATTR]: DEL_ID } }]);
  });

  it("re-striking a run already carrying this exact id fires no change (no-op guard)", () => {
    // items: text("ab", {del:DEL_ID})
    // strike [0,2) with the SAME id → the no-op guard skips the write; Y.Text ===.
    const state = oneBlock(
      inlineContent([text("ab", { [DELETION_SUGGESTION_ATTR]: DEL_ID })]),
    );
    const doc = state[STATE_INTERNAL].doc;
    let changed = 0;
    const onTx = (tx: { changed: Map<unknown, unknown> }): void => {
      if (tx.changed.size > 0) changed++;
    };
    doc.on("afterTransaction", onTx);
    strike(state, 0, 2);
    doc.off("afterTransaction", onTx);

    expect(changed).toBe(0); // no write fired
    expect(yItems2(state)).toEqual([{ text: "ab", attrs: { [DELETION_SUGGESTION_ATTR]: DEL_ID } }]);
  });

  it("zero-width range no-ops (rangeStart === rangeEnd)", () => {
    const state = oneBlock(inlineContent([text("ab", {})]));

    const tagged = strike(state, 1, 1);

    expect(tagged).toBe(false);
    expect(yItems2(state)).toEqual([{ text: "ab", attrs: {} }]);
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

        const live = liveItems(state);

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
