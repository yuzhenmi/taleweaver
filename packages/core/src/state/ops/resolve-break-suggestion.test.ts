/**
 * Change-tracking slice 4e-resolve-single — resolving a BREAK suggestion (a
 * suggested paragraph SPLIT or JOIN) through the shared `acceptSuggestion` /
 * `rejectSuggestion` resolution.
 *
 * A break suggestion carries its id on a zero-width break embed appended to the
 * END of the owning block N (`properties.suggestionId`), NOT on a text run.
 * Resolving one ALWAYS drops the embed and CONDITIONALLY MERGES N + N+1:
 *
 *   | seed (record.kind) | accept            | reject            |
 *   |--------------------|-------------------|-------------------|
 *   | split (insertion)  | keep split        | MERGE (undo split)|
 *   | join  (deletion)   | MERGE (do join)   | keep split        |
 *
 * The load-bearing properties exercised here: (1) all four truth-table cases land
 * the right block count + text; (2) the embed is gone in every case; (3) the
 * record is gone; (4) the chain stays intact; (5) a moved boundary clears the
 * embed but SKIPS the merge (no throw); (6) plain text-run resolution still works
 * (the embed branch is purely additive); (7) the resolve is non-undoable.
 *
 * Suggestions are seeded via the REAL create ops (`splitWithSuggestion` /
 * `markBlockJoinSuggestion`), never hand-built embeds.
 */
import { describe, it, expect } from "vitest";
import { splitWithSuggestion } from "./split-block";
import { removeBlock } from "./remove-block";
import { markBlockJoinSuggestion } from "./merge-blocks";
import { acceptSuggestion, rejectSuggestion, mintInsertion } from "./suggestion-ops";
import {
  getSuggestions,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  type SuggestionId,
} from "../suggestions";
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

/** True iff the block carries ANY break-suggestion embed. */
function hasBreakEmbed(s: State, id: string): boolean {
  return itemsOf(s, id).some(
    (it) =>
      it.kind === "embed" &&
      (it.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE ||
        it.embedType === BLOCK_JOIN_SUGGESTION_EMBED_TYPE),
  );
}

/** The count of blocks that are direct children of `doc` (the body paragraphs). */
function bodyBlockCount(s: State): number {
  let count = 0;
  let id: BlockId | null = getBlock(s, "doc" as BlockId)?.firstChildId ?? null;
  for (let guard = 0; id !== null && guard < 100; guard++) {
    count++;
    id = getBlock(s, id)?.nextSiblingId ?? null;
  }
  return count;
}

describe("resolve break — SPLIT ACCEPT (keep split)", () => {
  it("drops the embed, keeps TWO blocks, removes the record, chain intact", () => {
    const allocator = createTestAllocator("p2");
    const seeded = splitWithSuggestion(
      oneBlock(),
      createPosition("p" as BlockId, 3),
      allocator,
      SPLIT_INPUT,
    ).state;
    // Sanity: the seed produced N="abc"+embed, N+1="def", one insertion record.
    expect(hasBreakEmbed(seeded, "p")).toBe(true);
    expect(getSuggestions(seeded).length).toBe(1);
    expect(nth(getSuggestions(seeded), 0, "suggestion").kind).toBe("insertion");

    const s = acceptSuggestion(seeded, SPLIT_ID).state;

    // Embed gone from N; still TWO blocks "abc" | "def".
    expect(hasBreakEmbed(s, "p")).toBe(false);
    expect(textOf(s, "p")).toBe("abc");
    expect(textOf(s, "p2-0")).toBe("def");
    expect(bodyBlockCount(s)).toBe(2);
    // Chain intact.
    expect(getBlock(s, "p" as BlockId)?.nextSiblingId).toBe("p2-0");
    expect(getBlock(s, "p2-0" as BlockId)?.prevSiblingId).toBe("p");
    // Record gone.
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("resolve break — SPLIT REJECT (merge / undo the split)", () => {
  it("merges N+1 back into N → ONE block 'abcdef', embed + record gone", () => {
    const allocator = createTestAllocator("p2");
    const seeded = splitWithSuggestion(
      oneBlock(),
      createPosition("p" as BlockId, 3),
      allocator,
      SPLIT_INPUT,
    ).state;

    const s = rejectSuggestion(seeded, SPLIT_ID).state;

    // ONE block "abcdef" (N+1 merged away + removed), no embed.
    expect(textOf(s, "p")).toBe("abcdef");
    expect(hasBreakEmbed(s, "p")).toBe(false);
    expect(getBlock(s, "p2-0" as BlockId)).toBeNull();
    expect(bodyBlockCount(s)).toBe(1);
    // Chain intact: the doc's single child is N.
    expect(getBlock(s, "doc" as BlockId)?.firstChildId).toBe("p");
    expect(getBlock(s, "doc" as BlockId)?.lastChildId).toBe("p");
    expect(getBlock(s, "p" as BlockId)?.nextSiblingId).toBeNull();
    // Record gone.
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("resolve break — JOIN ACCEPT (do the join / merge)", () => {
  it("merges p2 into p1 → ONE block 'abcdef', embed + record gone", () => {
    const seeded = markBlockJoinSuggestion(twoBlocks(), "p2" as BlockId, JOIN_INPUT).state;
    // Sanity: p1 ends with a join embed; one deletion record; still two blocks.
    expect(hasBreakEmbed(seeded, "p1")).toBe(true);
    expect(getSuggestions(seeded).length).toBe(1);
    expect(nth(getSuggestions(seeded), 0, "suggestion").kind).toBe("deletion");
    expect(bodyBlockCount(seeded)).toBe(2);

    const s = acceptSuggestion(seeded, JOIN_ID).state;

    // ONE block "abcdef" (p2 merged away + removed), no embed.
    expect(textOf(s, "p1")).toBe("abcdef");
    expect(hasBreakEmbed(s, "p1")).toBe(false);
    expect(getBlock(s, "p2" as BlockId)).toBeNull();
    expect(bodyBlockCount(s)).toBe(1);
    expect(getBlock(s, "doc" as BlockId)?.firstChildId).toBe("p1");
    expect(getBlock(s, "doc" as BlockId)?.lastChildId).toBe("p1");
    expect(getBlock(s, "p1" as BlockId)?.nextSiblingId).toBeNull();
    // Record gone.
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("resolve break — JOIN REJECT (keep split)", () => {
  it("drops the embed, keeps TWO blocks 'abc' | 'def', removes the record", () => {
    const seeded = markBlockJoinSuggestion(twoBlocks(), "p2" as BlockId, JOIN_INPUT).state;

    const s = rejectSuggestion(seeded, JOIN_ID).state;

    // Embed gone from p1; still TWO blocks "abc" | "def".
    expect(hasBreakEmbed(s, "p1")).toBe(false);
    expect(textOf(s, "p1")).toBe("abc");
    expect(textOf(s, "p2")).toBe("def");
    expect(bodyBlockCount(s)).toBe(2);
    expect(getBlock(s, "p1" as BlockId)?.nextSiblingId).toBe("p2");
    expect(getBlock(s, "p2" as BlockId)?.prevSiblingId).toBe("p1");
    // Record gone.
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("resolve break — merge-validity guard (moved boundary)", () => {
  it("a would-merge whose boundary is no longer adjacent clears the embed but SKIPS the merge (no throw)", () => {
    // Seed a split: N="abc"+embed(SPLIT_ID), N+1="p2-0"="def".
    const alloc = createTestAllocator("p2");
    const seeded = splitWithSuggestion(
      oneBlock(),
      createPosition("p" as BlockId, 3),
      alloc,
      SPLIT_INPUT,
    ).state;
    expect(hasBreakEmbed(seeded, "p")).toBe(true);

    // INVALIDATE the boundary: remove N+1 ("p2-0") so N ("p") becomes the LAST child
    // (nextSiblingId === null). The SPLIT_ID embed still rides on "p", but there is
    // no longer an adjacent next sibling to merge into — the guard's `nextId !== null`
    // check must fail and the merge must be SKIPPED (never call
    // planMergeAdjacentBlocks on this boundary — it would throw).
    const moved = removeBlock(seeded, "p2-0" as BlockId).state;
    expect(getBlock(moved, "p" as BlockId)?.nextSiblingId).toBeNull();
    expect(getBlock(moved, "p2-0" as BlockId)).toBeNull();
    // The SPLIT_ID record is still live (removeBlock doesn't touch the suggestions map).
    expect(getSuggestions(moved).map((r) => r.id)).toContain(SPLIT_ID);
    const beforeCount = bodyBlockCount(moved);

    // Reject the split (a would-merge: insertion + reject). The embed must be CLEARED
    // but, because the boundary moved, NO merge happens — and crucially no throw.
    const s = rejectSuggestion(moved, SPLIT_ID).state;

    // Embed gone, record gone.
    expect(hasBreakEmbed(s, "p")).toBe(false);
    expect(getSuggestions(s).length).toBe(0);
    // No block was merged away — block count unchanged, "p" still present with its text.
    expect(bodyBlockCount(s)).toBe(beforeCount);
    expect(textOf(s, "p")).toBe("abc");
    expect(getBlock(s, "p" as BlockId)?.nextSiblingId).toBeNull();
  });
});

describe("resolve break — text-run resolution still works alongside (additive embed branch)", () => {
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

describe("resolve break — NON-undoable (the resolve pushes no undo step)", () => {
  it("resolving a split-reject (a merge) is invisible to the UndoManager", () => {
    // Seed the split BEFORE constructing the History so the create is not the
    // tracked entry we test; we only need a live break suggestion to resolve.
    const alloc = createTestAllocator("p2");
    const seeded = splitWithSuggestion(
      oneBlock(),
      createPosition("p" as BlockId, 3),
      alloc,
      SPLIT_INPUT,
    ).state;

    const history = createHistory(seeded);
    // No tracked edits have been committed → nothing to undo.
    expect(history.canUndo()).toBe(false);

    // Reject the split (a non-undoable SUGGESTION_RESOLVE_ORIGIN merge txn).
    const resolved = rejectSuggestion(seeded, SPLIT_ID);
    history.advanceState(resolved.state);
    // The merge landed (one block "abcdef")...
    expect(textOf(resolved.state, "p")).toBe("abcdef");
    expect(getSuggestions(resolved.state).length).toBe(0);
    // ...but it produced NO undo step.
    expect(history.canUndo()).toBe(false);

    history.destroy();
  });
});
