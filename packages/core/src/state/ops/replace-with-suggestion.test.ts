/**
 * Change-tracking slice 4d-state — `replaceWithSuggestion`, the "type over a
 * selection in Suggesting mode" composite op (the suggestion analog of
 * `replaceRange`). It SOFT-DELETES the selection AND inserts new text at the
 * selection start, in ONE tracked `applyOperation` transaction — so the strike,
 * the insert, and BOTH records (an insertion + a deletion) land as ONE undo entry.
 *
 * The load-bearing properties exercised here: (1) the inserted run lands at the
 * selection start carrying `insertionSuggestionId`, BEFORE the struck selection
 * text (which carries `deletionSuggestionId`); (2) the two records share
 * `createdAt` (the render-layer "replace" grouping signal); (3) the strike +
 * insert are atomic (a single undo reverts BOTH); (4) each half coalesces
 * independently into an adjacent same-author suggestion; (5) accept/reject the
 * pair resolves end-to-end; (6) the degenerate branches delegate to the pure
 * markDeletion / mintInsertion ops.
 */
import { describe, it, expect } from "vitest";
import {
  replaceWithSuggestion,
  markDeletion,
  acceptSuggestion,
  rejectSuggestion,
} from "./suggestion-ops";
import {
  getSuggestions,
  writeSuggestionRecordInTx,
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
  inlineContent,
} from "../../test-utils/state-builders";
import type { State } from "../state";
import type { InlineContent } from "../inline-content";

const DEL_ID = "del1" as SuggestionId;
const INS_ID = "ins1" as SuggestionId;
const CREATED_AT = 9000;
const INPUT = {
  deletionId: DEL_ID,
  insertionId: INS_ID,
  author: "alice",
  createdAt: CREATED_AT,
} as const;

/** doc > [ p("abcdef") ] (one text run unless overridden). */
function oneBlock(items = inlineContent([text("abcdef")])): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: items }),
    ],
  });
}

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

/** A span over [start, end) in block p. */
function span(start: number, end: number): Span {
  return createSpan(createPosition("p" as BlockId, start), createPosition("p" as BlockId, end));
}

/** The inline items of an arbitrary block by id. */
function itemsOf(s: State, id: string) {
  return getBlock(s, id as BlockId)?.inlineContent?.items ?? [];
}

/** The inline items of p. */
function pItems(s: State) {
  return itemsOf(s, "p");
}

/** Concatenated text of all text items of a block, in order. */
function textOf(s: State, id: string): string {
  return itemsOf(s, id)
    .filter((it): it is Extract<typeof it, { kind: "text" }> => it.kind === "text")
    .map((it) => it.text)
    .join("");
}

/** Concatenated text of all text items of p, in order. */
function pText(s: State): string {
  return textOf(s, "p");
}

/** The first text run of a block whose attrs carry `attrKey` (the suggestion-id attr). */
function findTagged(s: State, id: string, attrKey: string) {
  return itemsOf(s, id).find(
    (it) => it.kind === "text" && it.attrs[attrKey] !== undefined,
  );
}

/**
 * Seed an insertion `SuggestionRecord` (id `insId`, by `author`) into the
 * suggestions map. The run carrying the matching `insertionSuggestionId` attr is
 * built into the fixture separately.
 */
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

/**
 * Seed a deletion `SuggestionRecord` (id `delId`, by `author`) into the
 * suggestions map. The run carrying the matching `deletionSuggestionId` attr is
 * built into the fixture separately.
 */
function seedDeletionRecord(state: State, delId: string, author: string): State {
  const record: SuggestionRecord = {
    id: delId as SuggestionId,
    kind: "deletion",
    author,
    createdAt: 100,
  };
  return applyOperation(state, (doc) => {
    writeSuggestionRecordInTx(doc, record);
    return new Set<BlockId>([state.rootId]);
  }).state;
}

describe("replaceWithSuggestion — single-block type-over (strike + insert in ONE op)", () => {
  it("inserts the new run (tagged insertion) BEFORE the struck selection (tagged deletion); both records, shared createdAt", () => {
    // p("abcdef"), select "bcd" (offsets 1..4), type "X".
    const s = replaceWithSuggestion(oneBlock(), span(1, 4), "X", {}, INPUT).state;

    // The struck text STAYS (soft-delete); "X" lands at offset 1, before "bcd".
    expect(pText(s)).toBe("aXbcdef");

    // The "X" run carries the insertion id (and is NOT a deletion).
    const xRun = pItems(s).find((it) => it.kind === "text" && it.text === "X");
    if (xRun?.kind !== "text") throw new Error("expected the inserted X run");
    expect(xRun.attrs[INSERTION_SUGGESTION_ATTR]).toBe(INS_ID);
    expect(DELETION_SUGGESTION_ATTR in xRun.attrs).toBe(false);

    // The "bcd" run carries the deletion id (and is NOT an insertion).
    const bcd = pItems(s).find((it) => it.kind === "text" && it.text === "bcd");
    if (bcd?.kind !== "text") throw new Error("expected the struck bcd run");
    expect(bcd.attrs[DELETION_SUGGESTION_ATTR]).toBe(DEL_ID);
    expect(INSERTION_SUGGESTION_ATTR in bcd.attrs).toBe(false);

    // Exactly TWO records — one insertion + one deletion, same author, SAME createdAt.
    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(2);
    const ins = suggestions.find((x) => x.kind === "insertion");
    const del = suggestions.find((x) => x.kind === "deletion");
    expect(ins?.id).toBe(INS_ID);
    expect(del?.id).toBe(DEL_ID);
    expect(ins?.author).toBe("alice");
    expect(del?.author).toBe("alice");
    expect(ins?.createdAt).toBe(CREATED_AT);
    expect(del?.createdAt).toBe(CREATED_AT);
  });

  it("carries the intended live format onto the inserted run; resolved id overwrites a stale insertionSuggestionId", () => {
    const s = replaceWithSuggestion(
      oneBlock(),
      span(1, 4),
      "X",
      { bold: true, [INSERTION_SUGGESTION_ATTR]: "stale" } as ReadonlyAttrs,
      INPUT,
    ).state;
    const xRun = pItems(s).find((it) => it.kind === "text" && it.text === "X");
    if (xRun?.kind !== "text") throw new Error("expected the inserted X run");
    expect(xRun.attrs.bold).toBe(true);
    expect(xRun.attrs[INSERTION_SUGGESTION_ATTR]).toBe(INS_ID);
  });
});

describe("replaceWithSuggestion — multi-block type-over", () => {
  it("inserts at the start of p1; strikes the tail of p1 + head of p2; one insertion + one deletion record", () => {
    // p1="hello", p2="world". Select from p1 offset 3 ("lo") through p2 offset 2
    // ("wo"), type "X".
    const s = replaceWithSuggestion(
      twoBlocks(inlineContent([text("hello")]), inlineContent([text("world")])),
      createSpan(createPosition("p1" as BlockId, 3), createPosition("p2" as BlockId, 2)),
      "X",
      {},
      INPUT,
    ).state;

    // p1: unstruck prefix "hel" + "X"(insertion) + struck tail "lo".
    expect(textOf(s, "p1")).toBe("helXlo");
    const p1x = itemsOf(s, "p1").find((it) => it.kind === "text" && it.text === "X");
    if (p1x?.kind !== "text") throw new Error("expected the inserted X run in p1");
    expect(p1x.attrs[INSERTION_SUGGESTION_ATTR]).toBe(INS_ID);
    const p1struck = itemsOf(s, "p1").find((it) => it.kind === "text" && it.text === "lo");
    if (p1struck?.kind !== "text") throw new Error("expected the struck lo run in p1");
    expect(p1struck.attrs[DELETION_SUGGESTION_ATTR]).toBe(DEL_ID);

    // p2: struck head "wo" + unstruck suffix "rld".
    expect(textOf(s, "p2")).toBe("world");
    const p2struck = itemsOf(s, "p2").find((it) => it.kind === "text" && it.text === "wo");
    if (p2struck?.kind !== "text") throw new Error("expected the struck wo run in p2");
    expect(p2struck.attrs[DELETION_SUGGESTION_ATTR]).toBe(DEL_ID);

    // Exactly one insertion + one deletion.
    const suggestions = getSuggestions(s);
    expect(suggestions.filter((x) => x.kind === "insertion").length).toBe(1);
    expect(suggestions.filter((x) => x.kind === "deletion").length).toBe(1);
  });
});

describe("replaceWithSuggestion — insertion coalescing", () => {
  it("reuses an adjacent same-author insertion id for the new run; writes NO new insertion record (deletion record IS written)", () => {
    // "ab" + own-insertion "YY" (alice, preIns) + "cdef". Select "cd" (offsets
    // 4..6, right after the insertion run) and type "X". The inserted "X" sits at
    // offset 4 — immediately AFTER the "YY" insertion run — so it coalesces into
    // preIns rather than minting INS_ID.
    let s = oneBlock(
      inlineContent([
        text("ab"),
        text("YY", { [INSERTION_SUGGESTION_ATTR]: "preIns" }),
        text("cdef"),
      ]),
    );
    s = seedInsertionRecord(s, "preIns", "alice");

    s = replaceWithSuggestion(s, span(4, 6), "X", {}, INPUT).state;

    // The inserted "X" reuses preIns (NOT INS_ID). Same id + same (empty) live
    // format as the adjacent "YY" run, so mergeAdjacentTextItems folds it into one
    // physical run "YYX" carrying preIns — find it by the insertion id + text.
    const insRun = pItems(s).find(
      (it) => it.kind === "text" && it.attrs[INSERTION_SUGGESTION_ATTR] === "preIns",
    );
    if (insRun?.kind !== "text") throw new Error("expected the coalesced insertion run");
    expect(insRun.attrs[INSERTION_SUGGESTION_ATTR]).toBe("preIns");
    expect(insRun.text).toBe("YYX");

    // Records: the original preIns insertion (reused, no new INS_ID minted) + the
    // new deletion. No record with id INS_ID exists.
    const suggestions = getSuggestions(s);
    expect(suggestions.some((x) => x.id === INS_ID)).toBe(false);
    expect(suggestions.filter((x) => x.kind === "insertion").length).toBe(1);
    expect(suggestions.find((x) => x.kind === "insertion")?.id).toBe("preIns");
    const del = suggestions.find((x) => x.kind === "deletion");
    expect(del?.id).toBe(DEL_ID);
    expect(del?.createdAt).toBe(CREATED_AT);
  });
});

describe("replaceWithSuggestion — deletion coalescing", () => {
  it("reuses an adjacent same-author deletion id for the struck span; writes NO new deletion record", () => {
    // own-deletion "ab" (alice, preDel) + "cdef". Select "cd" (offsets 2..4),
    // type "X". The struck "cd" is immediately AFTER the existing deletion run, so
    // it coalesces into preDel rather than minting DEL_ID.
    let s = oneBlock(
      inlineContent([
        text("ab", { [DELETION_SUGGESTION_ATTR]: "preDel" }),
        text("cdef"),
      ]),
    );
    s = seedDeletionRecord(s, "preDel", "alice");

    s = replaceWithSuggestion(s, span(2, 4), "X", {}, INPUT).state;

    // The struck "cd" reuses preDel (NOT DEL_ID).
    const cd = pItems(s).find((it) => it.kind === "text" && it.text === "cd");
    if (cd?.kind !== "text") throw new Error("expected the struck cd run");
    expect(cd.attrs[DELETION_SUGGESTION_ATTR]).toBe("preDel");

    // Records: the original preDel deletion (reused) + the new insertion. No
    // record with id DEL_ID exists.
    const suggestions = getSuggestions(s);
    expect(suggestions.some((x) => x.id === DEL_ID)).toBe(false);
    expect(suggestions.filter((x) => x.kind === "deletion").length).toBe(1);
    expect(suggestions.find((x) => x.kind === "deletion")?.id).toBe("preDel");
    expect(suggestions.find((x) => x.kind === "insertion")?.id).toBe(INS_ID);
  });
});

describe("replaceWithSuggestion — accept the pair end-to-end", () => {
  it("accept insertion → X becomes plain; accept deletion → bcd removed for real ⇒ aXef", () => {
    const replaced = replaceWithSuggestion(oneBlock(), span(1, 4), "X", {}, INPUT).state;
    expect(pText(replaced)).toBe("aXbcdef");

    // Accept the insertion: "X" becomes plain text (no insertion id). Stripped of
    // its provenance id it re-merges with the plain "a" into "aX"; the deletion-
    // tagged "bcd" keeps it from merging further. Text is fully preserved, and NO
    // insertion id survives anywhere.
    const afterIns = acceptSuggestion(replaced, INS_ID).state;
    expect(pText(afterIns)).toBe("aXbcdef");
    for (const it of pItems(afterIns)) {
      if (it.kind === "text") expect(INSERTION_SUGGESTION_ATTR in it.attrs).toBe(false);
    }

    // Accept the deletion: "bcd" is removed for real ⇒ "aXef".
    const afterDel = acceptSuggestion(afterIns, DEL_ID).state;
    expect(pText(afterDel)).toBe("aXef");
    expect(getSuggestions(afterDel).length).toBe(0);
  });
});

describe("replaceWithSuggestion — reject the pair end-to-end", () => {
  it("reject insertion → X removed; reject deletion → bcd kept as plain text ⇒ original abcdef", () => {
    const replaced = replaceWithSuggestion(oneBlock(), span(1, 4), "X", {}, INPUT).state;

    // Reject the insertion: "X" is removed (never landed).
    const afterIns = rejectSuggestion(replaced, INS_ID).state;
    expect(pText(afterIns)).toBe("abcdef");
    expect(pItems(afterIns).some((it) => it.kind === "text" && it.text === "X")).toBe(false);

    // Reject the deletion: "bcd" stays as plain text (deletion id stripped).
    const afterDel = rejectSuggestion(afterIns, DEL_ID).state;
    expect(pText(afterDel)).toBe("abcdef");
    for (const it of pItems(afterDel)) {
      if (it.kind === "text") expect(DELETION_SUGGESTION_ATTR in it.attrs).toBe(false);
    }
    expect(getSuggestions(afterDel).length).toBe(0);
  });
});

describe("replaceWithSuggestion — atomicity (ONE undo unit)", () => {
  it("a single undo reverts BOTH the strike and the insert; the doc returns to abcdef with zero suggestions", () => {
    const s0 = oneBlock();
    const history = createHistory(s0);

    history.beginEntry("command", 0);
    const replaced = replaceWithSuggestion(s0, span(1, 4), "X", {}, INPUT);
    history.commit(replaced, { before: null, after: null });
    const s1 = replaced.state;
    expect(pText(s1)).toBe("aXbcdef");
    expect(getSuggestions(s1).length).toBe(2);

    // ONE undo reverts the entire composite (strike + insert + both records).
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const s2 = undone.state;
    expect(pText(s2)).toBe("abcdef");
    expect(getSuggestions(s2).length).toBe(0);
    // No second undo step exists (the composite was ONE entry).
    expect(history.canUndo()).toBe(false);

    // Redo restores everything in one step.
    const redone = history.redo();
    if (redone === null) throw new Error("expected redo to return a result");
    const s3 = redone.state;
    expect(pText(s3)).toBe("aXbcdef");
    expect(getSuggestions(s3).length).toBe(2);

    history.destroy();
  });
});

describe("replaceWithSuggestion — degenerate delegation", () => {
  it("empty text behaves as a pure markDeletion (no insertion record)", () => {
    const s = replaceWithSuggestion(oneBlock(), span(1, 4), "", {}, INPUT).state;
    // Text preserved (soft-delete), "bcd" tagged with the deletion id.
    expect(pText(s)).toBe("abcdef");
    const bcd = findTagged(s, "p", DELETION_SUGGESTION_ATTR);
    if (bcd?.kind !== "text") throw new Error("expected the struck bcd run");
    expect(bcd.attrs[DELETION_SUGGESTION_ATTR]).toBe(DEL_ID);
    // Exactly one record: the deletion. No insertion.
    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].kind).toBe("deletion");
    expect(suggestions[0].id).toBe(DEL_ID);

    // Equivalence with a direct markDeletion (same observable result).
    const direct = markDeletion(oneBlock(), span(1, 4), {
      id: DEL_ID,
      author: "alice",
      createdAt: CREATED_AT,
    }).state;
    expect(pText(direct)).toBe(pText(s));
  });

  it("a collapsed span behaves as a pure mintInsertion (no deletion record)", () => {
    const s = replaceWithSuggestion(oneBlock(), span(3, 3), "XY", {}, INPUT).state;
    // "XY" inserted at offset 3 → "abcXYdef", tagged with the insertion id.
    expect(pText(s)).toBe("abcXYdef");
    const xy = pItems(s).find((it) => it.kind === "text" && it.text === "XY");
    if (xy?.kind !== "text") throw new Error("expected the inserted XY run");
    expect(xy.attrs[INSERTION_SUGGESTION_ATTR]).toBe(INS_ID);
    // Exactly one record: the insertion. No deletion.
    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].kind).toBe("insertion");
    expect(suggestions[0].id).toBe(INS_ID);
  });
});
