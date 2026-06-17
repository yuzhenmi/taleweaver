/**
 * Change-tracking slice 4e-editor-composite — `splitWithSuggestionOverSelection`,
 * the "Enter over a NON-COLLAPSED selection in Suggesting mode" composite op.
 *
 * It SOFT-DELETES the selection (the text STAYS, struck with `deletionSuggestionId`)
 * AND inserts a suggested paragraph SPLIT at the END of the selection (a real block
 * split + a zero-width `block-split-suggestion` embed appended to the END of block N),
 * in ONE tracked transaction — the SPLIT_NODE analog of `replaceWithSuggestion`. The
 * strike, the split, the embed, and BOTH records (a deletion + an insertion) land as
 * ONE undo entry.
 *
 * The load-bearing properties exercised here: (1) the struck selection text STAYS in
 * block N carrying `deletionSuggestionId`, the split lands AFTER it (the embed is the
 * last item of N), and the unstruck tail ends up in block N+1; (2) the two records
 * (deletion + insertion) share `createdAt` (the render-layer "replace" grouping
 * signal); (3) it is atomic (one undo reverts everything); (4) the post-strike split
 * offset is robust to the strike REMOVING the author's OWN pending insertions (which
 * SHORTENS the block — a naive `end.offset` would split at the wrong place); (5) a
 * normalized-collapsed span falls back to a pure suggested split (no deletion record).
 */
import { describe, it, expect } from "vitest";
import { splitWithSuggestionOverSelection } from "./suggestion-ops";
import {
  getSuggestions,
  writeSuggestionRecordInTx,
  DELETION_SUGGESTION_ATTR,
  INSERTION_SUGGESTION_ATTR,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  type SuggestionId,
  type SuggestionRecord,
} from "../suggestions";
import { createHistory } from "../history";
import { applyOperation, getBlock } from "../state";
import type { State } from "../state";
import { createPosition, createSpan } from "../block-position";
import type { Span } from "../block-position";
import { createTestAllocator, type BlockId } from "../block-id";
import {
  buildBlock,
  buildState,
  text,
  inlineContent,
} from "../../test-utils/state-builders";
import type { InlineContent } from "../inline-content";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const DEL_ID = "del1" as SuggestionId;
const INS_ID = "ins1" as SuggestionId;
const CREATED_AT = 9000;
const INPUT = {
  deletionId: DEL_ID,
  insertionId: INS_ID,
  author: "alice",
  createdAt: CREATED_AT,
} as const;

/** doc > [ p(items) ] — one leaf paragraph "p". */
function oneBlock(items: InlineContent = inlineContent([text("abcdef")])): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: items }),
    ],
  });
}

/** A span over [start, end) in block p. */
function span(start: number, end: number): Span {
  return createSpan(createPosition("p" as BlockId, start), createPosition("p" as BlockId, end));
}

/** The inline items of a block by id. */
function itemsOf(s: State, id: string) {
  return getBlock(s, id as BlockId)?.inlineContent?.items ?? [];
}

/** Concatenated text of a block's text runs (embeds contribute nothing). */
function textOf(s: State, id: string): string {
  let out = "";
  for (const it of itemsOf(s, id)) {
    if (it.kind === "text") out += it.text;
  }
  return out;
}

/** True iff `id`'s inlineContent ends with a `block-split-suggestion` embed. */
function endsWithSplitEmbed(s: State, id: string): boolean {
  const items = itemsOf(s, id);
  const last = items[items.length - 1];
  return (
    last !== undefined &&
    last.kind === "embed" &&
    last.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE
  );
}

/** Seed an insertion `SuggestionRecord` (id `insId`, by `author`). */
function seedInsertionRecord(state: State, insId: string, author: string): State {
  const record: SuggestionRecord = {
    id: insId as SuggestionId,
    kind: "insertion",
    author,
    createdAt: 100,
  };
  return applyOperation(state, (doc) => {
    writeSuggestionRecordInTx(doc, record);
    return new Set<BlockId>([state.rootId]);
  }).state;
}

describe("splitWithSuggestionOverSelection — single-block soft-delete + suggested split", () => {
  it("strikes the selection (stays) and splits after it: N='abcd'(cd struck)+embed, N+1='ef'; deletion+insertion share createdAt", () => {
    // "abcdef", select "cd" (offsets 2..4), Enter.
    const allocator = createTestAllocator("p2");
    const s = splitWithSuggestionOverSelection(oneBlock(), span(2, 4), allocator, INPUT).state;

    // Block N: "ab" + struck "cd" + the break embed (text stays).
    expect(textOf(s, "p")).toBe("abcd");
    expect(endsWithSplitEmbed(s, "p")).toBe(true);
    const cd = itemsOf(s, "p").find((it) => it.kind === "text" && it.text === "cd");
    if (cd?.kind !== "text") throw new Error("expected the struck cd run");
    expect(cd.attrs[DELETION_SUGGESTION_ATTR]).toBe(DEL_ID);

    // Block N+1: the unstruck tail "ef", no break embed.
    const newId = getBlock(s, "p" as BlockId)?.nextSiblingId ?? null;
    expect(newId).not.toBeNull();
    if (newId === null) throw new Error("expected a new sibling block");
    expect(textOf(s, newId)).toBe("ef");
    expect(itemsOf(s, newId).some((it) => it.kind === "embed")).toBe(false);

    // Siblings linked under the same parent.
    const np1 = getBlock(s, newId as BlockId);
    expect(np1?.prevSiblingId).toBe("p");
    expect(np1?.parentId).toBe("doc");

    // Exactly TWO records — a deletion + an insertion, same author, SAME createdAt.
    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(2);
    const del = suggestions.find((x) => x.kind === "deletion");
    const ins = suggestions.find((x) => x.kind === "insertion");
    expect(del?.id).toBe(DEL_ID);
    expect(ins?.id).toBe(INS_ID);
    expect(del?.createdAt).toBe(CREATED_AT);
    expect(ins?.createdAt).toBe(CREATED_AT);
  });

  it("select to END 'ab[cdef]': N keeps all text (cd..f struck) + embed, N+1 empty", () => {
    const allocator = createTestAllocator("p2");
    const s = splitWithSuggestionOverSelection(oneBlock(), span(2, 6), allocator, INPUT).state;

    expect(textOf(s, "p")).toBe("abcdef");
    expect(endsWithSplitEmbed(s, "p")).toBe(true);
    const cdef = itemsOf(s, "p").find((it) => it.kind === "text" && it.text === "cdef");
    if (cdef?.kind !== "text") throw new Error("expected the struck cdef run");
    expect(cdef.attrs[DELETION_SUGGESTION_ATTR]).toBe(DEL_ID);

    const newId = getBlock(s, "p" as BlockId)?.nextSiblingId ?? null;
    if (newId === null) throw new Error("expected a new sibling block");
    expect(textOf(s, newId)).toBe("");
    expect(itemsOf(s, newId).length).toBe(0);
  });

  it("select from START '[abcd]ef': N = 'abcd'(struck) + embed, N+1 = 'ef'", () => {
    const allocator = createTestAllocator("p2");
    const s = splitWithSuggestionOverSelection(oneBlock(), span(0, 4), allocator, INPUT).state;

    expect(textOf(s, "p")).toBe("abcd");
    expect(endsWithSplitEmbed(s, "p")).toBe(true);
    const abcd = itemsOf(s, "p").find((it) => it.kind === "text" && it.text === "abcd");
    if (abcd?.kind !== "text") throw new Error("expected the struck abcd run");
    expect(abcd.attrs[DELETION_SUGGESTION_ATTR]).toBe(DEL_ID);

    const newId = getBlock(s, "p" as BlockId)?.nextSiblingId ?? null;
    if (newId === null) throw new Error("expected a new sibling block");
    expect(textOf(s, newId)).toBe("ef");
  });
});

describe("splitWithSuggestionOverSelection — atomicity (ONE undo unit)", () => {
  it("a single undo reverts the strike + the split + both records back to one block", () => {
    const s0 = oneBlock();
    const history = createHistory(s0);

    history.beginEntry("command", 0);
    const allocator = createTestAllocator("p2");
    const result = splitWithSuggestionOverSelection(s0, span(2, 4), allocator, INPUT);
    history.commit(result, { before: null, after: null });
    const s1 = result.state;

    // Post-op: two blocks, embed on N, struck "cd", two records.
    const newId = getBlock(s1, "p" as BlockId)?.nextSiblingId ?? null;
    expect(newId).not.toBeNull();
    expect(getSuggestions(s1).length).toBe(2);
    expect(endsWithSplitEmbed(s1, "p")).toBe(true);

    // ONE undo reverts everything.
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const s2 = undone.state;
    expect(textOf(s2, "p")).toBe("abcdef");
    expect(getBlock(s2, "p" as BlockId)?.nextSiblingId).toBeNull();
    expect(endsWithSplitEmbed(s2, "p")).toBe(false);
    expect(getSuggestions(s2).length).toBe(0);
    // No second undo step (the composite was ONE entry).
    expect(history.canUndo()).toBe(false);

    history.destroy();
  });
});

describe("splitWithSuggestionOverSelection — own-insertion-in-range (post-strike offset proof)", () => {
  it("the strike REMOVES the author's own pending insertion (shortening N); the split still lands after the unstruck tail", () => {
    // "ab" + own-insertion "XY" by alice (preIns) + "cdef".
    // Select offsets [2, 6): that covers the own-insertion "XY" (offsets 2..4) +
    // "cd" (offsets 4..6). markDeletion REMOVES "XY" (own insertion) and tags "cd".
    // Post-strike content = "ab" + "cd"(struck) + "ef" — block SHORTENED by 2.
    // The selection END is offset 6 (pre-strike). The unstruck tail after the
    // selection is "ef" (offsets 6..8, length 2). The split must land so that "ef"
    // ends up in N+1 intact — at POST-strike offset (6-2)=4, NOT the naive 6.
    let s = oneBlock(
      inlineContent([
        text("ab"),
        text("XY", { [INSERTION_SUGGESTION_ATTR]: "preIns" }),
        text("cdef"),
      ]),
    );
    s = seedInsertionRecord(s, "preIns", "alice");

    const allocator = createTestAllocator("p2");
    s = splitWithSuggestionOverSelection(s, span(2, 6), allocator, INPUT).state;

    // N: "ab" + struck "cd" + embed — the own-insertion "XY" was REMOVED for real.
    expect(textOf(s, "p")).toBe("abcd");
    expect(endsWithSplitEmbed(s, "p")).toBe(true);
    const cd = itemsOf(s, "p").find((it) => it.kind === "text" && it.text === "cd");
    if (cd?.kind !== "text") throw new Error("expected the struck cd run");
    expect(cd.attrs[DELETION_SUGGESTION_ATTR]).toBe(DEL_ID);

    // N+1: the unstruck tail "ef" — intact, NOT split mid-tail (the post-strike
    // offset proof: a naive end.offset=6 would split at the wrong place).
    const newId = getBlock(s, "p" as BlockId)?.nextSiblingId ?? null;
    if (newId === null) throw new Error("expected a new sibling block");
    expect(textOf(s, newId)).toBe("ef");
  });

  it("the ENTIRE selection is own pending insertions: NOTHING is tagged, so NO deletion record (only the insertion record); the split still lands after the unstruck tail", () => {
    // "ab" + own-insertion "XY" by alice (preIns) + "ef".
    // Select offsets [2, 4): the WHOLE selection is the own-insertion "XY".
    // markDeletion REMOVES "XY" for real → taggedAny=false → NO deletion record.
    // Post-strike content = "ab" + "ef"; tailLen = 6-4 = 2, postLen = 4, so
    // splitOffset = 4-2 = 2 → N = "ab" + embed, N+1 = "ef".
    let s = oneBlock(
      inlineContent([
        text("ab"),
        text("XY", { [INSERTION_SUGGESTION_ATTR]: "preIns" }),
        text("ef"),
      ]),
    );
    s = seedInsertionRecord(s, "preIns", "alice");

    const allocator = createTestAllocator("p2");
    s = splitWithSuggestionOverSelection(s, span(2, 4), allocator, INPUT).state;

    // N: "ab" + embed (own insertion removed for real, nothing struck remains).
    expect(textOf(s, "p")).toBe("ab");
    expect(endsWithSplitEmbed(s, "p")).toBe(true);

    // N+1: the unstruck tail "ef".
    const newId = getBlock(s, "p" as BlockId)?.nextSiblingId ?? null;
    if (newId === null) throw new Error("expected a new sibling block");
    expect(textOf(s, newId)).toBe("ef");

    // The load-bearing fact (the `taggedAny && !reusing` gate): NO `del1` deletion
    // record was written — nothing was struck, the run was removed for real. The
    // split's own insertion record (`ins1`) IS present.
    const suggestions = getSuggestions(s);
    expect(suggestions.some((x) => x.kind === "deletion" && x.id === DEL_ID)).toBe(false);
    const ins = suggestions.find((x) => x.id === INS_ID);
    expect(ins?.kind).toBe("insertion");
  });
});

describe("splitWithSuggestionOverSelection — collapsed-after-normalization fallback", () => {
  it("a collapsed span behaves as a pure suggested split (insertion record only, no deletion)", () => {
    const allocator = createTestAllocator("p2");
    const s = splitWithSuggestionOverSelection(oneBlock(), span(3, 3), allocator, INPUT).state;

    // Split at offset 3: N = "abc" + embed, N+1 = "def". No strike.
    expect(textOf(s, "p")).toBe("abc");
    expect(endsWithSplitEmbed(s, "p")).toBe(true);
    const newId = getBlock(s, "p" as BlockId)?.nextSiblingId ?? null;
    if (newId === null) throw new Error("expected a new sibling block");
    expect(textOf(s, newId)).toBe("def");

    // Exactly ONE record: the insertion. No deletion.
    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("insertion");
    expect(nth(suggestions, 0, "suggestion").id).toBe(INS_ID);
  });
});
