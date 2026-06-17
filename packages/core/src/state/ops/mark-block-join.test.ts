/**
 * Change-tracking slice 4e-state-join — `markBlockJoinSuggestion`, the suggested
 * paragraph-JOIN op (Backspace at block-start / Delete at block-end in Suggesting
 * mode).
 *
 * A suggested join = both paragraphs stay REAL separate blocks (NO merge) PLUS a
 * zero-width `block-join-suggestion` embed at the END of the FIRST block (the prev
 * sibling of the second) carrying the owning `suggestionId` in its `properties`
 * PLUS a `deletion` `SuggestionRecord` — ALL in ONE tracked transaction (one undo
 * entry). Resolution (a LATER slice) does the actual merge on accept / removes the
 * embed on reject — NOT this op.
 *
 * The load-bearing properties exercised here: (1) NO structural merge (block count
 * unchanged, both still linked); (2) the break embed lands as the LAST item of the
 * first block and occupies exactly ONE offset; (3) a `deletion` record is written
 * with the right id/author/createdAt; (4) the range-index round-trips (orphaned
 * false, range = the embed's one-offset span); (5) the whole op is ONE undo unit;
 * (6) identity no-op when the second block is a first-child (no preceding break).
 */
import { describe, it, expect } from "vitest";
import { markBlockJoinSuggestion } from "./merge-blocks";
import {
  getSuggestions,
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  type SuggestionId,
} from "../suggestions";
import { createHistory } from "../history";
import { getBlock } from "../state";
import type { State } from "../state";
import { inlineContentLength } from "../inline-content";
import {
  buildBlock,
  buildState,
  text,
  embed,
  inlineContent,
} from "../../test-utils/state-builders";
import type { BlockId } from "../block-id";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const SID = "join-1" as SuggestionId;
const INPUT = { id: SID, author: "alice", createdAt: 2000 } as const;

/** doc > [ p1("abc"), p2("def") ] — two sibling paragraphs. */
function twoBlocks(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
      buildBlock({
        id: "p1",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "p2",
        inlineContent: inlineContent([text("abc")]),
      }),
      buildBlock({
        id: "p2",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "p1",
        inlineContent: inlineContent([text("def")]),
      }),
    ],
  });
}

/** The inline items of a block, or []. */
function itemsOf(s: State, id: string) {
  return getBlock(s, id as BlockId)?.inlineContent?.items ?? [];
}

/** The concatenated text of a block's text runs (embeds contribute nothing). */
function textOf(s: State, id: string): string {
  let out = "";
  for (const it of itemsOf(s, id)) {
    if (it.kind === "text") out += it.text;
  }
  return out;
}

/** Count of blocks present in the main tree (excluding the root). */
function leafBlockIds(s: State, ids: readonly string[]): string[] {
  return ids.filter((id) => getBlock(s, id as BlockId) !== null);
}

describe("markBlockJoinSuggestion — basic join mark: no merge + break embed + deletion record", () => {
  it("keeps both blocks SEPARATE; first block gets the break embed; one deletion record; range round-trips", () => {
    const result = markBlockJoinSuggestion(twoBlocks(), "p2" as BlockId, INPUT);
    const s = result.state;

    // NO merge: both blocks still present and still SEPARATE in the chain.
    expect(leafBlockIds(s, ["p1", "p2"])).toEqual(["p1", "p2"]);
    const p1 = getBlock(s, "p1" as BlockId);
    const p2 = getBlock(s, "p2" as BlockId);
    expect(p1?.nextSiblingId).toBe("p2");
    expect(p2?.prevSiblingId).toBe("p1");
    expect(p2?.parentId).toBe("doc");

    // Block N (p1): text "abc" + a trailing block-join-suggestion embed carrying the id.
    expect(textOf(s, "p1")).toBe("abc");
    const nItems = itemsOf(s, "p1");
    const lastN = nth(nItems, nItems.length - 1, "last item");
    expect(lastN.kind).toBe("embed");
    if (lastN.kind !== "embed") throw new Error("expected the break embed as last item of N");
    expect(lastN.embedType).toBe(BLOCK_JOIN_SUGGESTION_EMBED_TYPE);
    expect(lastN.properties.suggestionId).toBe(SID);
    // N's offset length = "abc"(3) + embed(1) = 4 (the embed occupies one offset).
    const nContent = getBlock(s, "p1" as BlockId)?.inlineContent;
    if (nContent == null) throw new Error("expected block N inlineContent");
    expect(inlineContentLength(nContent)).toBe(4);

    // Block 2 (p2): untouched — text "def", no break embed.
    expect(textOf(s, "p2")).toBe("def");
    expect(itemsOf(s, "p2").some((it) => it.kind === "embed")).toBe(false);

    // Exactly ONE deletion record, with the right id/author/createdAt.
    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    const sug = nth(suggestions, 0, "suggestion");
    expect(sug.id).toBe(SID);
    expect(sug.kind).toBe("deletion");
    expect(sug.author).toBe("alice");
    expect(sug.createdAt).toBe(2000);
    // Range-index round-trip: the break embed surfaces the suggestion's RANGE
    // (the embed's `properties.suggestionId` is the key `buildSuggestionRangeIndex`
    // reads). A wrong key / embedType would silently report orphaned:true,range:null
    // while every assertion above still passed.
    expect(sug.orphaned).toBe(false);
    expect(sug.range).toEqual({
      start: { blockId: "p1", offset: 3 },
      end: { blockId: "p1", offset: 4 },
    });
  });
});

describe("markBlockJoinSuggestion — offset invariant: the break embed occupies exactly one offset and is last", () => {
  it("first block's inline length is content-length + 1 and the embed is the final item", () => {
    const s = markBlockJoinSuggestion(twoBlocks(), "p2" as BlockId, INPUT).state;

    const nContent = getBlock(s, "p1" as BlockId)?.inlineContent;
    if (nContent == null) throw new Error("expected block N inlineContent");
    // "abc" (3 offsets) + embed (1 offset) = 4.
    expect(inlineContentLength(nContent)).toBe(4);

    const items = nContent.items;
    // The break embed is the LAST item; there is exactly one such embed.
    const last = nth(items, items.length - 1, "last item");
    expect(last.kind).toBe("embed");
    expect(
      items.filter(
        (it) => it.kind === "embed" && it.embedType === BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
      ).length,
    ).toBe(1);
  });
});

describe("markBlockJoinSuggestion — ONE undo entry (embed + record are one transaction)", () => {
  it("a single undo reverts the WHOLE op back to clean abc|def, no embed, no record", () => {
    const s0 = twoBlocks();
    const history = createHistory(s0);

    history.beginEntry("command", 0);
    const join = markBlockJoinSuggestion(s0, "p2" as BlockId, INPUT);
    history.commit(join, { before: null, after: null });
    const s1 = join.state;

    // Post-op: embed on N, one record.
    expect(getSuggestions(s1).length).toBe(1);
    expect(
      itemsOf(s1, "p1").some(
        (it) => it.kind === "embed" && it.embedType === BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
      ),
    ).toBe(true);

    // ONE undo reverts everything.
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const s2 = undone.state;
    // Back to clean "abc" | "def".
    expect(textOf(s2, "p1")).toBe("abc");
    expect(textOf(s2, "p2")).toBe("def");
    // No break embed anywhere.
    expect(itemsOf(s2, "p1").some((it) => it.kind === "embed")).toBe(false);
    // No record.
    expect(getSuggestions(s2).length).toBe(0);

    history.destroy();
  });
});

describe("markBlockJoinSuggestion — no-op on a first-child (no preceding break)", () => {
  it("marking the FIRST block is an identity no-op: same state ref, no record, no embed", () => {
    const state = twoBlocks();
    // p1 is the first child (prevSiblingId === null) — there is no break before it.
    const result = markBlockJoinSuggestion(state, "p1" as BlockId, INPUT);

    // Identity: the input State reference is returned unchanged.
    expect(result.state).toBe(state);
    // No suggestion record written.
    expect(getSuggestions(result.state).length).toBe(0);
    // No break embed appended anywhere.
    expect(itemsOf(result.state, "p1").some((it) => it.kind === "embed")).toBe(false);
    expect(itemsOf(result.state, "p2").some((it) => it.kind === "embed")).toBe(false);
  });

  it("marking a MISSING second block is an identity no-op", () => {
    const state = twoBlocks();
    const result = markBlockJoinSuggestion(state, "nope" as BlockId, INPUT);
    expect(result.state).toBe(state);
    expect(getSuggestions(result.state).length).toBe(0);
  });

  it("no-op when the prev sibling is a CONTAINER (can't hold an inline break embed)", () => {
    // doc → [container "c" (a table-cell-like container with a child), leaf "p"];
    // "p".prevSibling is the container, which has inlineContent: null.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "c", lastChildId: "p" }),
        buildBlock({
          id: "c",
          type: "container",
          parentId: "doc",
          nextSiblingId: "p",
          firstChildId: "cc",
          lastChildId: "cc",
        }),
        buildBlock({
          id: "cc",
          type: "paragraph",
          parentId: "c",
          inlineContent: inlineContent([text("x")]),
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "c",
          inlineContent: inlineContent([text("def")]),
        }),
      ],
    });
    const result = markBlockJoinSuggestion(state, "p" as BlockId, INPUT);
    expect(result.state).toBe(state);
    expect(getSuggestions(result.state).length).toBe(0);
  });

  it("appends the break embed AFTER an existing trailing embed on block N (two adjacent embeds, neither folded)", () => {
    // Block N already ends in some other (non-suggestion) embed; the join embed
    // must append as a distinct final item — embeds are merge barriers.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p2",
          inlineContent: inlineContent([text("ab"), embed("tab")]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          inlineContent: inlineContent([text("def")]),
        }),
      ],
    });
    const result = markBlockJoinSuggestion(state, "p2" as BlockId, INPUT);
    const items = itemsOf(result.state, "p1");
    // "ab"(text) + tab embed + join embed = 3 items; the LAST is the join embed.
    expect(items.length).toBe(3);
    const last = nth(items, items.length - 1, "last item");
    expect(last.kind).toBe("embed");
    expect(last.kind === "embed" ? last.properties.suggestionId : null).toBe(SID);
    // The pre-existing tab embed survives, distinct from the join embed.
    expect(items.filter((it) => it.kind === "embed").length).toBe(2);
  });
});

describe("markBlockJoinSuggestion — multi-block: mark the join before the THIRD paragraph", () => {
  it("the embed lands on the SECOND block (p3's prev sibling); p1/p3 untouched; one deletion record", () => {
    // doc > [ p1("one"), p2("two"), p3("three") ]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p2",
          inlineContent: inlineContent([text("one")]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          nextSiblingId: "p3",
          inlineContent: inlineContent([text("two")]),
        }),
        buildBlock({
          id: "p3",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p2",
          inlineContent: inlineContent([text("three")]),
        }),
      ],
    });

    const s = markBlockJoinSuggestion(state, "p3" as BlockId, INPUT).state;

    // The embed lands on p2 (p3's prev sibling), NOT p1 or p3.
    const p2Items = itemsOf(s, "p2");
    const lastP2 = nth(p2Items, p2Items.length - 1, "last item");
    expect(lastP2.kind).toBe("embed");
    if (lastP2.kind !== "embed") throw new Error("expected break embed on p2");
    expect(lastP2.embedType).toBe(BLOCK_JOIN_SUGGESTION_EMBED_TYPE);
    expect(textOf(s, "p2")).toBe("two");

    // p1 and p3 untouched — no embeds.
    expect(itemsOf(s, "p1").some((it) => it.kind === "embed")).toBe(false);
    expect(itemsOf(s, "p3").some((it) => it.kind === "embed")).toBe(false);
    expect(textOf(s, "p1")).toBe("one");
    expect(textOf(s, "p3")).toBe("three");

    // No merge: all three blocks present and linked.
    expect(leafBlockIds(s, ["p1", "p2", "p3"])).toEqual(["p1", "p2", "p3"]);

    // One deletion record.
    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(nth(suggestions, 0, "suggestion").id).toBe(SID);
  });
});
