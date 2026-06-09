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
import { markFormatting, markDeletion, mintInsertion } from "./suggestion-ops";
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
import { applyOperation, getBlock } from "../state";
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
    const sug = suggestions[0];
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
    const sug = suggestions[0];
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
    expect(suggestions[0].id).toBe("first");
    expect(suggestions[0].range?.start).toEqual(createPosition("p" as BlockId, 0));
    expect(suggestions[0].range?.end).toEqual(createPosition("p" as BlockId, 6));
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
    const sug = suggestions[0];
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
    expect(before[0].id).toBe("ins1");
    expect(before[0].kind).toBe("insertion");
    expect(before[0].orphaned).toBe(false);

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
    expect(suggestions[0].id).toBe("first");
    expect(suggestions[0].range?.start).toEqual(createPosition("p" as BlockId, 0));
    expect(suggestions[0].range?.end).toEqual(createPosition("p" as BlockId, 6));
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
    expect(dels[0].id).toBe(DEL_SID);
    expect(dels[0].range?.start).toEqual(createPosition("p1" as BlockId, 3));
    expect(dels[0].range?.end).toEqual(createPosition("p2" as BlockId, 2));
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
    const sug = suggestions[0];
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
    expect(suggestions[0].id).toBe("first");
    expect(suggestions[0].kind).toBe("insertion");
    // Range widened to cover BOTH inserts (offsets 3..7).
    expect(suggestions[0].range?.start).toEqual(createPosition("p" as BlockId, 3));
    expect(suggestions[0].range?.end).toEqual(createPosition("p" as BlockId, 7));

    // The combined inserted text is contiguous and carries ONE id (the format
    // matches the neighbor, so planInsertText merged it into one physical run).
    const inserted = pItems(s).filter(
      (it) => it.kind === "text" && it.attrs[INSERTION_SUGGESTION_ATTR] === "first",
    );
    expect(inserted.length).toBe(1);
    if (inserted[0].kind === "text") {
      expect(inserted[0].text).toBe("XXYY");
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
    expect(suggestions[0].id).toBe("first"); // reused from the after-neighbor
    expect(suggestions[0].range?.start).toEqual(createPosition("p" as BlockId, 0));
    expect(suggestions[0].range?.end).toEqual(createPosition("p" as BlockId, 4));
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
    expect(suggestions[0].id).toBe(INS_SID);
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
