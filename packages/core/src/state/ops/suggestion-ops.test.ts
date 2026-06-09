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
import { markFormatting } from "./suggestion-ops";
import {
  getSuggestions,
  FORMATTING_SUGGESTION_ATTR,
  type SuggestionId,
} from "../suggestions";
import { createHistory } from "../history";
import { getBlock } from "../state";
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
