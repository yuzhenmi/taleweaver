/**
 * Change-tracking slice 3 — `markFormatting`, the first suggestion-creation op.
 *
 * `markFormatting` is a formatting SUGGESTION: instead of changing a run's live
 * format attrs, it stamps a `formattingSuggestionId` over the span and writes a
 * `formatting` `SuggestionRecord` carrying the `proposedAttrs` the action WOULD
 * have applied — both in ONE tracked transaction (one undo unit).
 *
 * The load-bearing properties exercised here: (1) the op is a NORMAL tracked
 * `applyOperation` content op, so `getSuggestions` reflects the marked range +
 * record; (2) the proposal is UNDOABLE AS A UNIT (attr + record revert together)
 * because the attr lands on a block-tree map and the `suggestions` map is in the
 * UndoManager's tracked scopes; (3) the run's LIVE format attrs are untouched
 * (the proposal is not applied until accept — a later slice); (4) adjacent
 * same-author/same-proposal marks COALESCE into one suggestion (id reuse); (5)
 * identity no-ops short-circuit (return the same State reference).
 */
import { describe, it, expect } from "vitest";
import {
  markFormatting,
  markDeletion,
  mintInsertion,
  acceptSuggestion,
  rejectSuggestion,
  acceptAll,
  rejectAll,
} from "./suggestion-ops";
import {
  getSuggestions,
  writeSuggestionRecordInTx,
  FORMATTING_SUGGESTION_ATTR,
  DELETION_SUGGESTION_ATTR,
  INSERTION_SUGGESTION_ATTR,
  type SuggestionId,
  type SuggestionRecord,
} from "../suggestions";
import { createHistory } from "../history";
import { insertText } from "./insert-text";
import { applyOperation, createState, getBlock, resolveBlock } from "../state";
import { getYBlock } from "../yjs-doc";
import { STATE_INTERNAL } from "../state-internal";
import * as Y from "yjs";
import { createPosition, createSpan } from "../block-position";
import type { Span } from "../block-position";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import {
  buildBlock,
  buildState,
  text,
  embed,
  inlineContent,
} from "../../test-utils/state-builders";
import type { State } from "../state";
import type { InlineContent } from "../inline-content";

const SID = "s1" as SuggestionId;

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/** doc > [ p("abcdef") ] (one text run unless overridden). */
function oneBlock(
  items = inlineContent([text("abcdef")]),
): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: items,
      }),
    ],
  });
}

/** A span over [start, end) in block p. */
function span(start: number, end: number): Span {
  return createSpan(
    createPosition("p" as BlockId, start),
    createPosition("p" as BlockId, end),
  );
}

/** The inline items of p. */
function pItems(s: State) {
  return getBlock(s, "p" as BlockId)?.inlineContent?.items ?? [];
}

/** The first text item of p whose attrs carry the formatting-suggestion attr. */
function markedRunAttr(s: State): unknown {
  for (const it of pItems(s)) {
    if (it.kind === "text" && it.attrs[FORMATTING_SUGGESTION_ATTR] !== undefined) {
      return it.attrs[FORMATTING_SUGGESTION_ATTR];
    }
  }
  return undefined;
}

const INPUT = { id: SID, author: "alice", createdAt: 1000 } as const;

describe("markFormatting — stamp suggestion attr + write record in ONE tracked op", () => {
  it("appears in getSuggestions with kind/author/createdAt/proposedAttrs + a live range", () => {
    const s = markFormatting(oneBlock(), span(1, 4), { bold: true }, INPUT).state;

    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    const sug = nth(suggestions, 0, "suggestion");
    expect(sug.id).toBe(SID);
    expect(sug.kind).toBe("formatting");
    expect(sug.author).toBe("alice");
    expect(sug.createdAt).toBe(1000);
    expect(sug.proposedAttrs).toEqual({ bold: true });
    expect(sug.orphaned).toBe(false);
    expect(sug.range).not.toBeNull();
    expect(sug.range?.start).toEqual(createPosition("p" as BlockId, 1));
    expect(sug.range?.end).toEqual(createPosition("p" as BlockId, 4));

    // The marked run carries the id as its formatting-suggestion attr.
    expect(markedRunAttr(s)).toBe(SID);
  });

  it("the run's live format attrs are NOT changed (proposal is not applied)", () => {
    // The run starts bold; we PROPOSE italic. Live attrs must keep bold and must
    // NOT gain italic — only the formattingSuggestionId attr is added.
    const s = markFormatting(
      oneBlock(inlineContent([text("abcdef", { bold: true })])),
      span(1, 4),
      { italic: true },
      INPUT,
    ).state;

    const marked = pItems(s).find(
      (it) => it.kind === "text" && it.attrs[FORMATTING_SUGGESTION_ATTR] !== undefined,
    );
    if (marked === undefined || marked.kind !== "text") {
      throw new Error("expected a marked text run");
    }
    expect(marked.attrs.bold).toBe(true);
    expect("italic" in marked.attrs).toBe(false);
    expect(marked.attrs[FORMATTING_SUGGESTION_ATTR]).toBe(SID);
  });

  it("does NOT stamp the suggestion id onto a zero-width marker embed in range (#465 dangling-ref)", () => {
    // [text("ab"), comment-start marker, text("cd")] — mark formatting over the
    // whole span. The text runs carry the suggestion id; the marker must NOT —
    // else, after the record is deleted on resolve, the marker keeps a dangling
    // formattingSuggestionId forever.
    const s = markFormatting(
      oneBlock(inlineContent([text("ab"), embed("comment-start", { commentId: "c1" }), text("cd")])),
      span(0, 5),
      { bold: true },
      INPUT,
    ).state;
    const marker = pItems(s).find((it) => it.kind === "embed" && it.embedType === "comment-start");
    if (marker === undefined || marker.kind !== "embed") throw new Error("expected the marker");
    expect(FORMATTING_SUGGESTION_ATTR in marker.attrs).toBe(false);
    // The surrounding text still carries the proposal id (sanity: the op ran).
    expect(markedRunAttr(s)).toBe(SID);
  });
});

describe("markFormatting — undo atomicity (attr + record revert together)", () => {
  it("undo removes BOTH the content attr AND the record; redo restores both", () => {
    const s0 = oneBlock();
    const history = createHistory(s0);

    history.beginEntry("command", 0);
    const marked = markFormatting(s0, span(1, 4), { bold: true }, INPUT);
    history.commit(marked, { before: null, after: null });
    const s1 = marked.state;
    expect(getSuggestions(s1).length).toBe(1);
    expect(markedRunAttr(s1)).toBe(SID);

    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const s2 = undone.state;
    expect(getSuggestions(s2).length).toBe(0);
    expect(markedRunAttr(s2)).toBeUndefined();

    const redone = history.redo();
    if (redone === null) throw new Error("expected redo to return a result");
    const s3 = redone.state;
    expect(getSuggestions(s3).length).toBe(1);
    expect(markedRunAttr(s3)).toBe(SID);

    history.destroy();
  });
});

describe("markFormatting — coalesce with an adjacent same-author/same-proposal mark", () => {
  it("marking adjacent ranges with same author + same proposal reuses the id (ONE record, widened range)", () => {
    // p("abcdef"): mark "abc" (0..3), then the immediately-adjacent "def" (3..6).
    let s = markFormatting(oneBlock(), span(0, 3), { bold: true }, {
      id: "first" as SuggestionId,
      author: "alice",
      createdAt: 1000,
    }).state;
    s = markFormatting(s, span(3, 6), { bold: true }, {
      id: "second" as SuggestionId,
      author: "alice",
      createdAt: 2000,
    }).state;

    const suggestions = getSuggestions(s);
    // Coalesced into ONE record (the second reused the first's id).
    expect(suggestions.length).toBe(1);
    const sug = nth(suggestions, 0, "suggestion");
    expect(sug.id).toBe("first");
    // Range now spans both marks.
    expect(sug.range?.start).toEqual(createPosition("p" as BlockId, 0));
    expect(sug.range?.end).toEqual(createPosition("p" as BlockId, 6));
  });

  it("does NOT coalesce across a DIFFERENT author (two records)", () => {
    let s = markFormatting(oneBlock(), span(0, 3), { bold: true }, {
      id: "first" as SuggestionId,
      author: "alice",
      createdAt: 1000,
    }).state;
    s = markFormatting(s, span(3, 6), { bold: true }, {
      id: "second" as SuggestionId,
      author: "bob",
      createdAt: 2000,
    }).state;

    expect(getSuggestions(s).length).toBe(2);
  });

  it("does NOT coalesce across a DIFFERENT proposal (two records)", () => {
    let s = markFormatting(oneBlock(), span(0, 3), { bold: true }, {
      id: "first" as SuggestionId,
      author: "alice",
      createdAt: 1000,
    }).state;
    s = markFormatting(s, span(3, 6), { italic: true }, {
      id: "second" as SuggestionId,
      author: "alice",
      createdAt: 2000,
    }).state;

    expect(getSuggestions(s).length).toBe(2);
  });

  it("coalesces via the AFTER neighbor (mark the later range first, then the earlier)", () => {
    // Exercises `neighborSuggestionAfter` as the coalesce trigger: mark "def"
    // (3..6) first, then the immediately-preceding "abc" (0..3) — whose
    // after-neighbor carries the first id. (The before-path tests above never
    // reach this branch, since the before-neighbor always fires first there.)
    let s = markFormatting(oneBlock(), span(3, 6), { bold: true }, {
      id: "first" as SuggestionId,
      author: "alice",
      createdAt: 1000,
    }).state;
    s = markFormatting(s, span(0, 3), { bold: true }, {
      id: "second" as SuggestionId,
      author: "alice",
      createdAt: 2000,
    }).state;

    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    expect(nth(suggestions, 0, "suggestion").id).toBe("first");
    expect(nth(suggestions, 0, "suggestion").range?.start).toEqual(createPosition("p" as BlockId, 0));
    expect(nth(suggestions, 0, "suggestion").range?.end).toEqual(createPosition("p" as BlockId, 6));
  });

  it("prefers the BEFORE neighbor when BOTH neighbors are coalescing candidates", () => {
    // Mark "ab" (0..2) = before-id and "ef" (4..6) = after-id independently,
    // then mark the bridging "cd" (2..4): its before-neighbor carries before-id,
    // its after-neighbor carries after-id, both same-author/same-proposal. The
    // before id must win (resolveCoalesce iterates [before, after]). after-id
    // survives as its own (non-transitive) suggestion.
    let s = markFormatting(oneBlock(), span(0, 2), { bold: true }, {
      id: "before-id" as SuggestionId,
      author: "alice",
      createdAt: 1000,
    }).state;
    s = markFormatting(s, span(4, 6), { bold: true }, {
      id: "after-id" as SuggestionId,
      author: "alice",
      createdAt: 1001,
    }).state;
    s = markFormatting(s, span(2, 4), { bold: true }, {
      id: "bridge-id" as SuggestionId,
      author: "alice",
      createdAt: 1002,
    }).state;

    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(2);
    const ids = suggestions.map((sg) => sg.id).sort();
    expect(ids).toEqual(["after-id", "before-id"]);
    const beforeSug = suggestions.find((sg) => sg.id === "before-id");
    expect(beforeSug?.range?.start).toEqual(createPosition("p" as BlockId, 0));
    expect(beforeSug?.range?.end).toEqual(createPosition("p" as BlockId, 4));
  });
});

describe("markFormatting — identity no-ops", () => {
  it("empty proposedAttrs returns the SAME state reference + empty dirtyIds", () => {
    const s = oneBlock();
    const r = markFormatting(s, span(1, 4), {} as ReadonlyAttrs, INPUT);
    expect(r.state).toBe(s);
    expect(r.dirtyIds.size).toBe(0);
  });

  it("a collapsed span returns the SAME state reference + empty dirtyIds", () => {
    const s = oneBlock();
    const r = markFormatting(s, span(2, 2), { bold: true }, INPUT);
    expect(r.state).toBe(s);
    expect(r.dirtyIds.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// markDeletion (slice 3b) — soft-delete: tag text as suggested-deleted, but
// REMOVE-for-real the deleter's OWN pending insertions.
// ─────────────────────────────────────────────────────────────────────────

const DEL_SID = "del1" as SuggestionId;
const DEL_INPUT = { id: DEL_SID, author: "alice", createdAt: 5000 } as const;

/**
 * Seed an insertion `SuggestionRecord` (id `insId`, by `author`) into the
 * suggestions map of `state`. The run carrying the matching
 * `insertionSuggestionId` attr is built into the fixture separately (via the
 * `text(str, { insertionSuggestionId })` builder). Returns the new State (the
 * record write is a tracked op surfacing rootId — but we only need the resulting
 * state; History is not involved).
 */
function seedInsertionRecord(
  state: State,
  insId: string,
  author: string,
): State {
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

/** The first text item of p whose attrs carry the deletion-suggestion attr. */
function deletedRunAttr(s: State): unknown {
  for (const it of pItems(s)) {
    if (it.kind === "text" && it.attrs[DELETION_SUGGESTION_ATTR] !== undefined) {
      return it.attrs[DELETION_SUGGESTION_ATTR];
    }
  }
  return undefined;
}

/** Concatenated text of all text items of p, in order. */
function pText(s: State): string {
  return pItems(s)
    .filter((it): it is Extract<typeof it, { kind: "text" }> => it.kind === "text")
    .map((it) => it.text)
    .join("");
}

describe("markDeletion — soft-delete plain text (tag, do NOT remove)", () => {
  it("tags the run with deletionSuggestionId, keeps the text, writes a deletion record with a live range", () => {
    const s = markDeletion(oneBlock(), span(1, 4), DEL_INPUT).state;

    // The text is STILL present (soft-delete).
    expect(pText(s)).toBe("abcdef");
    // The in-range run carries the deletion id.
    expect(deletedRunAttr(s)).toBe(DEL_SID);

    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    const sug = nth(suggestions, 0, "suggestion");
    expect(sug.id).toBe(DEL_SID);
    expect(sug.kind).toBe("deletion");
    expect(sug.author).toBe("alice");
    expect(sug.createdAt).toBe(5000);
    expect(sug.proposedAttrs).toBeUndefined();
    expect(sug.orphaned).toBe(false);
    expect(sug.range?.start).toEqual(createPosition("p" as BlockId, 1));
    expect(sug.range?.end).toEqual(createPosition("p" as BlockId, 4));
  });
});

describe("markDeletion — undo atomicity (attr + record revert together)", () => {
  it("undo removes BOTH the deletion attr AND the record; redo restores both", () => {
    const s0 = oneBlock();
    const history = createHistory(s0);

    history.beginEntry("command", 0);
    const marked = markDeletion(s0, span(1, 4), DEL_INPUT);
    history.commit(marked, { before: null, after: null });
    const s1 = marked.state;
    expect(getSuggestions(s1).length).toBe(1);
    expect(deletedRunAttr(s1)).toBe(DEL_SID);

    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const s2 = undone.state;
    expect(getSuggestions(s2).length).toBe(0);
    expect(deletedRunAttr(s2)).toBeUndefined();
    expect(pText(s2)).toBe("abcdef");

    const redone = history.redo();
    if (redone === null) throw new Error("expected redo to return a result");
    const s3 = redone.state;
    expect(getSuggestions(s3).length).toBe(1);
    expect(deletedRunAttr(s3)).toBe(DEL_SID);

    history.destroy();
  });
});

describe("markDeletion — own pending insertion is REMOVED for real", () => {
  it("deleting your own suggested-inserted run drops the text and writes NO deletion record", () => {
    // p: "AA" + own-insertion "BB" (alice, ins1) + "CC"
    let s = oneBlock(
      inlineContent([
        text("AA"),
        text("BB", { [INSERTION_SUGGESTION_ATTR]: "ins1" }),
        text("CC"),
      ]),
    );
    s = seedInsertionRecord(s, "ins1", "alice");
    // Sanity: the insertion record is visible before the delete.
    const before = getSuggestions(s);
    expect(before.length).toBe(1);
    expect(nth(before, 0, "suggestion").id).toBe("ins1");
    expect(nth(before, 0, "suggestion").kind).toBe("insertion");
    expect(nth(before, 0, "suggestion").orphaned).toBe(false);

    // alice soft-deletes "BB" (offsets 2..4).
    s = markDeletion(s, span(2, 4), DEL_INPUT).state;

    // "BB" is GONE for real (never became real text).
    expect(pText(s)).toBe("AACC");
    // No deletion record was written.
    const after = getSuggestions(s);
    const deletions = after.filter((x) => x.kind === "deletion");
    expect(deletions.length).toBe(0);
    // The insertion record now has no tagged item → orphaned.
    const ins = after.find((x) => x.id === "ins1");
    expect(ins?.orphaned).toBe(true);
    expect(ins?.range).toBeNull();
  });

  it("removes ONLY the in-range portion of a partially-covered own-insertion (surviving halves keep the insertion id)", () => {
    // One own-insertion run "BBBB" (alice, ins1); soft-delete the MIDDLE "BB"
    // (offsets 1..3). The before "B" (0..1) and after "B" (3..4) must survive,
    // STILL carrying the insertion id — only the covered middle is removed.
    let s = oneBlock(
      inlineContent([text("BBBB", { [INSERTION_SUGGESTION_ATTR]: "ins1" })]),
    );
    s = seedInsertionRecord(s, "ins1", "alice");

    s = markDeletion(s, span(1, 3), DEL_INPUT).state;

    // Middle removed; the two surviving B's merge back into one "BB" run.
    expect(pText(s)).toBe("BB");
    const survivor = pItems(s).find((it) => it.kind === "text");
    if (survivor === undefined || survivor.kind !== "text") {
      throw new Error("expected a surviving run");
    }
    expect(survivor.attrs[INSERTION_SUGGESTION_ATTR]).toBe("ins1");
    // No deletion record (the whole deleted portion was an own-insertion); the
    // insertion record stays LIVE because its surviving halves still carry it.
    const after = getSuggestions(s);
    expect(after.filter((x) => x.kind === "deletion").length).toBe(0);
    expect(after.find((x) => x.id === "ins1")?.orphaned).toBe(false);
  });
});

describe("markDeletion — nesting over a DIFFERENT author's insertion", () => {
  it("keeps the insertion id AND gains the deletion id; both records live", () => {
    // p: "AA" + bob-insertion "BB" (ins1) + "CC"
    let s = oneBlock(
      inlineContent([
        text("AA"),
        text("BB", { [INSERTION_SUGGESTION_ATTR]: "ins1" }),
        text("CC"),
      ]),
    );
    s = seedInsertionRecord(s, "ins1", "bob");

    // alice soft-deletes "BB" (offsets 2..4) — bob's insertion, so NEST.
    s = markDeletion(s, span(2, 4), DEL_INPUT).state;

    // Text preserved (soft-delete), "BB" run carries BOTH ids.
    expect(pText(s)).toBe("AABBCC");
    const nested = pItems(s).find(
      (it) => it.kind === "text" && it.text === "BB",
    );
    if (nested === undefined || nested.kind !== "text") {
      throw new Error("expected the BB run to survive");
    }
    expect(nested.attrs[INSERTION_SUGGESTION_ATTR]).toBe("ins1");
    expect(nested.attrs[DELETION_SUGGESTION_ATTR]).toBe(DEL_SID);

    // Both the insertion and the deletion records are present + live.
    const after = getSuggestions(s);
    const ins = after.find((x) => x.id === "ins1");
    const del = after.find((x) => x.id === DEL_SID);
    expect(ins?.kind).toBe("insertion");
    expect(ins?.orphaned).toBe(false);
    expect(del?.kind).toBe("deletion");
    expect(del?.orphaned).toBe(false);
  });
});

describe("markDeletion — mixed span (own-insertion removed; everything else tagged)", () => {
  it("removes own-insertion, tags plain + other-author insertion runs", () => {
    // "AA"(plain) + "BB"(alice-insertion) + "CC"(bob-insertion) + "DD"(plain)
    let s = oneBlock(
      inlineContent([
        text("AA"),
        text("BB", { [INSERTION_SUGGESTION_ATTR]: "insAlice" }),
        text("CC", { [INSERTION_SUGGESTION_ATTR]: "insBob" }),
        text("DD"),
      ]),
    );
    s = seedInsertionRecord(s, "insAlice", "alice");
    s = seedInsertionRecord(s, "insBob", "bob");

    // alice soft-deletes the WHOLE thing (offsets 0..8).
    s = markDeletion(s, span(0, 8), DEL_INPUT).state;

    // "BB" removed; "AACCDD" remain.
    expect(pText(s)).toBe("AACCDD");

    // Every surviving run carries the deletion id.
    for (const it of pItems(s)) {
      if (it.kind === "text") {
        expect(it.attrs[DELETION_SUGGESTION_ATTR]).toBe(DEL_SID);
      }
    }
    // The "CC" run also keeps its insertion id.
    const cc = pItems(s).find((it) => it.kind === "text" && it.text === "CC");
    if (cc === undefined || cc.kind !== "text") {
      throw new Error("expected CC to survive");
    }
    expect(cc.attrs[INSERTION_SUGGESTION_ATTR]).toBe("insBob");

    // Records: insAlice orphaned (text removed), insBob live, one deletion.
    const after = getSuggestions(s);
    expect(after.find((x) => x.id === "insAlice")?.orphaned).toBe(true);
    expect(after.find((x) => x.id === "insBob")?.orphaned).toBe(false);
    const del = after.find((x) => x.id === DEL_SID);
    expect(del?.kind).toBe("deletion");
    expect(del?.orphaned).toBe(false);
    expect(del?.range?.start).toEqual(createPosition("p" as BlockId, 0));
    expect(del?.range?.end).toEqual(createPosition("p" as BlockId, 6));
  });
});

describe("markDeletion — coalesce with an adjacent same-author deletion", () => {
  it("two adjacent same-author deletions reuse the id (ONE record, widened range)", () => {
    let s = markDeletion(oneBlock(), span(0, 3), {
      id: "first" as SuggestionId,
      author: "alice",
      createdAt: 1000,
    }).state;
    s = markDeletion(s, span(3, 6), {
      id: "second" as SuggestionId,
      author: "alice",
      createdAt: 2000,
    }).state;

    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    expect(nth(suggestions, 0, "suggestion").id).toBe("first");
    expect(nth(suggestions, 0, "suggestion").range?.start).toEqual(createPosition("p" as BlockId, 0));
    expect(nth(suggestions, 0, "suggestion").range?.end).toEqual(createPosition("p" as BlockId, 6));
  });

  it("does NOT coalesce across a DIFFERENT author (two records)", () => {
    let s = markDeletion(oneBlock(), span(0, 3), {
      id: "first" as SuggestionId,
      author: "alice",
      createdAt: 1000,
    }).state;
    s = markDeletion(s, span(3, 6), {
      id: "second" as SuggestionId,
      author: "bob",
      createdAt: 2000,
    }).state;

    expect(getSuggestions(s).length).toBe(2);
  });
});

/** doc > [ p1(items1), p2(items2) ] — a two-leaf fixture for cross-block spans. */
function twoBlocks(items1: InlineContent, items2: InlineContent): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
      buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: items1 }),
      buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: items2 }),
    ],
  });
}

/** The inline items of an arbitrary block by id. */
function itemsOf(s: State, id: string) {
  return getBlock(s, id as BlockId)?.inlineContent?.items ?? [];
}

describe("markDeletion — cross-block span tags text in BOTH blocks with ONE id", () => {
  it("a deletion spanning p1→p2 tags each block's in-range text with the same id + ONE record", () => {
    const s0 = twoBlocks(inlineContent([text("hello")]), inlineContent([text("world")]));
    // Soft-delete from p1 offset 3 ("lo") through p2 offset 2 ("wo").
    const s = markDeletion(
      s0,
      createSpan(createPosition("p1" as BlockId, 3), createPosition("p2" as BlockId, 2)),
      DEL_INPUT,
    ).state;

    const p1Del = itemsOf(s, "p1").find(
      (it) => it.kind === "text" && it.attrs[DELETION_SUGGESTION_ATTR] !== undefined,
    );
    const p2Del = itemsOf(s, "p2").find(
      (it) => it.kind === "text" && it.attrs[DELETION_SUGGESTION_ATTR] !== undefined,
    );
    if (p1Del?.kind !== "text" || p2Del?.kind !== "text") {
      throw new Error("expected a tagged run in each block");
    }
    // SAME id across both blocks (one suggestion spanning the boundary).
    expect(p1Del.text).toBe("lo");
    expect(p1Del.attrs[DELETION_SUGGESTION_ATTR]).toBe(DEL_SID);
    expect(p2Del.text).toBe("wo");
    expect(p2Del.attrs[DELETION_SUGGESTION_ATTR]).toBe(DEL_SID);

    // Exactly ONE deletion record, range spanning p1→p2.
    const dels = getSuggestions(s).filter((x) => x.kind === "deletion");
    expect(dels.length).toBe(1);
    expect(nth(dels, 0, "deletion").id).toBe(DEL_SID);
    expect(nth(dels, 0, "deletion").range?.start).toEqual(createPosition("p1" as BlockId, 3));
    expect(nth(dels, 0, "deletion").range?.end).toEqual(createPosition("p2" as BlockId, 2));
  });
});

describe("markDeletion — embeds inside the span are preserved UNTAGGED (out of scope)", () => {
  it("keeps an in-range embed in place without a deletion attr; tags the surrounding text", () => {
    // "AA" + embed + "CC"; soft-delete offsets 0..4 (AA + embed + first "C").
    const s = markDeletion(
      oneBlock(inlineContent([text("AA"), embed("footnote-anchor"), text("CC")])),
      span(0, 4),
      DEL_INPUT,
    ).state;

    const items = pItems(s);
    const emb = items.find((it) => it.kind === "embed");
    if (emb?.kind !== "embed") throw new Error("expected the embed to survive");
    // Embed preserved, NOT tagged (the range model ignores generic embed attrs).
    expect(emb.attrs[DELETION_SUGGESTION_ATTR]).toBeUndefined();
    // The text in range flanking the embed IS tagged: "AA" (0..2, before the
    // embed) and the first "C" (3..4, after it). The trailing "C" (4..5) is
    // outside the span and stays plain.
    const aa = items.find((it) => it.kind === "text" && it.text === "AA");
    if (aa?.kind !== "text") throw new Error("expected the AA run");
    expect(aa.attrs[DELETION_SUGGESTION_ATTR]).toBe(DEL_SID);
    const tagged = items.filter(
      (it) => it.kind === "text" && it.attrs[DELETION_SUGGESTION_ATTR] === DEL_SID,
    );
    // Exactly one deletion record, spanning embed-flanking text.
    expect(getSuggestions(s).filter((x) => x.kind === "deletion").length).toBe(1);
    expect(tagged.length).toBe(2); // "AA" + the in-range "C"
  });
});

describe("markDeletion — identity no-ops", () => {
  it("a collapsed span returns the SAME state reference + empty dirtyIds", () => {
    const s = oneBlock();
    const r = markDeletion(s, span(2, 2), DEL_INPUT);
    expect(r.state).toBe(s);
    expect(r.dirtyIds.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// markDeletion — IDENTITY PRESERVATION (#491). The surgical strike
// (applyDeletionStrikeInTx) mutates only the changed runs in place; runs the
// strike never touches — and a whole-covered run that is merely tagged — keep
// their Y.Text CRDT identity (the old full-replace seam rebuilt EVERY run,
// discarding identity, which silently breaks single-user undo of a prior edit
// in the same block AND a peer's concurrent insert into an untouched run).
// ─────────────────────────────────────────────────────────────────────────

/** The live Y.Array of block `id`'s inlineContent (raw-Y access for identity). */
function yItemsOf(s: State, id: string): Y.Array<Y.Map<unknown>> {
  const doc = s[STATE_INTERNAL].doc;
  const yBlock = getYBlock(doc, id as BlockId, "test", "block");
  const yItems = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>> | null;
  if (yItems === null) throw new Error(`block ${id} has no inlineContent`);
  return yItems;
}

/** The Y.Text of the inline item at `index` (text items only). */
function yTextAt(yItems: Y.Array<Y.Map<unknown>>, index: number): Y.Text {
  return yItems.get(index).get("text") as Y.Text;
}

describe("markDeletion — identity-preserving strike (#491)", () => {
  it("D1: a run wholly OUTSIDE the strike range keeps its Y.Text identity", () => {
    // Three distinct-attr runs so nothing coalesces: aa[0,2) bb[2,4) cc[4,6).
    // Strike the MIDDLE run bb[2,4) (whole-covered). aa (before) and cc (after)
    // are untouched survivors and must keep their exact Y.Text objects.
    const s0 = oneBlock(
      inlineContent([
        text("aa", { bold: true }),
        text("bb", { italic: true }),
        text("cc", { underline: true }),
      ]),
    );
    const y0 = yItemsOf(s0, "p");
    const aaText = yTextAt(y0, 0);
    const ccText = yTextAt(y0, 2);

    const s1 = markDeletion(s0, span(2, 4), DEL_INPUT).state;
    const y1 = yItemsOf(s1, "p");

    // Layout unchanged: aa[bb tagged]cc, three runs, all text present.
    expect(y1.length).toBe(3);
    expect(pText(s1)).toBe("aabbcc");
    // The untouched survivors are the SAME Y.Text objects (identity preserved).
    expect(yTextAt(y1, 0)).toBe(aaText);
    expect(yTextAt(y1, 2)).toBe(ccText);
  });

  it("D3: a whole-covered tagged run keeps its Y.Text identity (only attrs change)", () => {
    const s0 = oneBlock(
      inlineContent([
        text("aa", { bold: true }),
        text("bb", { italic: true }),
        text("cc", { underline: true }),
      ]),
    );
    const y0 = yItemsOf(s0, "p");
    const bbText = yTextAt(y0, 1);

    const s1 = markDeletion(s0, span(2, 4), DEL_INPUT).state;
    const y1 = yItemsOf(s1, "p");

    // The tagged run is the SAME Y.Text object — only its attrs gained the
    // deletion id (an in-place set, not a rebuild).
    expect(yTextAt(y1, 1)).toBe(bbText);
    const bbItem = pItems(s1).find((it) => it.kind === "text" && it.text === "bb");
    if (bbItem?.kind !== "text") throw new Error("expected the bb run");
    expect(bbItem.attrs[DELETION_SUGGESTION_ATTR]).toBe(DEL_SID);
    expect(bbItem.attrs.italic).toBe(true); // live format untouched
  });

  it("D2: a peer's concurrent insert into an UNTOUCHED run survives merge after a markDeletion (collab — the load-bearing win)", () => {
    // The load-bearing motivation (#491 §1.2): the state model is Yjs-backed for
    // collaboration. A full-replace strike materializes FRESH Y.Text for every
    // run, so a peer's concurrent insertion into an UNTOUCHED run of the same
    // block is silently obliterated on sync (the rebuild has no merge semantics).
    // The surgical strike leaves untouched runs' Y.Text intact, so the peer's
    // edit merges. Three distinct-attr runs: aa[0,2) bb[2,4) cc[4,6).
    const fixture = oneBlock(
      inlineContent([
        text("aa", { bold: true }),
        text("bb", { italic: true }),
        text("cc", { underline: true }),
      ]),
    );

    // Peer B starts from a synced copy of the fixture doc (a clone via update
    // bytes — the collab transport).
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(fixture[STATE_INTERNAL].doc));
    const stateB = createState({ rootId: fixture.rootId, doc: docB });

    // Peer A: markDeletion over the MIDDLE run bb[2,4) (cc is untouched).
    const stateA = markDeletion(fixture, span(2, 4), DEL_INPUT).state;

    // Peer B (concurrently, on its own doc): insert "Z" into the UNTOUCHED cc
    // run's live Y.Text at local offset 1 → "cZc". Direct Y.Text mutation models
    // a peer typing into that run before sync.
    const yccB = yTextAt(yItemsOf(stateB, "p"), 2);
    docB.transact(() => {
      yccB.insert(1, "Z");
    });

    // Sync the two peers (exchange update bytes, both directions).
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(stateA[STATE_INTERNAL].doc));
    Y.applyUpdate(stateA[STATE_INTERNAL].doc, Y.encodeStateAsUpdate(docB));

    // After merge, A sees BOTH changes: bb is tagged-deleted AND B's "Z" landed
    // inside the untouched cc run ("cZc"). With the old full-replace, A's strike
    // tombstoned cc's Y.Text, so B's insert would be lost (cc stays "cc").
    const mergedA = createState({ rootId: fixture.rootId, doc: stateA[STATE_INTERNAL].doc });
    expect(pText(mergedA)).toBe("aabbcZc");
    const bbItem = pItems(mergedA).find((it) => it.kind === "text" && it.text === "bb");
    if (bbItem?.kind !== "text") throw new Error("expected the tagged bb run");
    expect(bbItem.attrs[DELETION_SUGGESTION_ATTR]).toBe(DEL_SID);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// mintInsertion (slice 3c) — the INSERT_TEXT/PASTE suggesting-mode op: insert
// text carrying an `insertionSuggestionId` attr + write an `insertion` record,
// in ONE tracked op (one undo unit). Coalesces a continuous typing run into ONE
// suggestion.
// ─────────────────────────────────────────────────────────────────────────

const INS_SID = "ins1" as SuggestionId;
const INS_INPUT = { id: INS_SID, author: "alice", createdAt: 7000 } as const;

/** The first text item of p whose attrs carry the insertion-suggestion attr. */
function insertedRunAttr(s: State): unknown {
  for (const it of pItems(s)) {
    if (it.kind === "text" && it.attrs[INSERTION_SUGGESTION_ATTR] !== undefined) {
      return it.attrs[INSERTION_SUGGESTION_ATTR];
    }
  }
  return undefined;
}

describe("mintInsertion — insert text carrying an insertion id + write record in ONE tracked op", () => {
  it("inserts the text, stamps the inserted run with insertionSuggestionId, writes an insertion record with a live range", () => {
    const s = mintInsertion(oneBlock(), createPosition("p" as BlockId, 3), "XY", {}, INS_INPUT).state;

    // "XY" landed at offset 3 → "abcXYdef".
    expect(pText(s)).toBe("abcXYdef");
    // The inserted run carries the insertion id.
    expect(insertedRunAttr(s)).toBe(INS_SID);

    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    const sug = nth(suggestions, 0, "suggestion");
    expect(sug.id).toBe(INS_SID);
    expect(sug.kind).toBe("insertion");
    expect(sug.author).toBe("alice");
    expect(sug.createdAt).toBe(7000);
    expect(sug.proposedAttrs).toBeUndefined();
    expect(sug.orphaned).toBe(false);
    // Range covers the inserted "XY" run (offsets 3..5).
    expect(sug.range?.start).toEqual(createPosition("p" as BlockId, 3));
    expect(sug.range?.end).toEqual(createPosition("p" as BlockId, 5));
  });

  it("the caller's attrs become the inserted run's live format; the resolved id overwrites any insertionSuggestionId in attrs", () => {
    // Caller passes bold + a STALE insertionSuggestionId; the op must keep bold
    // and OVERWRITE the id with the resolved (minted) one.
    const s = mintInsertion(
      oneBlock(),
      createPosition("p" as BlockId, 3),
      "XY",
      { bold: true, [INSERTION_SUGGESTION_ATTR]: "stale" } as ReadonlyAttrs,
      INS_INPUT,
    ).state;

    const inserted = pItems(s).find(
      (it) => it.kind === "text" && it.text === "XY",
    );
    if (inserted === undefined || inserted.kind !== "text") {
      throw new Error("expected the inserted XY run");
    }
    expect(inserted.attrs.bold).toBe(true);
    expect(inserted.attrs[INSERTION_SUGGESTION_ATTR]).toBe(INS_SID);
  });
});

describe("mintInsertion — undo atomicity (text + record revert together)", () => {
  it("undo removes BOTH the inserted text AND the record; redo restores both", () => {
    const s0 = oneBlock();
    const history = createHistory(s0);

    history.beginEntry("command", 0);
    const minted = mintInsertion(s0, createPosition("p" as BlockId, 3), "XY", {}, INS_INPUT);
    history.commit(minted, { before: null, after: null });
    const s1 = minted.state;
    expect(pText(s1)).toBe("abcXYdef");
    expect(getSuggestions(s1).length).toBe(1);
    expect(insertedRunAttr(s1)).toBe(INS_SID);

    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const s2 = undone.state;
    expect(pText(s2)).toBe("abcdef");
    expect(getSuggestions(s2).length).toBe(0);
    expect(insertedRunAttr(s2)).toBeUndefined();

    const redone = history.redo();
    if (redone === null) throw new Error("expected redo to return a result");
    const s3 = redone.state;
    expect(pText(s3)).toBe("abcXYdef");
    expect(getSuggestions(s3).length).toBe(1);
    expect(insertedRunAttr(s3)).toBe(INS_SID);

    history.destroy();
  });
});

describe("mintInsertion — coalesce a continuous typing run into ONE suggestion", () => {
  it("an immediately-adjacent insertion by the SAME author reuses the first id (ONE record, widened range)", () => {
    // Insert "XX" at offset 3 → "abcXXdef"; then "YY" at offset 5 (right after
    // the XX) → "abcXXYYdef". Same author, different minted id.
    let s = mintInsertion(oneBlock(), createPosition("p" as BlockId, 3), "XX", {}, {
      id: "first" as SuggestionId,
      author: "alice",
      createdAt: 1000,
    }).state;
    s = mintInsertion(s, createPosition("p" as BlockId, 5), "YY", {}, {
      id: "second" as SuggestionId,
      author: "alice",
      createdAt: 2000,
    }).state;

    expect(pText(s)).toBe("abcXXYYdef");

    const suggestions = getSuggestions(s);
    // Coalesced into ONE record (the second reused the first's id).
    expect(suggestions.length).toBe(1);
    expect(nth(suggestions, 0, "suggestion").id).toBe("first");
    expect(nth(suggestions, 0, "suggestion").kind).toBe("insertion");
    // Range widened to cover BOTH inserts (offsets 3..7).
    expect(nth(suggestions, 0, "suggestion").range?.start).toEqual(createPosition("p" as BlockId, 3));
    expect(nth(suggestions, 0, "suggestion").range?.end).toEqual(createPosition("p" as BlockId, 7));

    // The combined inserted text is contiguous and carries ONE id (the format
    // matches the neighbor, so planInsertText merged it into one physical run).
    const inserted = pItems(s).filter(
      (it) => it.kind === "text" && it.attrs[INSERTION_SUGGESTION_ATTR] === "first",
    );
    expect(inserted.length).toBe(1);
    const insertedRun = nth(inserted, 0, "inserted run");
    if (insertedRun.kind === "text") {
      expect(insertedRun.text).toBe("XXYY");
    }
  });

  it("coalesces via the AFTER neighbor (inserting at the START of an existing insertion run)", () => {
    // Insert "XX" at offset 0 → "XXabcdef"; then "YY" at offset 0 AGAIN. The
    // before-neighbor is null (offset -1); the after-neighbor is the "XX" run
    // (starts at offset 0). planInsertText prepends "YY" into that run. This
    // exercises the after-neighbor path, distinct from the before-neighbor tests
    // above because mintInsertion routes through planInsertText's in-place path.
    let s = mintInsertion(oneBlock(), createPosition("p" as BlockId, 0), "XX", {}, {
      id: "first" as SuggestionId,
      author: "alice",
      createdAt: 1000,
    }).state;
    s = mintInsertion(s, createPosition("p" as BlockId, 0), "YY", {}, {
      id: "second" as SuggestionId,
      author: "alice",
      createdAt: 2000,
    }).state;

    expect(pText(s)).toBe("YYXXabcdef");
    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    expect(nth(suggestions, 0, "suggestion").id).toBe("first"); // reused from the after-neighbor
    expect(nth(suggestions, 0, "suggestion").range?.start).toEqual(createPosition("p" as BlockId, 0));
    expect(nth(suggestions, 0, "suggestion").range?.end).toEqual(createPosition("p" as BlockId, 4));
  });

  it("does NOT coalesce across a DIFFERENT author (two records)", () => {
    let s = mintInsertion(oneBlock(), createPosition("p" as BlockId, 3), "XX", {}, {
      id: "first" as SuggestionId,
      author: "alice",
      createdAt: 1000,
    }).state;
    s = mintInsertion(s, createPosition("p" as BlockId, 5), "YY", {}, {
      id: "second" as SuggestionId,
      author: "bob",
      createdAt: 2000,
    }).state;

    expect(getSuggestions(s).filter((x) => x.kind === "insertion").length).toBe(2);
  });

  it("an insertion not adjacent to any insertion mints a fresh record", () => {
    // Plain "abcdef", no adjacent insertion → one fresh insertion suggestion.
    const s = mintInsertion(oneBlock(), createPosition("p" as BlockId, 3), "XY", {}, INS_INPUT).state;
    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    expect(nth(suggestions, 0, "suggestion").id).toBe(INS_SID);
  });
});

describe("mintInsertion — identity no-op", () => {
  it("empty text returns the SAME state reference + empty dirtyIds", () => {
    const s = oneBlock();
    const r = mintInsertion(s, createPosition("p" as BlockId, 3), "", {}, INS_INPUT);
    expect(r.state).toBe(s);
    expect(r.dirtyIds.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// acceptSuggestion / rejectSuggestion (slice 3d-i) — resolve ONE suggestion by
// id: apply it for real (accept) or discard it (reject), then delete the
// record. NON-undoable (Google Docs convention).
// ─────────────────────────────────────────────────────────────────────────

describe("acceptSuggestion / rejectSuggestion — insertion", () => {
  it("accept STRIPS the insertion id (the run becomes plain text), text stays", () => {
    // mintInsertion "XY" at offset 3 → "abcXYdef" tagged with INS_SID.
    const minted = mintInsertion(
      oneBlock(),
      createPosition("p" as BlockId, 3),
      "XY",
      {},
      INS_INPUT,
    ).state;
    expect(insertedRunAttr(minted)).toBe(INS_SID);

    const s = acceptSuggestion(minted, INS_SID).state;
    // Text is preserved; the run is now PLAIN (no insertion id).
    expect(pText(s)).toBe("abcXYdef");
    expect(insertedRunAttr(s)).toBeUndefined();
    // Record gone.
    expect(getSuggestions(s).length).toBe(0);
  });

  it("reject DROPS the inserted run (real delete back to original)", () => {
    const minted = mintInsertion(
      oneBlock(),
      createPosition("p" as BlockId, 3),
      "XY",
      {},
      INS_INPUT,
    ).state;
    expect(pText(minted)).toBe("abcXYdef");

    const s = rejectSuggestion(minted, INS_SID).state;
    // "XY" deleted for real → back to "abcdef".
    expect(pText(s)).toBe("abcdef");
    expect(insertedRunAttr(s)).toBeUndefined();
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("acceptSuggestion / rejectSuggestion — deletion", () => {
  it("accept DROPS the soft-deleted run (real delete of the marked text)", () => {
    // markDeletion over "bcd" (offsets 1..4) → "abcdef" with "bcd" tagged.
    const marked = markDeletion(oneBlock(), span(1, 4), DEL_INPUT).state;
    expect(pText(marked)).toBe("abcdef");
    expect(deletedRunAttr(marked)).toBe(DEL_SID);

    const s = acceptSuggestion(marked, DEL_SID).state;
    // "bcd" deleted for real → "aef".
    expect(pText(s)).toBe("aef");
    expect(deletedRunAttr(s)).toBeUndefined();
    expect(getSuggestions(s).length).toBe(0);
  });

  it("reject STRIPS the deletion id (the text stays, un-tagged)", () => {
    const marked = markDeletion(oneBlock(), span(1, 4), DEL_INPUT).state;

    const s = rejectSuggestion(marked, DEL_SID).state;
    // Text fully preserved; no deletion attr remains.
    expect(pText(s)).toBe("abcdef");
    expect(deletedRunAttr(s)).toBeUndefined();
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("acceptSuggestion / rejectSuggestion — multi-author nested run cleanup (CT-audit BUG1)", () => {
  // p: "AA" + bob-insertion "BB" (ins1), then alice soft-deletes "BB" (del1) →
  // the "BB" run carries BOTH ids; both records live. Resolving EITHER id such
  // that the run is DROPPED must also clean up the co-tenant record — else it is
  // left orphaned (present, range null).
  function nestedRun(): State {
    let s = oneBlock(
      inlineContent([text("AA"), text("BB", { [INSERTION_SUGGESTION_ATTR]: "ins1" }), text("CC")]),
    );
    s = seedInsertionRecord(s, "ins1", "bob");
    s = markDeletion(s, span(2, 4), DEL_INPUT).state; // alice deletes bob's "BB" → nest
    return s;
  }

  it("reject the insertion DROPS the run AND deletes the now-orphaned co-tenant deletion record", () => {
    const s = nestedRun();
    expect(getSuggestions(s).length).toBe(2); // ins1 + del1 both live
    const r = rejectSuggestion(s, "ins1" as SuggestionId).state;
    expect(pText(r)).toBe("AACC"); // "BB" dropped (reject-insertion never lands)
    // del1 tagged ONLY "BB" → its content is gone → record must be gone, not orphaned.
    expect(getSuggestions(r).length).toBe(0);
  });

  it("accept the deletion DROPS the run AND deletes the now-orphaned co-tenant insertion record", () => {
    const s = nestedRun();
    const r = acceptSuggestion(s, DEL_SID).state;
    expect(pText(r)).toBe("AACC"); // "BB" removed for real (accept-deletion)
    expect(getSuggestions(r).length).toBe(0); // ins1 (bob) co-tenant cleaned up
  });

  it("does NOT delete a formatting co-tenant still carried by a SURVIVING visible embed (#482 second path)", () => {
    // [text("AA"), text("BB", {ins1=bob}), page-field embed]. markFormatting over
    // [2,5) stamps fmt1 on BOTH the "BB" run AND the visible page-field embed
    // (markFormatting stamps visible embeds — #478). "BB" thus carries ins1 + fmt1;
    // the embed carries fmt1 ONLY. Reject ins1 → the "BB" run is DROPPED, but the
    // embed survives and STILL references fmt1. The fmt1 record must NOT be deleted
    // (it is still live on the embed). Pre-fix `suggestionIdsOnItem` ignored embed
    // FORMATTING attrs, so the embed never entered `survivors` → fmt1 wrongly deleted.
    const FMT1 = "fmt1" as SuggestionId;
    let s = oneBlock(
      inlineContent([
        text("AA"),
        text("BB", { [INSERTION_SUGGESTION_ATTR]: "ins1" }),
        embed("page-field", { fieldType: "page-number" }),
      ]),
    );
    s = seedInsertionRecord(s, "ins1", "bob");
    s = markFormatting(s, span(2, 5), { bold: true }, {
      id: FMT1,
      author: "carol",
      createdAt: 7000,
    }).state;
    // Precondition: the embed carries fmt1; no SURVIVING text run carries fmt1.
    const embedBefore = pItems(s).find((it) => it.kind === "embed" && it.embedType === "page-field");
    if (embedBefore === undefined || embedBefore.kind !== "embed") throw new Error("expected page-field embed");
    expect(embedBefore.attrs[FORMATTING_SUGGESTION_ATTR]).toBe(FMT1);
    expect(getSuggestions(s).length).toBe(2); // ins1 + fmt1 both live

    const r = rejectSuggestion(s, "ins1" as SuggestionId).state;
    expect(pText(r)).toBe("AA"); // "BB" dropped (reject-insertion never lands)
    // fmt1 is still referenced by the surviving embed → record must survive.
    const after = getSuggestions(r);
    expect(after.find((x) => x.id === FMT1)).toBeDefined();
    const embedAfter = pItems(r).find((it) => it.kind === "embed" && it.embedType === "page-field");
    if (embedAfter === undefined || embedAfter.kind !== "embed") throw new Error("expected surviving page-field embed");
    expect(embedAfter.attrs[FORMATTING_SUGGESTION_ATTR]).toBe(FMT1);
  });

  it("does NOT over-delete a co-tenant that still tags surviving content", () => {
    // del1 tags BOTH the nested "BB" (with ins1) AND a plain "CC".
    let s = oneBlock(
      inlineContent([text("AA"), text("BB", { [INSERTION_SUGGESTION_ATTR]: "ins1" }), text("CC")]),
    );
    s = seedInsertionRecord(s, "ins1", "bob");
    s = markDeletion(s, span(2, 6), DEL_INPUT).state; // delete "BBCC": "BB" nests, "CC" plain-tagged
    expect(getSuggestions(s).length).toBe(2);

    const r = rejectSuggestion(s, "ins1" as SuggestionId).state;
    expect(pText(r)).toBe("AACC"); // "BB" dropped; "CC" survives (carries del1, not ins1)
    const after = getSuggestions(r);
    expect(after.length).toBe(1);
    expect(nth(after, 0, "suggestion").id).toBe(DEL_SID);
    expect(nth(after, 0, "suggestion").orphaned).toBe(false); // del1 still live on "CC"
  });
});

describe("acceptSuggestion / rejectSuggestion — formatting", () => {
  it("accept APPLIES proposedAttrs LIVE and strips the formatting id", () => {
    // markFormatting over "bcd" (1..4) proposing bold:true on a non-bold run.
    const marked = markFormatting(oneBlock(), span(1, 4), { bold: true }, INPUT).state;
    expect(markedRunAttr(marked)).toBe(SID);

    const s = acceptSuggestion(marked, SID).state;
    expect(getSuggestions(s).length).toBe(0);
    // The in-range run is now LIVE bold and carries NO formatting id.
    const run = pItems(s).find((it) => it.kind === "text" && it.text === "bcd");
    if (run === undefined || run.kind !== "text") {
      throw new Error("expected the bcd run");
    }
    expect(run.attrs.bold).toBe(true);
    expect(FORMATTING_SUGGESTION_ATTR in run.attrs).toBe(false);
  });

  it("reject STRIPS the formatting id and leaves live attrs unchanged (proposal discarded)", () => {
    const marked = markFormatting(oneBlock(), span(1, 4), { bold: true }, INPUT).state;

    const s = rejectSuggestion(marked, SID).state;
    expect(getSuggestions(s).length).toBe(0);
    // The proposal was NOT applied: no run is bold, and no formatting id
    // survives anywhere. (Stripping the id makes the once-marked "bcd" run's
    // attrs identical to its neighbors, so it re-merges into a single plain
    // "abcdef" run.)
    expect(pText(s)).toBe("abcdef");
    for (const it of pItems(s)) {
      if (it.kind !== "text") continue;
      expect("bold" in it.attrs).toBe(false);
      expect(FORMATTING_SUGGESTION_ATTR in it.attrs).toBe(false);
    }
    expect(markedRunAttr(s)).toBeUndefined();
  });

  // #478: a VISIBLE field embed (here a `tab`) inside a formatting-suggestion
  // range is stamped with the formatting id by markFormatting (markers are
  // skipped — #465). Resolve MUST strip that provenance from the embed too —
  // else it dangles after the record is deleted. Both single-id and bulk paths.
  const withTabEmbed = () =>
    oneBlock(inlineContent([text("ab"), embed("tab"), text("cd")]));
  const tabEmbed = (s: State) => {
    const e = pItems(s).find((it) => it.kind === "embed" && it.embedType === "tab");
    if (e === undefined || e.kind !== "embed") throw new Error("expected the tab embed");
    return e;
  };

  it("accept applies the proposal to a VISIBLE embed in range + strips its id (#478)", () => {
    const marked = markFormatting(withTabEmbed(), span(0, 5), { bold: true }, INPUT).state;
    expect(tabEmbed(marked).attrs[FORMATTING_SUGGESTION_ATTR]).toBe(SID); // stamped (visible embed)

    const s = acceptSuggestion(marked, SID).state;
    expect(FORMATTING_SUGGESTION_ATTR in tabEmbed(s).attrs).toBe(false);
    expect(tabEmbed(s).attrs.bold).toBe(true);
  });

  it("reject strips a VISIBLE embed's formatting id without applying the proposal (#478)", () => {
    const marked = markFormatting(withTabEmbed(), span(0, 5), { bold: true }, INPUT).state;
    const s = rejectSuggestion(marked, SID).state;
    expect(FORMATTING_SUGGESTION_ATTR in tabEmbed(s).attrs).toBe(false);
    expect("bold" in tabEmbed(s).attrs).toBe(false);
  });

  // Fresh state per bulk resolve: acceptAll/rejectAll are NON-undoable and mutate
  // the doc in place, so each must start from an independent markFormatting result.
  it("acceptAll resolves a VISIBLE embed's provenance — applies + strips (#478)", () => {
    const acc = acceptAll(markFormatting(withTabEmbed(), span(0, 5), { bold: true }, INPUT).state).state;
    expect(FORMATTING_SUGGESTION_ATTR in tabEmbed(acc).attrs).toBe(false);
    expect(tabEmbed(acc).attrs.bold).toBe(true);
  });

  it("rejectAll resolves a VISIBLE embed's provenance — strips, no proposal (#478)", () => {
    const rej = rejectAll(markFormatting(withTabEmbed(), span(0, 5), { bold: true }, INPUT).state).state;
    expect(FORMATTING_SUGGESTION_ATTR in tabEmbed(rej).attrs).toBe(false);
    expect("bold" in tabEmbed(rej).attrs).toBe(false);
  });

  it("single-id resolve leaves an embed carrying a DIFFERENT suggestion's id untouched (onlyId filter, #478)", () => {
    // [text("a"), tab(S1), text("b"), page-field(S2), text("c")]. Accept S1 only:
    // the tab resolves; the page-field (a different suggestion) must be untouched.
    const SID2 = "s2" as SuggestionId;
    let s = markFormatting(
      oneBlock(
        inlineContent([
          text("a"),
          embed("tab"),
          text("b"),
          embed("page-field", { fieldType: "page-number" }),
          text("c"),
        ]),
      ),
      span(0, 2),
      { bold: true },
      INPUT,
    ).state;
    s = markFormatting(s, span(3, 4), { italic: true }, { id: SID2, author: "alice", createdAt: 2000 }).state;

    const accepted = acceptSuggestion(s, SID).state;
    const tab = pItems(accepted).find((it) => it.kind === "embed" && it.embedType === "tab");
    if (tab === undefined || tab.kind !== "embed") throw new Error("expected the tab embed");
    expect(FORMATTING_SUGGESTION_ATTR in tab.attrs).toBe(false); // S1 resolved
    expect(tab.attrs.bold).toBe(true);

    const pf = pItems(accepted).find((it) => it.kind === "embed" && it.embedType === "page-field");
    if (pf === undefined || pf.kind !== "embed") throw new Error("expected the page-field embed");
    expect(pf.attrs[FORMATTING_SUGGESTION_ATTR]).toBe(SID2); // the OTHER suggestion is untouched
  });
});

describe("acceptSuggestion — NON-undoable (invisible to the UndoManager)", () => {
  it("an accept pushes NO undo step: undo still reverts the prior tracked edit, then nothing remains", () => {
    // Two blocks: pA carries a tracked, committed formatting edit (the ONLY
    // undo entry); pB carries an INDEPENDENT suggestion we will accept. The
    // accept rewrites ONLY pB (a non-undoable SUGGESTION_RESOLVE_ORIGIN txn → no
    // UndoManager StackItem), so it can neither entangle pA's StackItem nor add
    // its own. We then assert undo() cleanly reverts the pA edit and that NO
    // second undo step exists — proving the accept was invisible to the undo
    // manager. (A same-block design fails because rewriting the block the undo
    // entry touched detaches that StackItem's content; isolating the accept to a
    // different block is the clean proof.)
    const aSid = "fmtA" as SuggestionId;
    const bSid = "fmtB" as SuggestionId;
    const twoBlocks = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "pA", lastChildId: "pB" }),
        buildBlock({
          id: "pA",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "pB",
          inlineContent: inlineContent([text("aaaaaa")]),
        }),
        buildBlock({
          id: "pB",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "pA",
          inlineContent: inlineContent([text("bbbbbb")]),
        }),
      ],
    });
    const spanIn = (block: string, a: number, b: number): Span =>
      createSpan(createPosition(block as BlockId, a), createPosition(block as BlockId, b));
    const fmtAttr = (s: State, block: string): unknown => {
      for (const it of getBlock(s, block as BlockId)?.inlineContent?.items ?? []) {
        if (it.kind === "text" && it.attrs[FORMATTING_SUGGESTION_ATTR] !== undefined) {
          return it.attrs[FORMATTING_SUGGESTION_ATTR];
        }
      }
      return undefined;
    };

    // Seed pB's suggestion BEFORE constructing the History (so the UndoManager,
    // built over `withB`, never sees this create as an undo entry — it is
    // irrelevant to the undoability proof; we only need a live suggestion in pB
    // to accept).
    const withB = markFormatting(twoBlocks, spanIn("pB", 1, 4), { bold: true }, {
      id: bSid,
      author: "alice",
      createdAt: 1,
    }).state;

    const history = createHistory(withB);

    // The ONE tracked, committed undo entry: a formatting suggestion in pA.
    history.beginEntry("command", 100);
    const markedA = markFormatting(withB, spanIn("pA", 1, 4), { italic: true }, {
      id: aSid,
      author: "alice",
      createdAt: 2,
    });
    history.commit(markedA, { before: null, after: null });
    const s1 = markedA.state;
    expect(fmtAttr(s1, "pA")).toBe(aSid);
    expect(getSuggestions(s1).length).toBe(2);

    // Close the open undo group BEFORE the non-undoable resolve, so the untracked
    // resolve txn cannot merge into it under captureTimeout:MAX (the same
    // stopCapturing the editor does before any non-coalescing op).
    history.breakCoalescing();
    // Accept pB's suggestion — NON-undoable; rewrites ONLY pB. Reconcile cached
    // state (the resolve txn skipped History.commit).
    const accepted = acceptSuggestion(s1, bSid);
    history.advanceState(accepted.state);
    expect(fmtAttr(accepted.state, "pB")).toBeUndefined(); // applied + stripped in pB
    expect(getSuggestions(accepted.state).length).toBe(1); // only pA's remains

    // undo() pops the ONLY tracked entry — pA's create — and reverts it cleanly.
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    expect(fmtAttr(undone.state, "pA")).toBeUndefined(); // pA edit reverted
    // The accept itself produced NO undo step → no second undo remains.
    expect(history.canUndo()).toBe(false);

    history.destroy();
  });
});

describe("acceptSuggestion / rejectSuggestion — absent record no-op", () => {
  it("accepting a nonexistent id returns the SAME state reference + empty dirtyIds", () => {
    const s = oneBlock();
    const r = acceptSuggestion(s, "nonexistent" as SuggestionId);
    expect(r.state).toBe(s);
    expect(r.dirtyIds.size).toBe(0);
  });

  it("rejecting a nonexistent id returns the SAME state reference + empty dirtyIds", () => {
    const s = oneBlock();
    const r = rejectSuggestion(s, "nonexistent" as SuggestionId);
    expect(r.state).toBe(s);
    expect(r.dirtyIds.size).toBe(0);
  });

  it("orphaned-by-presence (record exists but NO run carries its id) deletes the record + advances state", () => {
    // A record present in the map with NO inline run carrying its id — e.g. a
    // collab peer stripped the tags first. Distinct from the absent-record path (which
    // returns early): here the block scan finds nothing, so the resolve must
    // surface state.rootId so the record-delete still advances state (not a stale
    // identity return that would leave a zombie record forever).
    const orphan = "orphan" as SuggestionId;
    const seeded = applyOperation(oneBlock(), (doc) => {
      writeSuggestionRecordInTx(doc, {
        id: orphan,
        kind: "deletion",
        author: "alice",
        createdAt: 1,
      });
    }).state;
    expect(getSuggestions(seeded).length).toBe(1);

    const r = acceptSuggestion(seeded, orphan);
    expect(r.state).not.toBe(seeded); // state advanced (not an identity no-op)
    expect(r.dirtyIds.size).toBeGreaterThan(0);
    expect(getSuggestions(r.state).length).toBe(0); // the dangling record is gone
  });
});

describe("acceptSuggestion / rejectSuggestion — multi-block deletion (write loop over >1 block)", () => {
  it("accept DROPS the tagged runs in BOTH blocks the suggestion spans", () => {
    // p1="abcdef", p2="ghijkl"; markDeletion across the boundary tags "cdef" in
    // p1 (offsets 2..6) and "ghij" in p2 (offsets 0..4) with ONE id.
    const marked = markDeletion(
      twoBlocks(inlineContent([text("abcdef")]), inlineContent([text("ghijkl")])),
      createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 4)),
      DEL_INPUT,
    ).state;

    const s = acceptSuggestion(marked, DEL_SID).state;
    // Tagged text removed for real in BOTH blocks.
    expect(itemsOf(s, "p1").map((it) => (it.kind === "text" ? it.text : "")).join("")).toBe("ab");
    expect(itemsOf(s, "p2").map((it) => (it.kind === "text" ? it.text : "")).join("")).toBe("kl");
    expect(getSuggestions(s).length).toBe(0);
  });

  it("reject STRIPS the deletion id from BOTH blocks (text preserved everywhere)", () => {
    const marked = markDeletion(
      twoBlocks(inlineContent([text("abcdef")]), inlineContent([text("ghijkl")])),
      createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 4)),
      DEL_INPUT,
    ).state;

    const s = rejectSuggestion(marked, DEL_SID).state;
    // Text intact in both blocks; no deletion attr survives anywhere.
    expect(itemsOf(s, "p1").map((it) => (it.kind === "text" ? it.text : "")).join("")).toBe("abcdef");
    expect(itemsOf(s, "p2").map((it) => (it.kind === "text" ? it.text : "")).join("")).toBe("ghijkl");
    for (const id of ["p1", "p2"]) {
      for (const it of itemsOf(s, id)) {
        if (it.kind === "text") expect(DELETION_SUGGESTION_ATTR in it.attrs).toBe(false);
      }
    }
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("acceptSuggestion / rejectSuggestion — MT-3: resolves a suggestion in an embed (footnote) body", () => {
  // doc>p("main") + embedContents fn(body-container)>fnp("abcdef") where "bcd"
  // (offsets 1..4) carries DELETION_SUGGESTION_ATTR "s-body", plus its record.
  // Pre-MT-3 the resolve scan visited only the main tree, so accept/reject
  // deleted the record but left the body run tagged as an un-resolvable zombie.
  function bodyDeletionState(): State {
    const seed = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("main")]) }),
      ],
      embedContents: [
        buildBlock({ id: "fn", type: "body-container", firstChildId: "fnp", lastChildId: "fnp" }),
        buildBlock({
          id: "fnp",
          type: "paragraph",
          parentId: "fn",
          inlineContent: inlineContent([
            text("a"),
            text("bcd", { [DELETION_SUGGESTION_ATTR]: "s-body" }),
            text("ef"),
          ]),
        }),
      ],
    });
    return applyOperation(seed, (doc) => {
      writeSuggestionRecordInTx(doc, {
        id: "s-body" as SuggestionId,
        kind: "deletion",
        author: "alice",
        createdAt: 1,
      });
    }).state;
  }

  /** Concatenated text of the embed-body block fnp (resolved off the main tree). */
  function fnpText(s: State): string {
    return (resolveBlock(s, "fnp" as BlockId)?.block.inlineContent?.items ?? [])
      .map((it) => (it.kind === "text" ? it.text : ""))
      .join("");
  }

  it("accept DROPS the soft-deleted run inside the footnote body for real", () => {
    const seeded = bodyDeletionState();
    expect(fnpText(seeded)).toBe("abcdef");
    expect(getSuggestions(seeded).length).toBe(1);

    const s = acceptSuggestion(seeded, "s-body" as SuggestionId).state;
    expect(fnpText(s)).toBe("aef"); // "bcd" really removed in the BODY tree
    expect(getSuggestions(s).length).toBe(0);
  });

  it("reject STRIPS the deletion id in the footnote body (text preserved)", () => {
    const seeded = bodyDeletionState();

    const s = rejectSuggestion(seeded, "s-body" as SuggestionId).state;
    expect(fnpText(s)).toBe("abcdef");
    for (const it of resolveBlock(s, "fnp" as BlockId)?.block.inlineContent?.items ?? []) {
      if (it.kind === "text") expect(DELETION_SUGGESTION_ATTR in it.attrs).toBe(false);
    }
    expect(getSuggestions(s).length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// acceptAll / rejectAll — bulk resolution (slice 3d-ii)
// ─────────────────────────────────────────────────────────────────────────

const ALL_INS_SID = "allIns" as SuggestionId;
const ALL_DEL_SID = "allDel" as SuggestionId;
const ALL_FMT_SID = "allFmt" as SuggestionId;

/**
 * A doc with THREE separate suggestion runs in one paragraph: an insertion run,
 * a deletion run, and a formatting run (proposing bold:true), each created via
 * its create op. Layout (left → right): "a" [ins "INS"] [del "DEL"] [fmt "FMT"]
 * "z". The DEL/FMT/INS runs each carry a DISTINCT live `color` so that — after
 * resolution strips the provenance ids — they do NOT re-merge with each other or
 * with the surrounding plain text, and stay independently findable (the
 * assertions look runs up by their text). The INS run is introduced by
 * `mintInsertion` (so it carries a real insertion record).
 */
function threeSuggestionDoc(): State {
  // Distinct-colored base runs so resolved runs stay independently findable.
  let s = oneBlock(
    inlineContent([
      text("a"),
      text("DEL", { color: "del" }),
      text("FMT", { color: "fmt" }),
      text("z"),
    ]),
  );
  // Insert "INS" (color: "ins") at offset 1 (right after "a"): "aINSDELFMTz".
  s = mintInsertion(s, createPosition("p" as BlockId, 1), "INS", { color: "ins" }, {
    id: ALL_INS_SID,
    author: "alice",
    createdAt: 10,
  }).state;
  // "DEL" now at offsets 4..7 — soft-delete it.
  s = markDeletion(s, span(4, 7), {
    id: ALL_DEL_SID,
    author: "alice",
    createdAt: 20,
  }).state;
  // "FMT" now at offsets 7..10 — propose bold:true.
  s = markFormatting(s, span(7, 10), { bold: true }, {
    id: ALL_FMT_SID,
    author: "alice",
    createdAt: 30,
  }).state;
  return s;
}

/** The single text run whose text equals `t` (throws if no such text run). */
function runWithText(s: State, t: string) {
  const run = pItems(s).find((it) => it.kind === "text" && it.text === t);
  if (run === undefined || run.kind !== "text") {
    throw new Error(`expected a text run "${t}"`);
  }
  return run;
}

describe("acceptAll — resolve every suggestion (accept dominance) in ONE non-undoable op", () => {
  it("insertion→plain, deletion→dropped, formatting→proposal applied live; suggestions cleared", () => {
    const s = acceptAll(threeSuggestionDoc()).state;

    // "DEL" is gone (accept-deletion removes the text); INS + FMT survive.
    expect(pText(s)).toBe("aINSFMTz");

    // The INS run is now plain (no insertion id).
    const ins = runWithText(s, "INS");
    expect(INSERTION_SUGGESTION_ATTR in ins.attrs).toBe(false);

    // The FMT run is LIVE bold and carries no formatting id.
    const fmt = runWithText(s, "FMT");
    expect(fmt.attrs.bold).toBe(true);
    expect(FORMATTING_SUGGESTION_ATTR in fmt.attrs).toBe(false);

    // No deletion id survives anywhere.
    for (const it of pItems(s)) {
      if (it.kind === "text") expect(DELETION_SUGGESTION_ATTR in it.attrs).toBe(false);
    }
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("rejectAll — resolve every suggestion (reject dominance) in ONE non-undoable op", () => {
  it("insertion→dropped, deletion→text kept (id stripped), formatting→proposal discarded; suggestions cleared", () => {
    const s = rejectAll(threeSuggestionDoc()).state;

    // "INS" is gone (reject-insertion drops the suggested text); DEL + FMT stay.
    expect(pText(s)).toBe("aDELFMTz");

    // The DEL run keeps its text with no deletion id.
    const del = runWithText(s, "DEL");
    expect(DELETION_SUGGESTION_ATTR in del.attrs).toBe(false);

    // The FMT run keeps original (non-bold) attrs, no formatting id.
    const fmt = runWithText(s, "FMT");
    expect("bold" in fmt.attrs).toBe(false);
    expect(FORMATTING_SUGGESTION_ATTR in fmt.attrs).toBe(false);

    // No insertion id survives anywhere.
    for (const it of pItems(s)) {
      if (it.kind === "text") expect(INSERTION_SUGGESTION_ATTR in it.attrs).toBe(false);
    }
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("acceptAll / rejectAll — NESTED insertion + deletion on ONE run is DROPPED under both", () => {
  /**
   * A doc whose single run carries BOTH `insertionSuggestionId` (by bob) and
   * `deletionSuggestionId` (by alice) — A inserted it, B suggested deleting it.
   * Both records are present. Under accept (delete dominates) AND reject (insert
   * dominates) the run must be DROPPED.
   */
  function nestedInsDelDoc(): State {
    // The run "X" carries both ids in its attrs; seed both records.
    let s = oneBlock(
      inlineContent([
        text("a"),
        text("X", {
          [INSERTION_SUGGESTION_ATTR]: ALL_INS_SID,
          [DELETION_SUGGESTION_ATTR]: ALL_DEL_SID,
        }),
        text("z"),
      ]),
    );
    s = seedInsertionRecord(s, ALL_INS_SID, "bob");
    s = applyOperation(s, (doc) => {
      writeSuggestionRecordInTx(doc, {
        id: ALL_DEL_SID,
        kind: "deletion",
        author: "alice",
        createdAt: 1,
      });
      return new Set<BlockId>([s.rootId]);
    }).state;
    return s;
  }

  it("acceptAll DROPS the nested run", () => {
    const s = acceptAll(nestedInsDelDoc()).state;
    expect(pText(s)).toBe("az");
    expect(getSuggestions(s).length).toBe(0);
  });

  it("rejectAll DROPS the nested run", () => {
    const s = rejectAll(nestedInsDelDoc()).state;
    expect(pText(s)).toBe("az");
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("acceptAll / rejectAll — NESTED insertion + formatting on ONE run (combined keep path)", () => {
  /**
   * A run "X" carrying BOTH an `insertionSuggestionId` (alice) and a
   * `formattingSuggestionId` (alice, proposing bold:true). Under acceptAll the
   * run KEEPS (no deletion id), strips the insertion id, AND applies the
   * proposal live. Under rejectAll the insertion dominates → the run is DROPPED.
   */
  function nestedInsFmtDoc(): State {
    let s = oneBlock(
      inlineContent([
        text("a"),
        text("X", {
          [INSERTION_SUGGESTION_ATTR]: ALL_INS_SID,
          [FORMATTING_SUGGESTION_ATTR]: ALL_FMT_SID,
        }),
        text("z"),
      ]),
    );
    s = seedInsertionRecord(s, ALL_INS_SID, "alice");
    s = applyOperation(s, (doc) => {
      writeSuggestionRecordInTx(doc, {
        id: ALL_FMT_SID,
        kind: "formatting",
        author: "alice",
        createdAt: 1,
        proposedAttrs: { bold: true },
      });
      return new Set<BlockId>([s.rootId]);
    }).state;
    return s;
  }

  it("acceptAll KEEPS the run as plain text WITH the proposed format applied", () => {
    const s = acceptAll(nestedInsFmtDoc()).state;
    expect(pText(s)).toBe("aXz");
    const x = runWithText(s, "X");
    expect(x.attrs.bold).toBe(true);
    expect(INSERTION_SUGGESTION_ATTR in x.attrs).toBe(false);
    expect(FORMATTING_SUGGESTION_ATTR in x.attrs).toBe(false);
    expect(getSuggestions(s).length).toBe(0);
  });

  it("rejectAll DROPS the run (insertion dominates)", () => {
    const s = rejectAll(nestedInsFmtDoc()).state;
    expect(pText(s)).toBe("az");
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("acceptAll / rejectAll — NESTED deletion + formatting on ONE run", () => {
  /**
   * A run "X" carrying BOTH a `deletionSuggestionId` (alice) and a
   * `formattingSuggestionId` (alice, proposing bold:true), no insertion. Under
   * acceptAll the deletion dominates → the run is DROPPED (its pending proposal
   * is moot). Under rejectAll (no insertion to dominate) the run is KEPT with
   * BOTH ids stripped and the proposal DISCARDED (text unchanged, not bold) —
   * the one non-trivial `rejectAll` keep-path distinct from the drop + single-id
   * strip paths.
   */
  function nestedDelFmtDoc(): State {
    let s = oneBlock(
      inlineContent([
        text("a"),
        text("X", {
          [DELETION_SUGGESTION_ATTR]: ALL_DEL_SID,
          [FORMATTING_SUGGESTION_ATTR]: ALL_FMT_SID,
        }),
        text("z"),
      ]),
    );
    s = applyOperation(s, (doc) => {
      writeSuggestionRecordInTx(doc, {
        id: ALL_DEL_SID,
        kind: "deletion",
        author: "alice",
        createdAt: 1,
      });
      writeSuggestionRecordInTx(doc, {
        id: ALL_FMT_SID,
        kind: "formatting",
        author: "alice",
        createdAt: 2,
        proposedAttrs: { bold: true },
      });
      return new Set<BlockId>([s.rootId]);
    }).state;
    return s;
  }

  it("acceptAll DROPS the run (deletion dominates; the proposal is moot)", () => {
    const s = acceptAll(nestedDelFmtDoc()).state;
    expect(pText(s)).toBe("az");
    expect(getSuggestions(s).length).toBe(0);
  });

  it("rejectAll KEEPS the text with BOTH ids stripped and the proposal discarded (not bold)", () => {
    const s = rejectAll(nestedDelFmtDoc()).state;
    // Text fully preserved. Stripping both ids makes the once-marked "X" run's
    // attrs plain `{}` — identical to its "a"/"z" neighbors — so it re-merges
    // into a single plain "aXz" run (no standalone "X" run survives).
    expect(pText(s)).toBe("aXz");
    for (const it of pItems(s)) {
      if (it.kind !== "text") continue;
      expect("bold" in it.attrs).toBe(false); // proposal discarded
      expect(DELETION_SUGGESTION_ATTR in it.attrs).toBe(false);
      expect(FORMATTING_SUGGESTION_ATTR in it.attrs).toBe(false);
    }
    expect(getSuggestions(s).length).toBe(0);
  });
});

describe("acceptAll — NON-undoable (invisible to the UndoManager)", () => {
  it("acceptAll pushes NO undo step: undo reverts only the prior tracked edit", () => {
    // Mirror of the single-id NON-undoable proof, adapted for the BULK op: because
    // acceptAll resolves EVERY suggestion, pA's tracked undo entry must NOT itself
    // be a suggestion (else acceptAll would rewrite pA and detach its StackItem).
    // So pA carries a PLAIN tracked insertText (the ONLY undo entry); the single
    // suggestion lives in pB and is the only thing acceptAll rewrites. The accept
    // (non-undoable SUGGESTION_RESOLVE_ORIGIN txn) can thus neither entangle nor
    // add to the undo stack — undo() cleanly reverts only the pA insert.
    const bSid = "fmtB" as SuggestionId;
    const doc2 = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "pA", lastChildId: "pB" }),
        buildBlock({
          id: "pA",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "pB",
          inlineContent: inlineContent([text("aaaaaa")]),
        }),
        buildBlock({
          id: "pB",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "pA",
          inlineContent: inlineContent([text("bbbbbb")]),
        }),
      ],
    });
    const spanIn = (block: string, a: number, b: number): Span =>
      createSpan(createPosition(block as BlockId, a), createPosition(block as BlockId, b));
    const pAText = (s: State): string =>
      (getBlock(s, "pA" as BlockId)?.inlineContent?.items ?? [])
        .filter((it): it is Extract<typeof it, { kind: "text" }> => it.kind === "text")
        .map((it) => it.text)
        .join("");

    // Seed pB's suggestion BEFORE the History is built (irrelevant to the undo
    // stack — we only need a live suggestion in pB to bulk-accept).
    const withB = markFormatting(doc2, spanIn("pB", 1, 4), { bold: true }, {
      id: bSid,
      author: "alice",
      createdAt: 1,
    }).state;

    const history = createHistory(withB);

    // The ONE tracked, committed undo entry: a PLAIN insert in pA (NOT a
    // suggestion — so acceptAll never rewrites pA and pA's StackItem stays whole).
    history.beginEntry("command", 100);
    const editedA = insertText(withB, createPosition("pA" as BlockId, 6), "XYZ", {});
    history.commit(editedA, { before: null, after: null });
    const s1 = editedA.state;
    expect(pAText(s1)).toBe("aaaaaaXYZ");
    expect(getSuggestions(s1).length).toBe(1); // only pB's suggestion

    history.breakCoalescing();
    // acceptAll resolves pB's suggestion — a non-undoable txn that touches ONLY
    // pB, pushing no StackItem; reconcile the cached state.
    const accepted = acceptAll(s1);
    history.advanceState(accepted.state);
    expect(getSuggestions(accepted.state).length).toBe(0); // suggestion resolved
    expect(pAText(accepted.state)).toBe("aaaaaaXYZ"); // pA untouched by acceptAll

    // undo() pops the ONLY tracked entry — pA's insert — and reverts it cleanly.
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    expect(pAText(undone.state)).toBe("aaaaaa"); // pA insert reverted
    // The acceptAll itself produced NO undo step → nothing remains.
    expect(history.canUndo()).toBe(false);

    history.destroy();
  });
});

describe("acceptAll / rejectAll — empty-doc / no-suggestions identity no-op", () => {
  it("acceptAll on a doc with no suggestions returns the SAME state reference + empty dirtyIds", () => {
    const s = oneBlock();
    const r = acceptAll(s);
    expect(r.state).toBe(s);
    expect(r.dirtyIds.size).toBe(0);
  });

  it("rejectAll on a doc with no suggestions returns the SAME state reference + empty dirtyIds", () => {
    const s = oneBlock();
    const r = rejectAll(s);
    expect(r.state).toBe(s);
    expect(r.dirtyIds.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// #484 — identity-preserving resolve: a resolve mutates ONLY the runs it
// changes (in-place attrs swap + delete-by-index), preserving the CRDT
// identity of every untouched run so a prior undoable edit's StackItem stays
// valid across a resolve of a DIFFERENT suggestion in the SAME block.
//
// U1/U2 are behavior tests through the real state API (mint/edit → resolve →
// undo). U3 is a white-box Y.Text `===` assertion on a structurally
// non-coalescing survivor. All three FAIL under the full-replace bridge
// (which tombstones every survivor's Y.Text) and pass once the surgical
// applier takes over.
// ─────────────────────────────────────────────────────────────────────────

/** The live Y.Array of block "p"'s inline content (raw Y access for U3). */
function yItemsOfP(s: State): Y.Array<Y.Map<unknown>> {
  const doc = s[STATE_INTERNAL].doc;
  const yBlock = getYBlock(doc, "p" as BlockId, "test", "block");
  return yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>>;
}

/** The index of the first item in `yItems` whose Y.Text equals `t` (-1 if none). */
function indexOfText(yItems: Y.Array<Y.Map<unknown>>, t: string): number {
  for (let i = 0; i < yItems.length; i++) {
    const yText = yItems.get(i).get("text");
    if (yText !== undefined && (yText as Y.Text).toString() === t) return i;
  }
  return -1;
}

describe("#484 — identity-preserving resolve keeps a prior same-block undoable edit valid", () => {
  it("U1: undo of a prior tracked-insertion edit survives a resolve of a DIFFERENT suggestion in that block", () => {
    // Two suggestions in ONE block "p": a SEEDED insertion ("INS" via s-pre, the
    // suggestion we resolve) and then a TRACKED, committed insertion edit E1
    // ("E1" via the History) that is the only undo entry. Resolving s-pre
    // (rejecting it → drops "INS") must NOT tombstone E1's Y.Text, so undo() of
    // E1 still REVERTS E1 (its content disappears). Under the full-replace bridge
    // the resolve rebuilds the whole block, detaching E1's StackItem and making
    // undo() a SILENT NO-OP (E1's text stays). The load-bearing claim is narrow:
    // undo of E1 is a real revert, not a no-op (we assert E1's text is gone — the
    // resolve's own non-undoability is a separate invariant, not under test here).
    const sPre = "s-pre" as SuggestionId;

    // Seed s-pre: mint an insertion "INS" at offset 0 → "INSabcdef" (before the
    // History exists, so it is NOT an undo entry — just the suggestion we resolve).
    const seeded = mintInsertion(oneBlock(), createPosition("p" as BlockId, 0), "INS", {}, {
      id: sPre,
      author: "alice",
      createdAt: 1,
    }).state;
    expect(pText(seeded)).toBe("INSabcdef");

    const history = createHistory(seeded);

    // E1: a TRACKED, committed insertion edit elsewhere in "p" — the ONLY undo
    // entry. Insert "E1" at the END ("INSabcdef".length = 9) → "INSabcdefE1".
    history.beginEntry("command", 100);
    const editedE1 = mintInsertion(seeded, createPosition("p" as BlockId, 9), "E1", {}, {
      id: "e1" as SuggestionId,
      author: "bob",
      createdAt: 2,
    });
    history.commit(editedE1, { before: null, after: null });
    const sE1 = editedE1.state;
    expect(pText(sE1)).toBe("INSabcdefE1");

    // Break the open undo group before the non-undoable resolve.
    history.breakCoalescing();
    // Resolve s-pre (REJECT → drops "INS"). Identity-preserving: only the "INS"
    // run is removed; E1's run keeps its Y.Text. Reconcile cached state.
    const resolved = rejectSuggestion(sE1, sPre);
    history.advanceState(resolved.state);
    expect(pText(resolved.state)).toBe("abcdefE1"); // INS dropped, E1 survives

    // undo() reverts E1 cleanly — proving its StackItem survived the resolve.
    // E1's inserted text is gone (a REAL revert, not a silent no-op).
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    // The #484 win: undo of E1 is a REAL revert (E1's text gone), not the
    // pre-#484 silent no-op (which left "abcdefE1"). Full content is "INSabcdef":
    // undoing E1 also REVIVES the rejected "INS" — that revival is the SEPARATE
    // #483 entanglement (a non-undoable resolve deletion overlapping a tracked
    // StackItem's region), explicitly out of #484's scope. Pinning the exact
    // result rules out over/under-revert; it still fails pre-#484 (was "abcdefE1").
    expect(pText(undone.state)).toBe("INSabcdef");

    history.destroy();
  });

  it("U2: undo of a prior NORMAL (non-tracked) edit survives a resolve in the same block", () => {
    // E1 is a PLAIN insertText (a normal undoable edit), then we resolve a
    // suggestion in the SAME block. The resolve must preserve E1's run identity
    // so undo() of E1 still works (NOT a silent no-op). The run E1 edits MUST be
    // structurally non-coalescing with the resolved run — else its Y.Text is
    // legitimately merged away by the post-strip coalescer (U3's gotcha). So the
    // base run carries a distinct {color} the stripped INS ({}) can never equal.
    const sPre = "s-pre" as SuggestionId;
    // Block: "INS"(insertion s-pre) + "abcdef"{color:"base"}. Stripping s-pre
    // makes INS {} — still DISTINCT from the {color:"base"} run, so no coalesce,
    // and E1's run (the colored one) keeps its Y.Text.
    const seeded = applyOperation(
      oneBlock(
        inlineContent([
          text("INS", { [INSERTION_SUGGESTION_ATTR]: sPre }),
          text("abcdef", { color: "base" }),
        ]),
      ),
      (doc) => {
        writeSuggestionRecordInTx(doc, { id: sPre, kind: "insertion", author: "alice", createdAt: 1 });
        return new Set<BlockId>([oneBlock().rootId]);
      },
    ).state;

    const history = createHistory(seeded);

    // E1: a normal plain insert into the colored run (offset 9, end) carrying the
    // SAME {color:"base"} so it merges into that run's Y.Text → "INSabcdefE1".
    history.beginEntry("command", 100);
    const editedE1 = insertText(seeded, createPosition("p" as BlockId, 9), "E1", { color: "base" });
    history.commit(editedE1, { before: null, after: null });
    const sE1 = editedE1.state;
    expect(pText(sE1)).toBe("INSabcdefE1");

    history.breakCoalescing();
    // Accept s-pre (STRIP → "INS" becomes plain {} text, stays distinct from the
    // colored run). Then undo E1.
    const resolved = acceptSuggestion(sE1, sPre);
    history.advanceState(resolved.state);
    expect(pText(resolved.state)).toBe("INSabcdefE1"); // INS now plain, E1 present

    // undo() of the plain E1 edit is a REAL revert (E1's text gone), not a
    // silent no-op — the resolve preserved E1's run identity.
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    // The #484 win: undo of the plain E1 edit is a REAL revert (E1 gone), not the
    // pre-#484 silent no-op (which left "INSabcdefE1"). Here the accept STRIPPED
    // (not dropped) INS, so it stays — undo of E1 cleanly yields "INSabcdef".
    // Pinning the exact content rules out over/under-revert; still fails pre-#484.
    expect(pText(undone.state)).toBe("INSabcdef");

    history.destroy();
  });

  it("U3: an untouched, structurally non-coalescing survivor keeps its Y.Text === across a resolve", () => {
    // Fixture (plan §T3 Step 1): three runs
    //   text("a", {insertionSuggestionId: s1}), text("b", {}), text("c", {bold:true}).
    // Accept s1 → run0 strips to {} and coalesces with run1 ("ab"{}) — run0/1
    // identity legitimately lost to the merge. Run2 ("c"{bold:true}) is
    // NON-adjacent to the rewritten pair and DISTINCT-attrs, so it cannot
    // coalesce: its Y.Text MUST be the SAME object (===) after the resolve.
    const s1 = "s1" as SuggestionId;
    let s = oneBlock(
      inlineContent([
        text("a", { [INSERTION_SUGGESTION_ATTR]: s1 }),
        text("b", {}),
        text("c", { bold: true }),
      ]),
    );
    s = applyOperation(s, (doc) => {
      writeSuggestionRecordInTx(doc, {
        id: s1,
        kind: "insertion",
        author: "alice",
        createdAt: 1,
      });
      return new Set<BlockId>([s.rootId]);
    }).state;

    // Capture the survivor "c" Y.Text BEFORE the resolve (at index 2).
    const yBefore = yItemsOfP(s);
    const cIndexBefore = indexOfText(yBefore, "c");
    expect(cIndexBefore).toBe(2);
    const survivorCText = yBefore.get(cIndexBefore).get("text") as Y.Text;

    const resolved = acceptSuggestion(s, s1).state;

    // After: "ab"{} coalesced (run0+run1) then "c"{bold}. Re-find "c" by content
    // (it shifted to index 1 post-coalesce) and assert SAME Y.Text object.
    const yAfter = yItemsOfP(resolved);
    const cIndexAfter = indexOfText(yAfter, "c");
    expect(cIndexAfter).toBe(1);
    expect(yAfter.get(cIndexAfter).get("text")).toBe(survivorCText);
  });
});

describe("#484 — resolve equivalence + index-arithmetic edge cases", () => {
  it("mixed keep / rewrite / drop decisions in ONE block stay index-aligned", () => {
    // p: "K" (plain, KEEP) + "INS"(insertion s1, accept → REWRITE-strip) + "DEL"
    // (deletion s2, accept → DROP) + "T" (plain, KEEP). Distinct colors so the
    // resolved runs don't spuriously coalesce, letting us assert each survives.
    const s1 = "mix-ins" as SuggestionId;
    const s2 = "mix-del" as SuggestionId;
    let s = oneBlock(
      inlineContent([
        text("K", { color: "k" }),
        text("INS", { color: "i", [INSERTION_SUGGESTION_ATTR]: s1 }),
        text("DEL", { color: "d", [DELETION_SUGGESTION_ATTR]: s2 }),
        text("T", { color: "t" }),
      ]),
    );
    s = applyOperation(s, (doc) => {
      writeSuggestionRecordInTx(doc, { id: s1, kind: "insertion", author: "a", createdAt: 1 });
      writeSuggestionRecordInTx(doc, { id: s2, kind: "deletion", author: "a", createdAt: 2 });
      return new Set<BlockId>([s.rootId]);
    }).state;

    // Accept s2 (DROP "DEL") — "INS" still tagged (KEEP), "K"/"T" KEEP.
    const afterDel = acceptSuggestion(s, s2).state;
    expect(pText(afterDel)).toBe("KINST");
    // Then accept s1 (REWRITE-strip "INS" → plain).
    const afterIns = acceptSuggestion(afterDel, s1).state;
    expect(pText(afterIns)).toBe("KINST");
    const ins = runWithText(afterIns, "INS");
    expect(INSERTION_SUGGESTION_ATTR in ins.attrs).toBe(false);
    expect(ins.attrs.color).toBe("i"); // live format preserved
    expect(getSuggestions(afterIns).length).toBe(0);
  });

  it("coalesce-after-strip: a strip that makes a run attrs-equal to its neighbor merges into one run", () => {
    // p: "a"{} + "b"{ins:s1} (accept → strip to {}) → "b" becomes {} === "a"{}
    // and the two coalesce into a single plain "ab" run.
    const s1 = "co-ins" as SuggestionId;
    let s = oneBlock(
      inlineContent([
        text("a", {}),
        text("b", { [INSERTION_SUGGESTION_ATTR]: s1 }),
      ]),
    );
    s = applyOperation(s, (doc) => {
      writeSuggestionRecordInTx(doc, { id: s1, kind: "insertion", author: "a", createdAt: 1 });
      return new Set<BlockId>([s.rootId]);
    }).state;

    const resolved = acceptSuggestion(s, s1).state;
    expect(pText(resolved)).toBe("ab");
    // Single merged plain run (no adjacent same-attrs runs survive normalization).
    const plainRuns = pItems(resolved).filter((it) => it.kind === "text");
    expect(plainRuns.length).toBe(1);
    expect(getSuggestions(resolved).length).toBe(0);
  });

  it("empty-block (all-drop): rejecting an insertion whose runs are the whole block leaves an empty leaf", () => {
    // p is ENTIRELY one inserted run; reject (DROP) empties the block.
    const s1 = "all-ins" as SuggestionId;
    let s = oneBlock(inlineContent([text("INS", { [INSERTION_SUGGESTION_ATTR]: s1 })]));
    s = applyOperation(s, (doc) => {
      writeSuggestionRecordInTx(doc, { id: s1, kind: "insertion", author: "a", createdAt: 1 });
      return new Set<BlockId>([s.rootId]);
    }).state;

    const resolved = rejectSuggestion(s, s1).state;
    expect(pText(resolved)).toBe(""); // block is now an empty leaf
    expect(pItems(resolved).length).toBe(0);
    expect(getSuggestions(resolved).length).toBe(0);
  });
});
