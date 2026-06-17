/**
 * Change-tracking slice 4e-state-split — `splitWithSuggestion`, the suggested
 * paragraph-SPLIT op (Enter in Suggesting mode).
 *
 * A suggested split = both halves are REAL separate blocks (a normal block split)
 * PLUS a zero-width `block-split-suggestion` embed at the END of the FIRST block
 * carrying the owning `suggestionId` in its `properties` PLUS an `insertion`
 * `SuggestionRecord` — ALL in ONE tracked transaction (one undo entry).
 *
 * The load-bearing properties exercised here: (1) the structural split is real (two
 * linked blocks); (2) the break embed lands as the LAST item of the first block and
 * occupies exactly ONE offset; (3) an `insertion` record is written with the right
 * id/author/createdAt; (4) the whole op (split + embed + record) is ONE undo unit;
 * (5) it works at mid/start/end offsets, with `newBlockInit`, and on a non-first
 * block.
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { splitWithSuggestion } from "./split-block";
import {
  getSuggestions,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  type SuggestionId,
} from "../suggestions";
import { createHistory } from "../history";
import { getBlock } from "../state";
import type { State } from "../state";
import { STATE_INTERNAL } from "../state-internal";
import { getYBlock } from "../yjs-doc";
import { inlineContentLength } from "../inline-content";
import {
  buildBlock,
  buildState,
  text,
  inlineContent,
} from "../../test-utils/state-builders";
import { createPosition } from "../block-position";
import { createTestAllocator, type BlockId } from "../block-id";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const SID = "split-1" as SuggestionId;
const INPUT = { id: SID, author: "alice", createdAt: 1000 } as const;

/** doc > [ p("abcdef") ] — one text run. */
function oneBlock(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("abcdef")]),
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

describe("splitWithSuggestion — mid split: real split + break embed + insertion record", () => {
  it("makes TWO real linked blocks; first block gets the break embed; one insertion record", () => {
    const allocator = createTestAllocator("p2");
    const result = splitWithSuggestion(
      oneBlock(),
      createPosition("p" as BlockId, 3),
      allocator,
      INPUT,
    );
    const s = result.state;

    // Block N: text "abc" + a trailing block-split-suggestion embed carrying the id.
    const nItems = itemsOf(s, "p");
    expect(textOf(s, "p")).toBe("abc");
    const lastN = nth(nItems, nItems.length - 1, "last item");
    expect(lastN.kind).toBe("embed");
    if (lastN.kind !== "embed") throw new Error("expected the break embed as last item of N");
    expect(lastN.embedType).toBe(BLOCK_SPLIT_SUGGESTION_EMBED_TYPE);
    expect(lastN.properties.suggestionId).toBe(SID);
    // N's offset length = "abc"(3) + embed(1) = 4 (the embed occupies one offset).
    const nContent = getBlock(s, "p" as BlockId)?.inlineContent;
    if (nContent == null) throw new Error("expected block N inlineContent");
    expect(inlineContentLength(nContent)).toBe(4);

    // Block N+1: text "def", no break embed.
    expect(textOf(s, "p2-0")).toBe("def");
    expect(itemsOf(s, "p2-0").some((it) => it.kind === "embed")).toBe(false);

    // The two blocks are linked siblings under the same parent.
    const n = getBlock(s, "p" as BlockId);
    const np1 = getBlock(s, "p2-0" as BlockId);
    expect(n?.nextSiblingId).toBe("p2-0");
    expect(np1?.prevSiblingId).toBe("p");
    expect(np1?.parentId).toBe(n?.parentId);
    expect(np1?.parentId).toBe("doc");

    // Exactly ONE insertion record, with the right id/author/createdAt.
    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    const sug = nth(suggestions, 0, "suggestion");
    expect(sug.id).toBe(SID);
    expect(sug.kind).toBe("insertion");
    expect(sug.author).toBe("alice");
    expect(sug.createdAt).toBe(1000);
    // Range-index round-trip: the break embed must surface the suggestion's RANGE
    // (the embed's `properties.suggestionId` is the key `buildSuggestionRangeIndex`
    // reads). A wrong key / embedType would silently report orphaned:true,range:null
    // while every assertion above still passed.
    expect(sug.orphaned).toBe(false);
    expect(sug.range).toEqual({
      start: { blockId: "p", offset: 3 },
      end: { blockId: "p", offset: 4 },
    });
  });
});

describe("splitWithSuggestion — offset invariant: the break embed occupies exactly one offset and is last", () => {
  it("first block's inline length is content-length + 1 and the embed is the final item", () => {
    const allocator = createTestAllocator("p2");
    const s = splitWithSuggestion(
      oneBlock(),
      createPosition("p" as BlockId, 3),
      allocator,
      INPUT,
    ).state;

    const nContent = getBlock(s, "p" as BlockId)?.inlineContent;
    if (nContent == null) throw new Error("expected block N inlineContent");
    // "abc" (3 offsets) + embed (1 offset) = 4.
    expect(inlineContentLength(nContent)).toBe(4);

    const items = nContent.items;
    // The break embed is the LAST item; there is exactly one such embed.
    const last = nth(items, items.length - 1, "last item");
    expect(last.kind).toBe("embed");
    expect(
      items.filter(
        (it) => it.kind === "embed" && it.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
      ).length,
    ).toBe(1);
  });
});

describe("splitWithSuggestion — split at END (offset = length), with newBlockInit", () => {
  it("first block keeps all text + the embed; new (empty) block honors newBlockInit.type", () => {
    const allocator = createTestAllocator("p2");
    const s = splitWithSuggestion(
      oneBlock(),
      createPosition("p" as BlockId, 6),
      allocator,
      INPUT,
      { type: "paragraph" },
    ).state;

    // N: "abcdef" + break embed.
    expect(textOf(s, "p")).toBe("abcdef");
    const nItems = itemsOf(s, "p");
    expect(nth(nItems, nItems.length - 1, "last item").kind).toBe("embed");

    // N+1: empty, type forced to paragraph by newBlockInit.
    expect(textOf(s, "p2-0")).toBe("");
    expect(itemsOf(s, "p2-0").length).toBe(0);
    expect(getBlock(s, "p2-0" as BlockId)?.type).toBe("paragraph");

    // The insertion record is still written.
    expect(getSuggestions(s).length).toBe(1);
    expect(nth(getSuggestions(s), 0, "suggestion").kind).toBe("insertion");
  });
});

describe("splitWithSuggestion — split at START (offset 0)", () => {
  it("first block holds only the break embed (empty text); new block holds all the text", () => {
    const allocator = createTestAllocator("p2");
    const s = splitWithSuggestion(
      oneBlock(),
      createPosition("p" as BlockId, 0),
      allocator,
      INPUT,
    ).state;

    // N: no text, just the break embed.
    expect(textOf(s, "p")).toBe("");
    const nItems = itemsOf(s, "p");
    expect(nItems.length).toBe(1);
    const firstItem = nth(nItems, 0, "item");
    expect(firstItem.kind).toBe("embed");
    if (firstItem.kind !== "embed") throw new Error("expected break embed");
    expect(firstItem.embedType).toBe(BLOCK_SPLIT_SUGGESTION_EMBED_TYPE);

    // N+1: all the original text.
    expect(textOf(s, "p2-0")).toBe("abcdef");

    expect(getSuggestions(s).length).toBe(1);
  });
});

describe("splitWithSuggestion — ONE undo entry (split + embed + record are one transaction)", () => {
  it("a single undo reverts the WHOLE op back to one block, no embed, no record", () => {
    const s0 = oneBlock();
    const history = createHistory(s0);

    history.beginEntry("command", 0);
    const allocator = createTestAllocator("p2");
    const split = splitWithSuggestion(
      s0,
      createPosition("p" as BlockId, 3),
      allocator,
      INPUT,
    );
    history.commit(split, { before: null, after: null });
    const s1 = split.state;

    // Post-op: two blocks, embed on N, one record.
    expect(getBlock(s1, "p2-0" as BlockId)).not.toBeNull();
    expect(getSuggestions(s1).length).toBe(1);
    expect(
      itemsOf(s1, "p").some(
        (it) => it.kind === "embed" && it.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
      ),
    ).toBe(true);

    // ONE undo reverts everything.
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const s2 = undone.state;
    // Back to the single original block "abcdef".
    expect(textOf(s2, "p")).toBe("abcdef");
    expect(getBlock(s2, "p2-0" as BlockId)).toBeNull();
    // No break embed anywhere.
    expect(itemsOf(s2, "p").some((it) => it.kind === "embed")).toBe(false);
    // No record.
    expect(getSuggestions(s2).length).toBe(0);

    history.destroy();
  });
});

describe("splitWithSuggestion — non-first block", () => {
  it("splits the SECOND paragraph: correct siblings + insertion record", () => {
    // doc > [ p1("hello"), p2("world") ]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p2",
          inlineContent: inlineContent([text("hello")]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          inlineContent: inlineContent([text("world")]),
        }),
      ],
    });
    const allocator = createTestAllocator("p3");
    const s = splitWithSuggestion(
      state,
      createPosition("p2" as BlockId, 2),
      allocator,
      INPUT,
    ).state;

    // p2 → "wo" + break embed; new block "rld".
    expect(textOf(s, "p2")).toBe("wo");
    const p2Items = itemsOf(s, "p2");
    expect(nth(p2Items, p2Items.length - 1, "last item").kind).toBe("embed");
    expect(textOf(s, "p3-0")).toBe("rld");

    // Siblings: p1 → p2 → p3-0 (new) chain; p1 untouched.
    const p1 = getBlock(s, "p1" as BlockId);
    const p2 = getBlock(s, "p2" as BlockId);
    const np = getBlock(s, "p3-0" as BlockId);
    expect(p1?.nextSiblingId).toBe("p2");
    expect(p2?.prevSiblingId).toBe("p1");
    expect(p2?.nextSiblingId).toBe("p3-0");
    expect(np?.prevSiblingId).toBe("p2");
    expect(np?.parentId).toBe("doc");

    // One insertion record.
    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("insertion");
    expect(nth(suggestions, 0, "suggestion").id).toBe(SID);
  });
});

describe("splitWithSuggestion — CRDT identity: block N's surviving text-run Y.Text is preserved (append, not full-replace)", () => {
  /**
   * The underlying Y.Text instance of block N's FIRST inline item (a text run).
   * Reaches through the module-private Symbol → live Y.Doc → owning tree map →
   * the block's `inlineContent` Y.Array → item 0 Y.Map → its `text` Y.Text.
   */
  function firstRunYText(s: State, blockId: string): Y.Text {
    const doc = s[STATE_INTERNAL].doc;
    const yBlock = getYBlock(doc, blockId as BlockId, "test", "block");
    const yItems = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>>;
    const yText = yItems.get(0).get("text");
    if (!(yText instanceof Y.Text)) {
      throw new Error("expected block N's first item to be a text run with a Y.Text");
    }
    return yText;
  }

  it("the SAME Y.Text instance is still N's first run after a mid-run suggested split", () => {
    const s0 = oneBlock();
    // Capture the Y.Text instance BEFORE the op. The append-the-embed path shortens
    // this Y.Text in place (the structural split) and pushes the break embed AFTER it,
    // so the instance survives === . The old full-replace materialized a fresh Y.Text
    // per item → this assertion would FAIL (reference inequality).
    const before = firstRunYText(s0, "p");
    expect(before.toString()).toBe("abcdef");

    const allocator = createTestAllocator("p2");
    const s = splitWithSuggestion(
      s0,
      createPosition("p" as BlockId, 3),
      allocator,
      INPUT,
    ).state;

    // Identity lock: N's surviving first text run is the SAME Y.Text instance.
    const after = firstRunYText(s, "p");
    expect(after).toBe(before);
    // ...shortened in place to the left half "abc".
    expect(after.toString()).toBe("abc");

    // Behavioral guards still hold: N = "abc" + the break embed last; N+1 = "def".
    const nItems = itemsOf(s, "p");
    expect(textOf(s, "p")).toBe("abc");
    expect(nth(nItems, nItems.length - 1, "last item").kind).toBe("embed");
    expect(textOf(s, "p2-0")).toBe("def");
    // ...and the insertion record is written.
    expect(getSuggestions(s).length).toBe(1);
  });
});
