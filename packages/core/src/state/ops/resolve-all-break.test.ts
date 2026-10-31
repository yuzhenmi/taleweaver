/**
 * Change-tracking slice 4e-resolve-all — resolving BREAK suggestions (suggested
 * paragraph SPLITs / JOINs) in BULK through `acceptAll` / `rejectAll`.
 *
 * `resolveAll` resolves EVERY id each run carries, AND — for a break suggestion
 * (a TAG on the registry entry of the block AFTER the boundary) — DELETES the tag +
 * conditionally MERGES the boundary:
 *
 *   | seed (record.kind) | acceptAll          | rejectAll          |
 *   |--------------------|--------------------|--------------------|
 *   | split (insertion)  | keep split         | MERGE (undo split) |
 *   | join  (deletion)   | MERGE (do join)    | keep split         |
 *
 * THE LINCHPIN is the CASCADE: a run of CONSECUTIVE boundaries that all merge in
 * ONE transaction (each removal deletes exactly its tagged block's mark, so the
 * run collapses into the head). Test #1 exercises exactly this.
 *
 * Suggestions are seeded via the REAL create ops (`splitWithSuggestion` /
 * `markParagraphMarkDeletion`), never hand-built tags.
 */
import { describe, it, expect } from "vitest";
import { splitWithSuggestion } from "./split-block";
import { markParagraphMarkDeletion } from "./merge-blocks";
import { acceptAll, rejectAll, mintInsertion } from "./suggestion-ops";
import { getSuggestions, type SuggestionId } from "../suggestions";
import { createHistory } from "../history";
import { finalSectionOf } from "../../test-utils/state-builders";
import { getBlock } from "../state";
import type { Document } from "../state";
import {
  buildBlock,
  buildState,
  text,
  embed,
  inlineContent,
} from "../../test-utils/state-builders";
import { createPosition } from "../block-position";
import { createTestAllocator, type BlockId } from "../block-id";

const ALICE = "alice";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/** doc > [ p("ABCD") ] — one text run, the base for the consecutive-split cascade. */
function oneBlock(): Document {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("ABCD")]),
      }),
    ],
  });
}

/** doc > [ p1("abc"), p2("def") ] — two linked blocks, the base for JOIN cases. */
function twoBlocks(): Document {
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
function itemsOf(s: Document, id: string) {
  return getBlock(s, id as BlockId)?.inlineContent?.items ?? [];
}

/** The concatenated text of a block's text runs (embeds contribute nothing). */
function textOf(s: Document, id: string): string {
  let out = "";
  for (const it of itemsOf(s, id)) {
    if (it.kind === "text") out += it.text;
  }
  return out;
}

/** True iff the block carries ANY paragraph-break suggestion tag. */
function hasBreakTag(s: Document, id: string): boolean {
  return getBlock(s, id as BlockId)?.breakSuggestion !== undefined;
}

/** The body paragraph ids (children of the final section), in document order. */
function bodyBlockIds(s: Document): BlockId[] {
  const out: BlockId[] = [];
  let id: BlockId | null = getBlock(s, finalSectionOf(s))?.firstChildId ?? null;
  for (let guard = 0; id !== null && guard < 100; guard++) {
    out.push(id);
    id = getBlock(s, id)?.nextSiblingId ?? null;
  }
  return out;
}

/** True iff ANY body block carries a paragraph-break suggestion tag. */
function anyBreakTag(s: Document): boolean {
  return bodyBlockIds(s).some((id) => hasBreakTag(s, id));
}

/** The total inline-content length (text chars + embeds) of a block. */
function inlineLen(s: Document, id: string): number {
  let n = 0;
  for (const it of itemsOf(s, id)) n += it.kind === "text" ? it.text.length : 1;
  return n;
}

/**
 * Seed THREE consecutive suggested splits over "ABCD". Splitting block `p` at offset 1
 * three times (the NEW head H takes the text before the caret and its ¶ is the
 * inserted, keyed one; `p` keeps the tail and its id):
 *
 *   p2-0="A" | p2-1="B" | p2-2="C" | p="D"
 *
 * with the FIRST THREE blocks' own ¶s keyed. Returns the seeded state + the ids in order.
 */
function threeConsecutiveSplits(): { state: Document; ids: BlockId[] } {
  const alloc = createTestAllocator("p2");
  let s = oneBlock();
  s = splitWithSuggestion(s, createPosition("p" as BlockId, 1), alloc, {
    id: "split-3" as SuggestionId,
    author: ALICE,
    createdAt: 100,
  }).state;
  s = splitWithSuggestion(s, createPosition("p" as BlockId, 1), alloc, {
    id: "split-2" as SuggestionId,
    author: ALICE,
    createdAt: 200,
  }).state;
  s = splitWithSuggestion(s, createPosition("p" as BlockId, 1), alloc, {
    id: "split-1" as SuggestionId,
    author: ALICE,
    createdAt: 300,
  }).state;
  return { state: s, ids: ["p2-0", "p2-1", "p2-2", "p"] as BlockId[] };
}

describe("resolveAll break — THE CASCADE: rejectAll over 3 consecutive splits → ONE block", () => {
  it("merges the whole run back into ONE block 'ABCD' (would CRASH under pre-tx plans)", () => {
    const { state: seeded, ids } = threeConsecutiveSplits();

    // Sanity on the seed: 4 blocks, the first three ¶s keyed, three records.
    expect(bodyBlockIds(seeded)).toEqual(ids);
    expect(hasBreakTag(seeded, "p")).toBe(false);
    expect(hasBreakTag(seeded, "p2-2")).toBe(true);
    expect(hasBreakTag(seeded, "p2-1")).toBe(true);
    expect(hasBreakTag(seeded, "p2-0")).toBe(true);
    expect(getSuggestions(seeded).length).toBe(3);

    const s = rejectAll(seeded).state;

    // ONE block "ABCD" — the cascade of consecutive merges collapsed the run.
    const body = bodyBlockIds(s);
    expect(body.length).toBe(1);
    expect(body[0]).toBe("p");
    expect(textOf(s, "p")).toBe("ABCD");
    expect(inlineLen(s, "p")).toBe(4); // no inline item added
    // Chain: the section's single child is p (the survivor of every ¶ deletion), no dangling siblings.
    expect(getBlock(s, finalSectionOf(s))?.firstChildId).toBe("p");
    expect(getBlock(s, finalSectionOf(s))?.lastChildId).toBe("p");
    expect(getBlock(s, "p" as BlockId)?.nextSiblingId).toBeNull();
    // The merged-away blocks are gone; no tags; no records.
    expect(getBlock(s, "p2-0" as BlockId)).toBeNull();
    expect(getBlock(s, "p2-1" as BlockId)).toBeNull();
    expect(getBlock(s, "p2-2" as BlockId)).toBeNull();
    expect(anyBreakTag(s)).toBe(false);
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("resolveAll break — acceptAll over 3 consecutive splits → keeps all splits", () => {
  it("deletes every tag but keeps FOUR well-linked blocks A|B|C|D", () => {
    const { state: seeded } = threeConsecutiveSplits();

    const s = acceptAll(seeded).state;

    const body = bodyBlockIds(s);
    expect(body.length).toBe(4);
    expect(body.map((id) => textOf(s, id))).toEqual(["A", "B", "C", "D"]);
    // Tags all gone; records gone.
    expect(anyBreakTag(s)).toBe(false);
    expect(getSuggestions(s).length).toBe(0);
    // Chain links well-formed: each block's next/prev matches the order.
    for (let i = 0; i < body.length; i++) {
      const expectedNext = i + 1 < body.length ? body[i + 1] : null;
      const expectedPrev = i > 0 ? body[i - 1] : null;
      expect(getBlock(s, nth(body, i, "block"))?.nextSiblingId ?? null).toBe(expectedNext);
      expect(getBlock(s, nth(body, i, "block"))?.prevSiblingId ?? null).toBe(expectedPrev);
    }
    expect(getBlock(s, finalSectionOf(s))?.firstChildId).toBe(body[0]);
    expect(getBlock(s, finalSectionOf(s))?.lastChildId).toBe(body[body.length - 1]);
  });
});

describe("resolveAll break — JOIN mark", () => {
  it("acceptAll over a JOIN → deletes ¶p1: ONE block 'abcdef' with p2's id", () => {
    const seeded = markParagraphMarkDeletion(twoBlocks(), "p1" as BlockId, {
      id: "join-1" as SuggestionId,
      author: ALICE,
      createdAt: 400,
    }).state;
    expect(hasBreakTag(seeded, "p1")).toBe(true);
    expect(nth(getSuggestions(seeded), 0, "suggestion").kind).toBe("deletion");

    const s = acceptAll(seeded).state;

    expect(bodyBlockIds(s).length).toBe(1);
    expect(textOf(s, "p2")).toBe("abcdef");
    expect(getBlock(s, "p1" as BlockId)).toBeNull();
    expect(hasBreakTag(s, "p2")).toBe(false);
    expect(getBlock(s, "p2" as BlockId)?.nextSiblingId).toBeNull();
    expect(getBlock(s, finalSectionOf(s))?.lastChildId).toBe("p2");
    expect(getSuggestions(s).length).toBe(0);
  });

  it("rejectAll over a JOIN → keeps the split (TWO blocks 'abc' | 'def')", () => {
    const seeded = markParagraphMarkDeletion(twoBlocks(), "p1" as BlockId, {
      id: "join-1" as SuggestionId,
      author: ALICE,
      createdAt: 400,
    }).state;

    const s = rejectAll(seeded).state;

    expect(bodyBlockIds(s)).toEqual(["p1", "p2"]);
    expect(textOf(s, "p1")).toBe("abc");
    expect(textOf(s, "p2")).toBe("def");
    expect(hasBreakTag(s, "p1")).toBe(false);
    expect(getBlock(s, "p1" as BlockId)?.nextSiblingId).toBe("p2");
    expect(getBlock(s, "p2" as BlockId)?.prevSiblingId).toBe("p1");
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("resolveAll break — MIXED break + text-run resolution in one bulk resolve", () => {
  it("rejectAll: split merges, join keeps two blocks, text-run insertion dropped", () => {
    // doc > [ a("hello"), b("foo"), c("bar") ].
    let s = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "a", lastChildId: "c" }),
        buildBlock({
          id: "a",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "b",
          inlineContent: inlineContent([text("hello")]),
        }),
        buildBlock({
          id: "b",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "a",
          nextSiblingId: "c",
          inlineContent: inlineContent([text("foo")]),
        }),
        buildBlock({
          id: "c",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "b",
          // A NON-break embed (tab) — must SURVIVE the bulk resolve. Regression
          // guard: the bulk resolve must not over-drop.
          inlineContent: inlineContent([text("bar"), embed("tab")]),
        }),
      ],
    });

    // (1) A suggested SPLIT of "a" at offset 2 → head a2-0="he" (keyed ¶), a="llo".
    const alloc = createTestAllocator("a2");
    s = splitWithSuggestion(s, createPosition("a" as BlockId, 2), alloc, {
      id: "split-x" as SuggestionId,
      author: ALICE,
      createdAt: 10,
    }).state;
    // (2) A suggested JOIN of the b|c boundary (the break BEFORE c).
    s = markParagraphMarkDeletion(s, "b" as BlockId, {
      id: "join-x" as SuggestionId,
      author: ALICE,
      createdAt: 20,
    }).state;
    // (3) A plain text-run insertion inside "b".
    s = mintInsertion(s, createPosition("b" as BlockId, 0), "INS", {}, {
      id: "ins-x" as SuggestionId,
      author: ALICE,
      createdAt: 30,
    }).state;
    // (4) A text-run insertion on the SPLIT OWNER "a" itself (offset 0) — exercises
    // the merge head that ALSO carries a resolved text run: the insertion drops AND
    // the boundary merges, both in one transaction.
    s = mintInsertion(s, createPosition("a" as BlockId, 0), "PRE", {}, {
      id: "ins-a" as SuggestionId,
      author: ALICE,
      createdAt: 40,
    }).state;
    expect(getSuggestions(s).length).toBe(4);

    const out = rejectAll(s).state;

    // The split (insertion + reject) deletes ¶a2-0 → "a" survives holding the text; the
    // text-run insertion "PRE" (reject) is DROPPED → "a" = "hello".
    expect(textOf(out, "a")).toBe("hello");
    expect(getBlock(out, "a2-0" as BlockId)).toBeNull();
    // The join (deletion + reject) KEEPS the two blocks b | c intact.
    expect(getBlock(out, "b" as BlockId)?.nextSiblingId).toBe("c");
    expect(getBlock(out, "c" as BlockId)?.prevSiblingId).toBe("b");
    // The text-run insertion (reject) is DROPPED → "b" back to "foo".
    expect(textOf(out, "b")).toBe("foo");
    expect(textOf(out, "c")).toBe("bar");
    // The NON-break (tab) embed on "c" SURVIVES.
    expect(
      itemsOf(out, "c").some((it) => it.kind === "embed" && it.embedType === "tab"),
    ).toBe(true);
    // No break tags, no records anywhere.
    expect(anyBreakTag(out)).toBe(false);
    expect(getSuggestions(out).length).toBe(0);
    // Final body: a | b | c.
    expect(bodyBlockIds(out)).toEqual(["a", "b", "c"]);
  });
});

describe("resolveAll break — TQ-1: split at offset 0 + middle-of-doc pair", () => {
  it("(a) split at offset 0 → the new EMPTY head above carries the keyed ¶ (Word); rejectAll → ONE block 'abcdef' with p's id", () => {
    const base = buildState({
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
    const alloc = createTestAllocator("z");
    const seeded = splitWithSuggestion(base, createPosition("p" as BlockId, 0), alloc, {
      id: "s0" as SuggestionId,
      author: ALICE,
      createdAt: 1,
    }).state;
    // Enter at 0 (no special case): the new head "z-0" is the empty paragraph
    // above and its ¶ carries the key; "p" keeps the text and its id.
    expect(textOf(seeded, "z-0")).toBe("");
    expect(getBlock(seeded, "z-0" as BlockId)?.breakSuggestion).toEqual({ insertionId: "s0" });
    expect(textOf(seeded, "p")).toBe("abcdef");

    const s = rejectAll(seeded).state;
    // ¶z-0 deleted: p is restored with its id.
    expect(bodyBlockIds(s)).toEqual(["p"]);
    expect(textOf(s, "p")).toBe("abcdef");
    expect(anyBreakTag(s)).toBe(false);
    expect(getSuggestions(s).length).toBe(0);
  });

  it("(b) a split/join pair in the MIDDLE of a 4-block doc resolves only that pair", () => {
    // doc > [ top("X"), m1("mm"), m2("nn"), bot("Y") ]. The split is on m1; the
    // join marks the m1|m2 boundary's successor — actually the OUTER blocks
    // (top, bot) must stay untouched while the inner pair resolves.
    let s = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "top", lastChildId: "bot" }),
        buildBlock({
          id: "top",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "m1",
          inlineContent: inlineContent([text("X")]),
        }),
        buildBlock({
          id: "m1",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "top",
          nextSiblingId: "m2",
          inlineContent: inlineContent([text("mm")]),
        }),
        buildBlock({
          id: "m2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "m1",
          nextSiblingId: "bot",
          inlineContent: inlineContent([text("nn")]),
        }),
        buildBlock({
          id: "bot",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "m2",
          inlineContent: inlineContent([text("Y")]),
        }),
      ],
    });
    // Key ¶m1 (the m1|m2 boundary). acceptAll → ¶m1 deleted: m2 survives holding "mmnn".
    s = markParagraphMarkDeletion(s, "m1" as BlockId, {
      id: "jm" as SuggestionId,
      author: ALICE,
      createdAt: 5,
    }).state;

    const out = acceptAll(s).state;

    // The inner pair merged: m2 = "mmnn", m1 gone. The OUTER blocks untouched.
    expect(textOf(out, "m2")).toBe("mmnn");
    expect(getBlock(out, "m1" as BlockId)).toBeNull();
    expect(textOf(out, "top")).toBe("X");
    expect(textOf(out, "bot")).toBe("Y");
    expect(bodyBlockIds(out)).toEqual(["top", "m2", "bot"]);
    // Chain still well-linked across the merge seam.
    expect(getBlock(out, "top" as BlockId)?.nextSiblingId).toBe("m2");
    expect(getBlock(out, "m2" as BlockId)?.nextSiblingId).toBe("bot");
    expect(getBlock(out, "bot" as BlockId)?.prevSiblingId).toBe("m2");
    expect(anyBreakTag(out)).toBe(false);
    expect(getSuggestions(out).length).toBe(0);
  });
});

describe("resolveAll break — UNDOABLE + identity no-op", () => {
  it("a break-cascade rejectAll is ONE undo step that restores the splits and their records", () => {
    const { state: seeded } = threeConsecutiveSplits();
    const before = getSuggestions(seeded).length;

    const history = createHistory(seeded);
    expect(history.canUndo()).toBe(false);

    history.beginEntry("command", 0);
    const resolved = rejectAll(seeded);
    history.commit(resolved, { before: null, after: null });
    // The cascade landed (one block "ABCD")...
    expect(textOf(resolved.state, "p")).toBe("ABCD");
    expect(getSuggestions(resolved.state).length).toBe(0);
    // ...as ONE undo step, which restores every split suggestion.
    expect(history.canUndo()).toBe(true);
    const undone = history.undo();
    expect(undone === null ? -1 : getSuggestions(undone.state).length).toBe(before);
    expect(history.canUndo()).toBe(false);

    history.destroy();
  });

  it("acceptAll / rejectAll on a doc with no suggestions returns the input state (identity)", () => {
    const s0 = oneBlock();
    expect(acceptAll(s0).state).toBe(s0);
    expect(rejectAll(s0).state).toBe(s0);
  });
});
