/**
 * Change-tracking slice 4e-state-split — `splitWithSuggestion`, the suggested
 * paragraph-SPLIT op (Enter in Suggesting mode).
 *
 * A suggested split = both halves are REAL separate blocks (a normal block split,
 * the NEW head H takes the text before the caret, the block keeps
 * the tail and its id) PLUS an `insertionSuggestionId` key on the NEW ¶ — ¶H's own
 * registry entry (Enter at offset 0 needs no special case: H is the empty
 * paragraph above) PLUS an `insertion` `SuggestionRecord` — ALL in ONE tracked
 * transaction (one undo entry). No inline item is added.
 *
 * The load-bearing properties exercised here: (1) the structural split is real (two
 * linked blocks); (2) the tag lands on the right block and inline lengths are just the
 * text; (3) an `insertion` record is written with the right id/author/createdAt; (4)
 * the whole op (split + tag + record) is ONE undo unit; (5) it works at
 * mid/start/end offsets, with `newBlockInit`, and on a non-first block.
 */
import { describe, it, expect } from "vitest";
import { splitWithSuggestion } from "./split-block";
import { getSuggestions, type SuggestionId } from "../suggestions";
import { createHistory } from "../history";
import { getBlock } from "../state";
import type { State } from "../state";
import { relAt, survives } from "../../test-utils/relpos-survival";
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

/** The block's paragraph-break suggestion tags (read model), or undefined. */
function breakOf(s: State, id: string) {
  return getBlock(s, id as BlockId)?.breakSuggestion;
}

/** The concatenated text of a block's text runs (embeds contribute nothing). */
function textOf(s: State, id: string): string {
  let out = "";
  for (const it of itemsOf(s, id)) {
    if (it.kind === "text") out += it.text;
  }
  return out;
}

describe("splitWithSuggestion — mid split: real split + insertion tag + insertion record", () => {
  it("makes TWO real linked blocks; the new head's ¶ carries the insertion key; one insertion record", () => {
    const allocator = createTestAllocator("p2");
    const result = splitWithSuggestion(
      oneBlock(),
      createPosition("p" as BlockId, 3),
      allocator,
      INPUT,
    );
    const s = result.state;

    // Head H (new id): "abc", its ¶ keyed. p keeps "def", untagged.
    expect(textOf(s, "p2-0")).toBe("abc");
    expect(breakOf(s, "p2-0")).toEqual({ insertionId: SID });
    expect(textOf(s, "p")).toBe("def");
    expect(breakOf(s, "p")).toBeUndefined();
    // The two blocks are linked siblings under the same parent.
    const h = getBlock(s, "p2-0" as BlockId);
    const n = getBlock(s, "p" as BlockId);
    expect(h?.nextSiblingId).toBe("p");
    expect(n?.prevSiblingId).toBe("p2-0");
    expect(h?.parentId).toBe(n?.parentId);

    // Exactly ONE insertion record, with the right id/author/createdAt.
    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    const sug = nth(suggestions, 0, "suggestion");
    expect(sug.id).toBe(SID);
    expect(sug.kind).toBe("insertion");
    expect(sug.author).toBe("alice");
    expect(sug.createdAt).toBe(1000);
    // Range-index round-trip: the boundary tag surfaces the suggestion's RANGE
    // (end of H → start of p: exactly ¶H). A wrong key would silently report
    // no range (the record would not be surfaced at all).
    expect(sug.range).toEqual({
      start: { blockId: "p2-0", offset: 3 },
      end: { blockId: "p", offset: 0 },
    });
  });
});

describe("splitWithSuggestion — offset invariant: no inline item is added", () => {
  it("both halves' inline lengths are exactly their text lengths; no embed anywhere", () => {
    const allocator = createTestAllocator("p2");
    const s = splitWithSuggestion(
      oneBlock(),
      createPosition("p" as BlockId, 3),
      allocator,
      INPUT,
    ).state;

    const nContent = getBlock(s, "p" as BlockId)?.inlineContent;
    if (nContent == null) throw new Error("expected block N inlineContent");
    // "abc" — no break item.
    expect(inlineContentLength(nContent)).toBe(3);
    const tContent = getBlock(s, "p2-0" as BlockId)?.inlineContent;
    if (tContent == null) throw new Error("expected block N+1 inlineContent");
    expect(inlineContentLength(tContent)).toBe(3);
    expect([...nContent.items, ...tContent.items].some((it) => it.kind === "embed")).toBe(false);
  });
});

describe("splitWithSuggestion — split at END (offset = length), with newBlockInit", () => {
  it("the new head keeps all text and its ¶ is keyed; the empty tail p takes newBlockInit.type", () => {
    const allocator = createTestAllocator("p2");
    const s = splitWithSuggestion(
      oneBlock(),
      createPosition("p" as BlockId, 6),
      allocator,
      INPUT,
      { type: "paragraph" },
    ).state;

    // H: "abcdef", its ¶ keyed.
    expect(textOf(s, "p2-0")).toBe("abcdef");
    expect(breakOf(s, "p2-0")).toEqual({ insertionId: SID });
    expect(breakOf(s, "p")).toBeUndefined();
    // p: empty, type set by newBlockInit (applied to the tail at k = len).
    expect(textOf(s, "p")).toBe("");
    expect(itemsOf(s, "p").length).toBe(0);
    expect(getBlock(s, "p" as BlockId)?.type).toBe("paragraph");

    // The insertion record is still written.
    expect(getSuggestions(s).length).toBe(1);
    expect(nth(getSuggestions(s), 0, "suggestion").kind).toBe("insertion");
  });
});

describe("splitWithSuggestion — split at START (offset 0)", () => {
  it("no special case: the new EMPTY head above carries the keyed ¶ (Word); p keeps the text and its id", () => {
    const allocator = createTestAllocator("p2");
    const r = splitWithSuggestion(oneBlock(), createPosition("p" as BlockId, 0), allocator, INPUT);
    const s = r.state;
    expect(itemsOf(s, "p2-0").length).toBe(0);
    expect(breakOf(s, "p2-0")).toEqual({ insertionId: SID });
    expect(getBlock(s, "p2-0" as BlockId)?.nextSiblingId).toBe("p");
    expect(textOf(s, "p")).toBe("abcdef");
    expect(breakOf(s, "p")).toBeUndefined();
    expect(getSuggestions(s).length).toBe(1);
  });
});

describe("splitWithSuggestion — ONE undo entry (split + tag + record are one transaction)", () => {
  it("a single undo reverts the WHOLE op back to one block, no tag, no record", () => {
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

    // Post-op: two blocks, key on ¶H, one record.
    expect(getBlock(s1, "p2-0" as BlockId)).not.toBeNull();
    expect(getSuggestions(s1).length).toBe(1);
    expect(breakOf(s1, "p2-0")).toEqual({ insertionId: SID });

    // ONE undo reverts everything.
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const s2 = undone.state;
    // Back to the single original block "abcdef".
    expect(textOf(s2, "p")).toBe("abcdef");
    expect(getBlock(s2, "p2-0" as BlockId)).toBeNull();
    // No tag anywhere.
    expect(breakOf(s2, "p")).toBeUndefined();
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

    // New head "wo" (its ¶ keyed); p2 keeps "rld".
    expect(textOf(s, "p3-0")).toBe("wo");
    expect(textOf(s, "p2")).toBe("rld");
    expect(breakOf(s, "p3-0")).toEqual({ insertionId: SID });
    expect(breakOf(s, "p1")).toBeUndefined();
    expect(breakOf(s, "p2")).toBeUndefined();
    // Siblings: p1 → p3-0 (new) → p2 chain; p1 untouched.
    const p1 = getBlock(s, "p1" as BlockId);
    const p2 = getBlock(s, "p2" as BlockId);
    const np = getBlock(s, "p3-0" as BlockId);
    expect(p1?.nextSiblingId).toBe("p3-0");
    expect(np?.prevSiblingId).toBe("p1");
    expect(np?.nextSiblingId).toBe("p2");
    expect(p2?.prevSiblingId).toBe("p3-0");
    expect(np?.parentId).toBe(p1?.parentId);

    // One insertion record.
    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("insertion");
    expect(nth(suggestions, 0, "suggestion").id).toBe(SID);
  });
});

describe("splitWithSuggestion — character survival: block N's left half keeps its characters", () => {
  it("N's surviving characters keep their CRDT identity after a mid-run suggested split", () => {
    const s0 = oneBlock();
    const relA = relAt(s0, "p", 0);
    const relC = relAt(s0, "p", 2);

    const allocator = createTestAllocator("p2");
    const s = splitWithSuggestion(
      s0,
      createPosition("p" as BlockId, 3),
      allocator,
      INPUT,
    ).state;

    // The split cuts N's text with one offset delete: the left half's characters
    // are the same CRDT items.
    expect(survives(relA, s, "a")).toBe(true);
    expect(survives(relC, s, "c")).toBe(true);

    // Behavioral guards still hold: H = "abc" (keyed ¶); p = "def".
    expect(textOf(s, "p2-0")).toBe("abc");
    expect(textOf(s, "p")).toBe("def");
    expect(breakOf(s, "p2-0")).toEqual({ insertionId: SID });
    // ...and the insertion record is written.
    expect(getSuggestions(s).length).toBe(1);
  });
});
