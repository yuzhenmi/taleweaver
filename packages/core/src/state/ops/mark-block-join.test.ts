/**
 * `markParagraphMarkDeletion` — the suggested ¶ DELETION op (Backspace at block-start /
 * Delete at block-end in Suggesting mode).
 *
 * A suggested join = both paragraphs stay REAL separate blocks (NO merge) PLUS a
 * `deletionSuggestionId` key on the LEFT block's OWN ¶ entry PLUS a `deletion`
 * `SuggestionRecord` — ALL in ONE tracked transaction (one undo entry). No inline item
 * is added. Resolution does the actual merge on accept / deletes the key on reject —
 * NOT this op. A ¶ that accepting would not delete (invariant I) is never keyed.
 *
 * The load-bearing properties exercised here: (1) NO structural merge (block count
 * unchanged, both still linked); (2) the tag lands on the right block and inline
 * lengths are unchanged; (3) a `deletion` record is written with the right
 * id/author/createdAt; (4) the range-index round-trips (range = end
 * of left → start of right); (5) the whole op is ONE undo unit; (6) identity no-op
 * on a ¶ accepting would keep (the flow's final ¶, a non-empty ¶ before an object).
 */
import { describe, it, expect } from "vitest";
import { markParagraphMarkDeletion } from "./merge-blocks";
import { getSuggestions, type SuggestionId } from "../suggestions";
import { acceptSuggestion } from "./suggestion-ops";
import { createHistory } from "../history";
import { getBlock } from "../state";
import type { State } from "../state";
import { inlineContentLength } from "../inline-content";
import { TEST_RESOLVER, testContainer,
  buildBlock,
  buildState,
  text,
  embed,
  inlineContent,
} from "../../test-utils/state-builders";
import type { BlockId } from "../block-id";

// Host container types the default registry lacks (file-local registry instance).
TEST_RESOLVER.register(testContainer("container"));

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const SID = "join-1" as SuggestionId;
const INPUT = { id: SID, author: "alice", createdAt: 2000 } as const;

/** doc > [ p1("abc"), p2("def") ] — two sibling paragraphs. */
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

/** The block's paragraph-break suggestion tags (read model), or undefined. */
function breakOf(s: State, id: string) {
  return getBlock(s, id as BlockId)?.breakSuggestion;
}

/** Count of blocks present in the main tree (excluding the root). */
function leafBlockIds(s: State, ids: readonly string[]): string[] {
  return ids.filter((id) => getBlock(s, id as BlockId) !== null);
}

describe("markParagraphMarkDeletion — basic join mark: no merge + deletion tag + deletion record", () => {
  it("keeps both blocks SEPARATE; second block gets the deletion tag; one deletion record; range round-trips", () => {
    const result = markParagraphMarkDeletion(twoBlocks(), "p1" as BlockId, INPUT);
    const s = result.state;

    // NO merge: both blocks still present and still SEPARATE in the chain.
    expect(leafBlockIds(s, ["p1", "p2"])).toEqual(["p1", "p2"]);
    const p1 = getBlock(s, "p1" as BlockId);
    const p2 = getBlock(s, "p2" as BlockId);
    expect(p1?.nextSiblingId).toBe("p2");
    expect(p2?.prevSiblingId).toBe("p1");
    expect(p2?.parentId).toBe(p1?.parentId);

    // p1 owns the ¶ between them: its OWN entry carries the deletion key; p2 untagged.
    expect(textOf(s, "p1")).toBe("abc");
    expect(breakOf(s, "p1")).toEqual({ deletionId: SID });
    expect(textOf(s, "p2")).toBe("def");
    expect(breakOf(s, "p2")).toBeUndefined();
    expect(result.removedBoundary).toBeNull();

    // Exactly ONE deletion record, with the right id/author/createdAt.
    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    const sug = nth(suggestions, 0, "suggestion");
    expect(sug.id).toBe(SID);
    expect(sug.kind).toBe("deletion");
    expect(sug.author).toBe("alice");
    expect(sug.createdAt).toBe(2000);
    // Range-index round-trip: the boundary tag surfaces the suggestion's RANGE
    // (end of p1 → start of p2). A wrong tag key would silently report
    // no range (the record would not be surfaced at all).
    expect(sug.range).toEqual({
      start: { blockId: "p1", offset: 3 },
      end: { blockId: "p2", offset: 0 },
    });
  });
});

describe("markParagraphMarkDeletion — offset invariant: no inline item is added", () => {
  it("both blocks' inline lengths are unchanged; no embed anywhere", () => {
    const s = markParagraphMarkDeletion(twoBlocks(), "p1" as BlockId, INPUT).state;

    const nContent = getBlock(s, "p1" as BlockId)?.inlineContent;
    if (nContent == null) throw new Error("expected block N inlineContent");
    expect(inlineContentLength(nContent)).toBe(3);
    const rContent = getBlock(s, "p2" as BlockId)?.inlineContent;
    if (rContent == null) throw new Error("expected block 2 inlineContent");
    expect(inlineContentLength(rContent)).toBe(3);
    expect([...nContent.items, ...rContent.items].some((it) => it.kind === "embed")).toBe(false);
  });
});

describe("markParagraphMarkDeletion — ONE undo entry (tag + record are one transaction)", () => {
  it("a single undo reverts the WHOLE op back to clean abc|def, no tag, no record", () => {
    const s0 = twoBlocks();
    const history = createHistory(s0);

    history.beginEntry("command", 0);
    const join = markParagraphMarkDeletion(s0, "p1" as BlockId, INPUT);
    history.commit(join, { before: null, after: null });
    const s1 = join.state;

    // Post-op: key on ¶p1, one record.
    expect(getSuggestions(s1).length).toBe(1);
    expect(breakOf(s1, "p1")).toEqual({ deletionId: SID });

    // ONE undo reverts everything.
    const undone = history.undo();
    if (undone === null) throw new Error("expected undo to return a result");
    const s2 = undone.state;
    // Back to clean "abc" | "def".
    expect(textOf(s2, "p1")).toBe("abc");
    expect(textOf(s2, "p2")).toBe("def");
    // No key anywhere.
    expect(breakOf(s2, "p1")).toBeUndefined();
    // No record.
    expect(getSuggestions(s2).length).toBe(0);

    history.destroy();
  });
});

describe("markParagraphMarkDeletion — no-op on a ¶ accepting would keep", () => {
  it("the flow's FINAL ¶ is an identity no-op: same state ref, no record, no tag", () => {
    const state = twoBlocks();
    // ¶p2 is the flow's last unit (I2): never deleted, so never keyed.
    const result = markParagraphMarkDeletion(state, "p2" as BlockId, INPUT);

    // Identity: the input State reference is returned unchanged.
    expect(result.state).toBe(state);
    // No suggestion record written.
    expect(getSuggestions(result.state).length).toBe(0);
    // No tag anywhere.
    expect(breakOf(result.state, "p1")).toBeUndefined();
    expect(breakOf(result.state, "p2")).toBeUndefined();
  });

  it("marking a MISSING block is an identity no-op", () => {
    const state = twoBlocks();
    const result = markParagraphMarkDeletion(state, "nope" as BlockId, INPUT);
    expect(result.state).toBe(state);
    expect(getSuggestions(result.state).length).toBe(0);
  });

  /** doc → [p (text), container c, after]; ¶p is the unit before the container. */
  function beforeContainer(pText: string): State {
    return buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "after" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "c", inlineContent: inlineContent(pText === "" ? [] : [text(pText)]) }),
        buildBlock({ id: "c", type: "container", parentId: "doc", prevSiblingId: "p", nextSiblingId: "after", firstChildId: "cc", lastChildId: "cc" }),
        buildBlock({ id: "cc", type: "paragraph", parentId: "c", inlineContent: inlineContent([text("x")]) }),
        buildBlock({ id: "after", type: "paragraph", parentId: "doc", prevSiblingId: "c", inlineContent: inlineContent([]) }),
      ],
    });
  }

  it("a NON-empty ¶ before a container is never keyed (accepting would keep it: the final-projection check)", () => {
    const state = beforeContainer("def");
    const result = markParagraphMarkDeletion(state, "p" as BlockId, INPUT);
    expect(result.state).toBe(state);
    expect(getSuggestions(result.state).length).toBe(0);
  });

  it("an EMPTY ¶ before a container is a tracked ¶ deletion; accept removes the paragraph", () => {
    const result = markParagraphMarkDeletion(beforeContainer(""), "p" as BlockId, INPUT);
    expect(breakOf(result.state, "p")).toEqual({ deletionId: SID });
    expect(nth(getSuggestions(result.state), 0, "suggestion").range).toEqual({ start: { blockId: "p", offset: 0 }, end: { blockId: "p", offset: 0 } });
    const accepted = acceptSuggestion(result.state, SID).state;
    expect(getBlock(accepted, "p" as BlockId)).toBeNull();
    expect(getSuggestions(accepted).length).toBe(0);
  });

  it("the flow's final ¶ right after a container is never keyed (I2)", () => {
    const state = beforeContainer("def");
    expect(markParagraphMarkDeletion(state, "after" as BlockId, INPUT).state).toBe(state);
  });

  it("leaves an existing trailing embed on block N untouched (the key goes on N's own ¶ entry)", () => {
    // Block N already ends in some other (non-suggestion) embed; the join is a key on
    // ¶p1's entry, so N's items are unchanged.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p2",
          inlineContent: inlineContent([text("ab"), embed("tab")]),
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
    const result = markParagraphMarkDeletion(state, "p1" as BlockId, INPUT);
    const items = itemsOf(result.state, "p1");
    // "ab"(text) + tab embed — unchanged.
    expect(items.length).toBe(2);
    expect(nth(items, 1, "tab").kind).toBe("embed");
    expect(breakOf(result.state, "p1")).toEqual({ deletionId: SID });
  });
});

describe("markParagraphMarkDeletion — multi-block: key the ¶ between p2 and p3", () => {
  it("the key lands on ¶p2 (its own entry); p1/p3 untouched; one deletion record", () => {
    // doc > [ p1("one"), p2("two"), p3("three") ]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p2",
          inlineContent: inlineContent([text("one")]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          nextSiblingId: "p3",
          inlineContent: inlineContent([text("two")]),
        }),
        buildBlock({
          id: "p3",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p2",
          inlineContent: inlineContent([text("three")]),
        }),
      ],
    });

    const s = markParagraphMarkDeletion(state, "p2" as BlockId, INPUT).state;

    // The key lands on ¶p2, NOT p1 or p3.
    expect(breakOf(s, "p2")).toEqual({ deletionId: SID });
    expect(breakOf(s, "p1")).toBeUndefined();
    expect(breakOf(s, "p3")).toBeUndefined();
    expect(textOf(s, "p1")).toBe("one");
    expect(textOf(s, "p2")).toBe("two");
    expect(textOf(s, "p3")).toBe("three");

    // No merge: all three blocks present and linked.
    expect(leafBlockIds(s, ["p1", "p2", "p3"])).toEqual(["p1", "p2", "p3"]);

    // One deletion record.
    const suggestions = getSuggestions(s);
    expect(suggestions.length).toBe(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("deletion");
    expect(nth(suggestions, 0, "suggestion").id).toBe(SID);
  });
});
