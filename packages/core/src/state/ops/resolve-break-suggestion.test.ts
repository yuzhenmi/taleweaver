/**
 * Change-tracking slice 4e-resolve-single — resolving a BREAK suggestion (a
 * suggested paragraph SPLIT or JOIN) through the shared `acceptSuggestion` /
 * `rejectSuggestion` resolution.
 *
 * A break suggestion is a KEY on a ¶'s own registry entry (
 * `insertionSuggestionId` on the split's new head H, `deletionSuggestionId` on the
 * join's LEFT block), NOT a text run. Resolving one ALWAYS deletes the key and
 * CONDITIONALLY deletes the keyed ¶ (the merge rule: survivor = the paragraph after it):
 *
 *   | seed (record.kind) | accept            | reject            |
 *   |--------------------|-------------------|-------------------|
 *   | split (insertion)  | keep split        | MERGE (undo split)|
 *   | join  (deletion)   | MERGE (do join)   | keep split        |
 *
 * The load-bearing properties exercised here: (1) all four truth-table cases land
 * the right block count + text; (2) the tag is gone in every case; (3) the
 * record is gone; (4) the chain stays intact; (5) plain text-run resolution still
 * works alongside; (6) the resolve is one undo step.
 *
 * Suggestions are seeded via the REAL create ops (`splitWithSuggestion` /
 * `markParagraphMarkDeletion`), never hand-built tags.
 */
import { describe, it, expect } from "vitest";
import { splitWithSuggestion } from "./split-block";
import { markParagraphMarkDeletion } from "./merge-blocks";
import { acceptSuggestion, rejectSuggestion, mintInsertion } from "./suggestion-ops";
import { getSuggestions, type SuggestionId } from "../suggestions";
import { createHistory } from "../history";
import { getBlock } from "../state";
import type { State } from "../state";
import {
  buildBlock,
  buildState,
  text,
  inlineContent,
} from "../../test-utils/state-builders";
import { createPosition } from "../block-position";
import { finalSectionOf } from "../../test-utils/state-builders";
import { createTestAllocator, type BlockId } from "../block-id";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const SPLIT_ID = "split-1" as SuggestionId;
const SPLIT_INPUT = { id: SPLIT_ID, author: "alice", createdAt: 1000 } as const;
const JOIN_ID = "join-1" as SuggestionId;
const JOIN_INPUT = { id: JOIN_ID, author: "alice", createdAt: 2000 } as const;
const INS_ID = "ins-1" as SuggestionId;
const INS_INPUT = { id: INS_ID, author: "alice", createdAt: 3000 } as const;

/** doc > [ p("abcdef") ] — one text run, used for the suggested-SPLIT cases. */
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

/** doc > [ p1("abc"), p2("def") ] — two linked blocks, used for the suggested-JOIN cases. */
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

/** True iff the block carries ANY paragraph-break suggestion tag. */
function hasBreakTag(s: State, id: string): boolean {
  return getBlock(s, id as BlockId)?.breakSuggestion !== undefined;
}

/** The count of body paragraphs (children of the final section). */
function bodyBlockCount(s: State): number {
  let count = 0;
  let id: BlockId | null = getBlock(s, finalSectionOf(s))?.firstChildId ?? null;
  for (let guard = 0; id !== null && guard < 100; guard++) {
    count++;
    id = getBlock(s, id)?.nextSiblingId ?? null;
  }
  return count;
}

describe("resolve break — SPLIT ACCEPT (keep split)", () => {
  it("deletes the tag, keeps TWO blocks, removes the record, chain intact", () => {
    const allocator = createTestAllocator("p2");
    const seeded = splitWithSuggestion(
      oneBlock(),
      createPosition("p" as BlockId, 3),
      allocator,
      SPLIT_INPUT,
    ).state;
    // Sanity: the seed produced head H="abc" (new id, keyed ¶), p="def", one insertion record.
    expect(hasBreakTag(seeded, "p2-0")).toBe(true);
    expect(getSuggestions(seeded).length).toBe(1);
    expect(nth(getSuggestions(seeded), 0, "suggestion").kind).toBe("insertion");

    const s = acceptSuggestion(seeded, SPLIT_ID).state;

    // Key gone from ¶H; still TWO blocks "abc" | "def".
    expect(hasBreakTag(s, "p2-0")).toBe(false);
    expect(textOf(s, "p2-0")).toBe("abc");
    expect(textOf(s, "p")).toBe("def");
    expect(bodyBlockCount(s)).toBe(2);
    // Chain intact.
    expect(getBlock(s, "p2-0" as BlockId)?.nextSiblingId).toBe("p");
    expect(getBlock(s, "p" as BlockId)?.prevSiblingId).toBe("p2-0");
    // Record gone.
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("resolve break — SPLIT REJECT (merge / undo the split)", () => {
  it("deletes ¶H → ONE block 'abcdef' that keeps p's id, key + record gone", () => {
    const allocator = createTestAllocator("p2");
    const seeded = splitWithSuggestion(
      oneBlock(),
      createPosition("p" as BlockId, 3),
      allocator,
      SPLIT_INPUT,
    ).state;

    const s = rejectSuggestion(seeded, SPLIT_ID).state;

    // ONE block "abcdef" (¶H deleted; the survivor is p), no key.
    expect(textOf(s, "p")).toBe("abcdef");
    expect(hasBreakTag(s, "p")).toBe(false);
    expect(getBlock(s, "p2-0" as BlockId)).toBeNull();
    expect(bodyBlockCount(s)).toBe(1);
    expect(getBlock(s, finalSectionOf(s))?.firstChildId).toBe("p");
    expect(getBlock(s, finalSectionOf(s))?.lastChildId).toBe("p");
    expect(getBlock(s, "p" as BlockId)?.nextSiblingId).toBeNull();
    // Record gone.
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("resolve break — JOIN ACCEPT (do the join / merge)", () => {
  it("deletes ¶p1 → ONE block 'abcdef' that keeps p2's id, key + record gone", () => {
    const seeded = markParagraphMarkDeletion(twoBlocks(), "p1" as BlockId, JOIN_INPUT).state;
    // Sanity: ¶p1 carries the deletion key; one deletion record; still two blocks.
    expect(hasBreakTag(seeded, "p1")).toBe(true);
    expect(getSuggestions(seeded).length).toBe(1);
    expect(nth(getSuggestions(seeded), 0, "suggestion").kind).toBe("deletion");
    expect(bodyBlockCount(seeded)).toBe(2);

    const s = acceptSuggestion(seeded, JOIN_ID).state;

    // ONE block "abcdef" (¶p1 deleted; the survivor is p2), no key.
    expect(textOf(s, "p2")).toBe("abcdef");
    expect(hasBreakTag(s, "p2")).toBe(false);
    expect(getBlock(s, "p1" as BlockId)).toBeNull();
    expect(bodyBlockCount(s)).toBe(1);
    expect(getBlock(s, finalSectionOf(s))?.firstChildId).toBe("p2");
    expect(getBlock(s, "p2" as BlockId)?.nextSiblingId).toBeNull();
    // Record gone.
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("resolve break — JOIN REJECT (keep split)", () => {
  it("deletes the tag, keeps TWO blocks 'abc' | 'def', removes the record", () => {
    const seeded = markParagraphMarkDeletion(twoBlocks(), "p1" as BlockId, JOIN_INPUT).state;

    const s = rejectSuggestion(seeded, JOIN_ID).state;

    // Key gone from ¶p1; still TWO blocks "abc" | "def".
    expect(hasBreakTag(s, "p1")).toBe(false);
    expect(textOf(s, "p1")).toBe("abc");
    expect(textOf(s, "p2")).toBe("def");
    expect(bodyBlockCount(s)).toBe(2);
    expect(getBlock(s, "p1" as BlockId)?.nextSiblingId).toBe("p2");
    expect(getBlock(s, "p2" as BlockId)?.prevSiblingId).toBe("p1");
    // Record gone.
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("resolve break — text-run resolution still works alongside", () => {
  it("a plain text-run insertion accept-strips correctly (no break interference)", () => {
    const seeded = mintInsertion(
      oneBlock(),
      createPosition("p" as BlockId, 3),
      "XY",
      {},
      INS_INPUT,
    ).state;
    expect(getSuggestions(seeded).length).toBe(1);

    // Accept the insertion → the suggested text becomes plain, permanent text.
    const accepted = acceptSuggestion(seeded, INS_ID).state;
    expect(textOf(accepted, "p")).toBe("abcXYdef");
    // The provenance id was stripped (no run still carries it).
    expect(
      itemsOf(accepted, "p").some(
        (it) => it.kind === "text" && "insertionSuggestionId" in it.attrs,
      ),
    ).toBe(false);
    expect(getSuggestions(accepted).length).toBe(0);
  });

  it("a plain text-run insertion reject-drops correctly", () => {
    const seeded = mintInsertion(
      oneBlock(),
      createPosition("p" as BlockId, 3),
      "XY",
      {},
      INS_INPUT,
    ).state;

    const rejected = rejectSuggestion(seeded, INS_ID).state;
    expect(textOf(rejected, "p")).toBe("abcdef");
    expect(getSuggestions(rejected).length).toBe(0);
  });
});

describe("resolve break — UNDOABLE (the resolve is one undo step)", () => {
  it("resolving a split-reject (a merge) is one undo step that restores the split", () => {
    const alloc = createTestAllocator("p2");
    const seeded = splitWithSuggestion(
      oneBlock(),
      createPosition("p" as BlockId, 3),
      alloc,
      SPLIT_INPUT,
    ).state;

    const history = createHistory(seeded);
    expect(history.canUndo()).toBe(false);

    history.beginEntry("command", 0);
    const resolved = rejectSuggestion(seeded, SPLIT_ID);
    history.commit(resolved, { before: null, after: null });
    expect(textOf(resolved.state, "p")).toBe("abcdef");
    expect(getSuggestions(resolved.state).length).toBe(0);
    expect(history.canUndo()).toBe(true);
    const undone = history.undo();
    expect(undone === null ? [] : getSuggestions(undone.state).map((x) => x.id)).toEqual([SPLIT_ID]);
    expect(undone === null ? "" : textOf(undone.state, "p")).toBe("def");

    history.destroy();
  });
});
