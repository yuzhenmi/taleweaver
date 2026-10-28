/**
 * `replaceWithSuggestedFragment` (#493) — every write is an offset write on the
 * blocks' inline `Y.Text` (strike = format / own-insertion delete; line inserts;
 * replace-tail truncation); crossed / new-line boundaries are block tags, not items.
 *
 * Oracle: `planReplaceWithSuggestedFragment().writes[k].items` — the pure per-block
 * content the op must produce. The applied op's per-block serialized content MUST
 * equal it, block-for-block.
 *
 * Survival: characters the edit leaves in place (B's untouched prefix, E's plain
 * tail, struck runs) keep their CRDT identity across the op.
 */
import { describe, it, expect } from "vitest";
import {
  replaceWithSuggestedFragment,
  planReplaceWithSuggestedFragment,
  acceptAll,
  rejectAll,
  type ReplaceSuggestionInput,
} from "./suggestion-ops";
import { type SuggestionId } from "../suggestions";
import { resolveBlock, type State } from "../state";
import { relAt, survives } from "../../test-utils/relpos-survival";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "../../test-utils/state-builders";
import { createPosition, createSpan } from "../block-position";
import { asBlockId, createTestAllocator } from "../block-id";
import type { SiblingBlockInit } from "./insert-blocks-after";
import type { BlockId } from "../block-id";
import type { InlineContent, InlineItem } from "../inline-content";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const REPL = (d: string, i: string): ReplaceSuggestionInput => ({
  deletionId: d as SuggestionId,
  insertionId: i as SuggestionId,
  author: "alice",
  createdAt: 1,
});

/** doc > [ B | I1 | I2 | E ] — four sibling paragraphs with the given inline content. */
function fourBlocks(
  b: InlineContent,
  i1: InlineContent,
  i2: InlineContent,
  e: InlineContent,
): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "B", lastChildId: "E" }),
      buildBlock({ id: "B", type: "paragraph", parentId: "doc", nextSiblingId: "I1", inlineContent: b }),
      buildBlock({ id: "I1", type: "paragraph", parentId: "doc", prevSiblingId: "B", nextSiblingId: "I2", inlineContent: i1 }),
      buildBlock({ id: "I2", type: "paragraph", parentId: "doc", prevSiblingId: "I1", nextSiblingId: "E", inlineContent: i2 }),
      buildBlock({ id: "E", type: "paragraph", parentId: "doc", prevSiblingId: "I2", inlineContent: e }),
    ],
  });
}

/** Serialize a block's inline content to a stable plain shape for equality. */
function serializeBlock(st: State, id: string): unknown {
  const items = resolveBlock(st, asBlockId(id))?.block.inlineContent?.items ?? [];
  return items.map((it) =>
    it.kind === "text"
      ? { kind: "text", text: it.text, attrs: it.attrs }
      : { kind: "embed", embedType: it.embedType, attrs: it.attrs, properties: it.properties },
  );
}

const blockSeq = (st: State): string[] => {
  const out: string[] = [];
  let id = resolveBlock(st, finalSectionOf(st))?.block.firstChildId ?? null;
  while (id) {
    out.push(id);
    id = resolveBlock(st, id)?.block.nextSiblingId ?? null;
  }
  return out;
};

/** A character anchor at the FIRST char of the `index`-th item of block `id`. */
interface CharAnchor {
  readonly rel: ReturnType<typeof relAt>;
  readonly ch: string;
}
function yTextAt(st: State, id: string, index: number): CharAnchor {
  const items = resolveBlock(st, id as BlockId)?.block.inlineContent?.items ?? [];
  let offset = 0;
  for (let k = 0; k < index; k++) {
    const it = items[k];
    offset += it === undefined ? 0 : it.kind === "text" ? it.text.length : 1;
  }
  const item = items[index];
  if (item === undefined || item.kind !== "text") throw new Error(`no text item ${index} in ${id}`);
  return { rel: relAt(st, id, offset), ch: item.text.charAt(0) };
}
/** True iff the anchored character survived (same CRDT item, still live). */
function kept(a: CharAnchor, st: State): boolean {
  return survives(a.rel, st, a.ch);
}

// E has TWO distinct-attrs runs: "fg"{f} struck whole + "hi"{h} a wholly-untouched
// plain tail whose characters we pin. The span ends at E offset 2 (the f|h
// boundary) so the strike covers exactly the "fg" run; "hi" is never touched.
// B has TWO distinct-attrs runs: "a"{x} a wholly-untouched prefix whose characters we
// pin, then "bc"{y} struck whole. The span starts at the a|bc boundary (B offset 1)
// so the strike covers exactly "bc"; "a" is never touched (a single run "abc" split
// at offset 1 would instead REBUILD the "a" prefix — the inherent straddler loss).
const B = () => inlineContent([text("a", { x: 1 }), text("bc", { y: 1 })]);
const I1 = () => inlineContent([text("iii", { x: 1 })]);
const I2 = () => inlineContent([text("jjj", { x: 1 })]);
const E = () => inlineContent([text("fg", { f: 1 }), text("hi", { h: 1 })]);
// span: B[1..] .. E[..2] — strikes B's tail "bc", all of I1+I2, E's head "fg".
const span = () => createSpan(createPosition(asBlockId("B"), 1), createPosition(asBlockId("E"), 2));

describe("replaceWithSuggestedFragment — S2 surgical interveners + E + n===0 B", () => {
  it("cross-block multi-intervener n>1: per-block content === old full-replace AND E's plain-tail run keeps its characters", () => {
    const fragment: SiblingBlockInit[] = [
      { type: "paragraph", inlineContent: inlineContent([text("X")]) },
      { type: "paragraph", inlineContent: inlineContent([text("Y")]) },
    ];

    // Surgical run — anchor E's plain-tail characters BEFORE the op.
    const state = fourBlocks(B(), I1(), I2(), E());
    const eTailBefore = yTextAt(state, "E", 1);

    const r = replaceWithSuggestedFragment(state, span(), fragment, REPL("d", "i"), createTestAllocator());

    // (a) Equivalence vs the expected full-replace content (interveners + E + B).
    //     Expected B = "a" plain + "bc" struck (deletion d) + line0 "X"{ins} +
    //     (the split is a tag on the new block); I1/I2 = struck whole (join-tagged);
    //     E = "fg" struck + "hi" plain (join-tagged).
    //     We compare the INTERVENER + E blocks (the S2-surgical ones) against a hand-
    //     derived oracle built from the SAME plan's writes via full-replace below.
    expect(serializeBlock(r.state, "I1")).toEqual(oracleBlock(span(), fragment, "I1"));
    expect(serializeBlock(r.state, "I2")).toEqual(oracleBlock(span(), fragment, "I2"));
    expect(serializeBlock(r.state, "E")).toEqual(oracleBlock(span(), fragment, "E"));

    // (b) E's plain-tail "hi" characters survive the op.
    expect(kept(eTailBefore, r.state)).toBe(true);
  });

  it("n===0 cross-block (pure strike): per-block content === old full-replace AND E's plain-tail keeps identity", () => {
    const state = fourBlocks(B(), I1(), I2(), E());
    const eTailBefore = yTextAt(state, "E", 1);
    const bPrefixBefore = yTextAt(state, "B", 0); // B's untouched [0:c) prefix run

    const r = replaceWithSuggestedFragment(state, span(), [], REPL("d", "i"), createTestAllocator());

    // No new blocks — pure strike. B..E all surgical (B too, in the n===0 branch).
    expect(blockSeq(r.state).length).toBe(4);
    for (const id of ["B", "I1", "I2", "E"]) {
      expect(serializeBlock(r.state, id)).toEqual(oracleBlock(span(), [], id));
    }
    // The surgical strike preserves the characters of BOTH untouched runs:
    // B's prefix and E's plain tail.
    expect(kept(bPrefixBefore, r.state)).toBe(true);
    expect(kept(eTailBefore, r.state)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// S3: START block B surgical for n===1 (single fragment line). The applier strikes
// B's [rangeStart,rangeEnd) in place, then split-inserts line0 at offset c, then
// appends the cross-block JOIN embed — preserving every untouched character.
// ────────────────────────────────────────────────────────────────────────────

/** doc > [ P ] — a single paragraph block, for within-block n===1 cases. */
function oneBlock(p: InlineContent): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "B", lastChildId: "B" }),
      buildBlock({ id: "B", type: "paragraph", parentId: "doc", inlineContent: p }),
    ],
  });
}

/**
 * Re-plan `replaceWithSuggestedFragment` on a FRESH copy of `mkState()` and serialize
 * the matching block write's full-replace `items` — the identity-independent oracle
 * for an arbitrary fixture (generalizes {@link oracleBlock}).
 */
function oracleForState(
  mkState: () => State,
  span: ReturnType<typeof createSpan>,
  fragment: readonly SiblingBlockInit[],
  blockId: string,
): unknown {
  const plan = planReplaceWithSuggestedFragment(
    mkState(),
    span,
    fragment,
    REPL("d", "i"),
    createTestAllocator(),
  );
  const write = plan.writes.find((w) => w.blockId === asBlockId(blockId));
  if (write === undefined) throw new Error(`oracleForState: no write for "${blockId}"`);
  return serializeItems(write.items);
}


describe("replaceWithSuggestedFragment — S3 surgical START block for n===1", () => {
  it("single-block n===1 with a strike (type-over within B): content === oracle AND B's untouched prefix run keeps its characters", () => {
    // B = "a"{x} | "bcd"{y}. Span strikes "bc" (offset 1..3, inside "bcd").
    const mk = () => oneBlock(inlineContent([text("a", { x: 1 }), text("bcd", { y: 1 })]));
    const span = createSpan(createPosition(asBlockId("B"), 1), createPosition(asBlockId("B"), 3));
    const fragment: SiblingBlockInit[] = [
      { type: "paragraph", inlineContent: inlineContent([text("Z")]) },
    ];

    const state = mk();
    const bPrefixBefore = yTextAt(state, "B", 0); // the "a"{x} run, untouched (whole)

    const r = replaceWithSuggestedFragment(state, span, fragment, REPL("d", "i"), createTestAllocator());

    expect(serializeBlock(r.state, "B")).toEqual(oracleForState(mk, span, fragment, "B"));
    // The "a"{x} prefix run is whole + untouched (offset 1 = a|bcd boundary) → kept ===.
    expect(kept(bPrefixBefore, r.state)).toBe(true);
  });

  it("PF-1 (collapsed span, no strike, pure insert at run boundary): content === oracle AND BOTH adjacent runs keep their characters", () => {
    // B = "a"{x} | "bb"{y}. Collapsed span at the a|bb boundary (offset 1) → no strike.
    const mk = () => oneBlock(inlineContent([text("a", { x: 1 }), text("bb", { y: 1 })]));
    const span = createSpan(createPosition(asBlockId("B"), 1), createPosition(asBlockId("B"), 1));
    const fragment: SiblingBlockInit[] = [
      { type: "paragraph", inlineContent: inlineContent([text("Z")]) },
    ];

    const state = mk();
    const aBefore = yTextAt(state, "B", 0); // "a"{x}
    const bbBefore = yTextAt(state, "B", 1); // "bb"{y}

    const r = replaceWithSuggestedFragment(state, span, fragment, REPL("d", "i"), createTestAllocator());

    expect(serializeBlock(r.state, "B")).toEqual(oracleForState(mk, span, fragment, "B"));
    // c=1 is a run boundary → neither run splits → both runs' characters preserved.
    expect(kept(aBefore, r.state)).toBe(true);
    expect(kept(bbBefore, r.state)).toBe(true);
  });

  it("cross-block n===1: per-block content === oracle AND B's prefix run + E's tail run keep their characters", () => {
    const fragment: SiblingBlockInit[] = [
      { type: "paragraph", inlineContent: inlineContent([text("Z")]) },
    ];

    const state = fourBlocks(B(), I1(), I2(), E());
    const bPrefixBefore = yTextAt(state, "B", 0); // "a"{x} — B's untouched prefix
    const eTailBefore = yTextAt(state, "E", 1); // "hi"{h} — E's untouched plain tail

    const r = replaceWithSuggestedFragment(state, span(), fragment, REPL("d", "i"), createTestAllocator());

    for (const id of ["B", "I1", "I2", "E"]) {
      expect(serializeBlock(r.state, id)).toEqual(oracleBlock(span(), fragment, id));
    }
    // The load-bearing regression: B is now surgical for cross-block n===1, so B's
    // "a"{x} prefix survives.
    expect(kept(bPrefixBefore, r.state)).toBe(true);
    expect(kept(eTailBefore, r.state)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// S4: START block B surgical for n>1 (multi-line fragment). B is TRUNCATED via a
// `replace-tail` (keep [0:c], drop the rest, append line0); B's struck
// tail RELOCATES BY VALUE into the LAST new block. B is NOT struck
// in place (Q1 — striking would desync the replace-tail indices computed vs the
// ORIGINAL items). This was the SOLE remaining full-replace caller; after S4 B is
// surgical for ALL n and `writeBlockInlineContentInTx` has zero callers.
// ────────────────────────────────────────────────────────────────────────────

/** doc > [ B | T ] — B then a trailing sibling, so n>1 relocation has a place. */
function twoBlocks(b: InlineContent, t: InlineContent): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "B", lastChildId: "T" }),
      buildBlock({ id: "B", type: "paragraph", parentId: "doc", nextSiblingId: "T", inlineContent: b }),
      buildBlock({ id: "T", type: "paragraph", parentId: "doc", prevSiblingId: "B", inlineContent: t }),
    ],
  });
}

/**
 * Re-plan on a FRESH copy of `mkState()` and serialize the matching `plan.newBlocks`
 * entry's `items` — the full-replace oracle for a NEW (inserted) block. New blocks are
 * in `plan.newBlocks`, NOT `plan.writes`; their content is byte-identical to the old
 * full-replace and unchanged by S4 (`insertNewBlocksInTx` still builds them from the
 * relocated `tailBundle`). The id match is deterministic because `createTestAllocator()`
 * allocates the SAME ids on the re-plan as on the live op.
 */
function oracleNewBlockForState(
  mkState: () => State,
  span: ReturnType<typeof createSpan>,
  fragment: readonly SiblingBlockInit[],
  blockId: string,
): unknown {
  const plan = planReplaceWithSuggestedFragment(
    mkState(),
    span,
    fragment,
    REPL("d", "i"),
    createTestAllocator(),
  );
  const nb = plan.newBlocks.find((b) => b.id === asBlockId(blockId));
  if (nb === undefined) throw new Error(`oracleNewBlockForState: no new block "${blockId}"`);
  return serializeItems(nb.items);
}

describe("replaceWithSuggestedFragment — S4 surgical START block for n>1", () => {
  it("single-block n>1, collapsed span (pure multi-line insert mid-B): B + new blocks content === oracle AND B's prefix run keeps its characters", () => {
    // B = "a"{x} | "bcd"{y}. Collapsed span at the a|bcd boundary (offset 1) → no
    // strike; pure multi-line insert. n=2 (X / Y) → the NEW head H holds [a]+X (its ¶
    // keyed); B keeps its id + ¶ and holds Y + its PLAIN suffix "bcd"{y}.
    const mk = () => twoBlocks(
      inlineContent([text("a", { x: 1 }), text("bcd", { y: 1 })]),
      inlineContent([text("t", { z: 1 })]),
    );
    const span = createSpan(createPosition(asBlockId("B"), 1), createPosition(asBlockId("B"), 1));
    const fragment: SiblingBlockInit[] = [
      { type: "paragraph", inlineContent: inlineContent([text("X")]) },
      { type: "paragraph", inlineContent: inlineContent([text("Y")]) },
    ];

    const state = mk();
    const bPrefixBefore = yTextAt(state, "B", 0); // the "a"{x} run — whole, untouched

    const r = replaceWithSuggestedFragment(state, span, fragment, REPL("d", "i"), createTestAllocator());

    // B itself: Y{ins} + its suffix.
    expect(serializeBlock(r.state, "B")).toEqual(oracleForState(mk, span, fragment, "B"));
    // The one NEW head (n-1 = 1) precedes B; assert its content ([a] + X).
    const seq = blockSeq(r.state);
    expect(seq).toEqual([seq[0], "B", "T"]);
    const newId = nth(seq, 0, "new head");
    expect(serializeBlock(r.state, newId)).toEqual(oracleNewBlockForState(mk, span, fragment, newId));
    // The load-bearing regression: B's "a"{x} prefix survives (now in H; previously
    // full-replace re-minted it). Offset 1 = a|bcd boundary → "a" is whole + untouched.
    expect(kept(bPrefixBefore, r.state)).toBe(true);
  });

  it("single-block n>1 with a within-B strike (type-over, multi-line): B + new blocks content === oracle AND B's prefix run keeps its characters", () => {
    // B = "a"{x} | "bcd"{y}. Span strikes "bc" (offset 1..3). n=2 → the new head H
    // holds [a] + X{ins}; B holds Y + its STRUCK tail "bc"{y,del} + "d".
    const mk = () => twoBlocks(
      inlineContent([text("a", { x: 1 }), text("bcd", { y: 1 })]),
      inlineContent([text("t", { z: 1 })]),
    );
    const span = createSpan(createPosition(asBlockId("B"), 1), createPosition(asBlockId("B"), 3));
    const fragment: SiblingBlockInit[] = [
      { type: "paragraph", inlineContent: inlineContent([text("X")]) },
      { type: "paragraph", inlineContent: inlineContent([text("Y")]) },
    ];

    const state = mk();
    const bPrefixBefore = yTextAt(state, "B", 0); // "a"{x} — whole, untouched (offset 1)

    const r = replaceWithSuggestedFragment(state, span, fragment, REPL("d", "i"), createTestAllocator());

    expect(serializeBlock(r.state, "B")).toEqual(oracleForState(mk, span, fragment, "B"));
    const seq = blockSeq(r.state);
    expect(seq).toEqual([seq[0], "B", "T"]);
    const newId = nth(seq, 0, "new head");
    // The (only) new head carries B's prefix + line X.
    expect(serializeBlock(r.state, newId)).toEqual(oracleNewBlockForState(mk, span, fragment, newId));
    expect(kept(bPrefixBefore, r.state)).toBe(true);
  });

  it("cross-block n>1 with interveners: per-block content === oracle (B holds the last line + its struck tail) AND B's prefix + E's tail keep their characters", () => {
    const fragment: SiblingBlockInit[] = [
      { type: "paragraph", inlineContent: inlineContent([text("X")]) },
      { type: "paragraph", inlineContent: inlineContent([text("Y")]) },
    ];

    const state = fourBlocks(B(), I1(), I2(), E());
    const bPrefixBefore = yTextAt(state, "B", 0); // "a"{x} — B's untouched prefix
    const eTailBefore = yTextAt(state, "E", 1); // "hi"{h} — E's untouched plain tail

    const r = replaceWithSuggestedFragment(state, span(), fragment, REPL("d", "i"), createTestAllocator());

    // Existing struck blocks: content === full-replace oracle.
    for (const id of ["B", "I1", "I2", "E"]) {
      expect(serializeBlock(r.state, id)).toEqual(oracleBlock(span(), fragment, id));
    }
    // The single new head (n-1 = 1) sits before B; B holds line Y + its struck tail
    // "bc"{y,del} (no character moved).
    const seq = blockSeq(r.state);
    expect(seq).toEqual([seq[0], "B", "I1", "I2", "E"]);
    const newId = nth(seq, 0, "new head");
    expect(serializeBlock(r.state, newId)).toEqual(
      oracleNewBlockForState(() => fourBlocks(B(), I1(), I2(), E()), span(), fragment, newId),
    );
    // The load-bearing regression: B's "a"{x} prefix + E's "hi"{h} tail survive (===);
    // B's prefix is never re-minted.
    expect(kept(bPrefixBefore, r.state)).toBe(true);
    expect(kept(eTailBefore, r.state)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// T9: rich suggested-fragment path — rich inline marks carried, content embeds
// dropped, block type/attrs per-line honored, caret-length in sync.
// ────────────────────────────────────────────────────────────────────────────

import { INSERTION_SUGGESTION_ATTR } from "../suggestions";
import { embed, finalSectionOf } from "../../test-utils/state-builders";

describe("replaceWithSuggestedFragment — T9 rich inline + embed filtering", () => {
  /** Single-block doc with one paragraph P. */
  function singlePara(p: InlineContent): State {
    return buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "P" }),
        buildBlock({ id: "P", type: "paragraph", parentId: "doc", inlineContent: p }),
      ],
    });
  }

  /** Concatenate the text of a block's items (embeds contribute nothing). */
  function blockText(items: readonly InlineItem[]): string {
    return items.map((it) => (it.kind === "text" ? it.text : "")).join("");
  }

  /** Two-block doc: paragraph P1 then P2. */
  function twoParagraphs(p1: InlineContent, p2: InlineContent): State {
    return buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P1", lastChildId: "P2" }),
        buildBlock({ id: "P1", type: "paragraph", parentId: "doc", nextSiblingId: "P2", inlineContent: p1 }),
        buildBlock({ id: "P2", type: "paragraph", parentId: "doc", prevSiblingId: "P1", inlineContent: p2 }),
      ],
    });
  }

  it("suggested fragment carries rich inline marks on the inserted runs", () => {
    // Fragment: one line with bold text "x". After the op, the inserted run must
    // carry the bold attr AND the insertionSuggestionId.
    const state = singlePara(inlineContent([text("hello")]));
    const sp = createSpan(
      createPosition(asBlockId("P"), 0),
      createPosition(asBlockId("P"), 0),
    );
    const fragment: SiblingBlockInit[] = [
      { type: "paragraph", inlineContent: inlineContent([text("x", { bold: true })]) },
    ];
    const r = replaceWithSuggestedFragment(state, sp, fragment, REPL("d", "ins"), createTestAllocator());
    const items = resolveBlock(r.state, asBlockId("P"))?.block.inlineContent?.items ?? [];
    // Find the inserted "x" run.
    const xRun = items.find((it) => it.kind === "text" && it.text === "x");
    expect(xRun).toBeDefined();
    if (xRun === undefined || xRun.kind !== "text") throw new Error("unreachable");
    expect(xRun.attrs["bold"]).toBe(true);
    expect(typeof xRun.attrs[INSERTION_SUGGESTION_ATTR]).toBe("string");
  });

  it("suggested fragment lines keep their OWN block type (heading block created for heading line)", () => {
    const state = twoParagraphs(inlineContent([text("before")]), inlineContent([text("after")]));
    const sp = createSpan(
      createPosition(asBlockId("P1"), 0),
      createPosition(asBlockId("P1"), 0),
    );
    // A MIDDLE (closed) line keeps its own type; the first line joins the caret
    // paragraph's head (B's type, as the direct paste) and the last (open) line adopts
    // the destination B.
    const fragment: SiblingBlockInit[] = [
      { type: "paragraph", inlineContent: inlineContent([text("intro")]) },
      { type: "heading", attrs: { level: 1 }, inlineContent: inlineContent([text("H")]) },
      { type: "paragraph", inlineContent: inlineContent([text("end")]) },
    ];
    const r = replaceWithSuggestedFragment(state, sp, fragment, REPL("d", "ins"), createTestAllocator());
    // After the op: head H0 ("intro"), head H1 (heading "H"), P1 ("end" + "before"), P2.
    const seq = blockSeq(r.state);
    expect(seq.length).toBe(4);
    expect(nth(seq, 2, "caret block")).toBe("P1");
    expect(resolveBlock(r.state, asBlockId("P1"))?.block.type).toBe("paragraph");
    const newBlockId = nth(seq, 1, "new heading head");
    const newBlock = resolveBlock(r.state, asBlockId(newBlockId));
    expect(newBlock?.block.type).toBe("heading");
    expect(newBlock?.block.attrs["level"]).toBe(1);
  });

  it("drops an un-trackable inline image embed from a suggested paste line", () => {
    // Fragment line has [text "a", embed "image"]. After the suggested insert, only
    // "a" (with insertion id) must appear; the image embed must be absent. acceptAll /
    // rejectAll are NON-undoable and mutate the doc in place, so each resolve arm gets a
    // FRESH suggested state (the suggestion-ops.test convention).
    const sp = createSpan(
      createPosition(asBlockId("P"), 0),
      createPosition(asBlockId("P"), 0),
    );
    const fragment: SiblingBlockInit[] = [
      { type: "paragraph", inlineContent: inlineContent([text("a"), embed("image", { src: "x.png" })]) },
    ];
    const mkSuggested = (): State =>
      replaceWithSuggestedFragment(
        singlePara(inlineContent([text("hello")])),
        sp,
        fragment,
        REPL("d", "ins"),
        createTestAllocator(),
      ).state;

    const suggested = mkSuggested();
    const items = resolveBlock(suggested, asBlockId("P"))?.block.inlineContent?.items ?? [];
    // "a" run must be present with insertion id (genuinely tracked).
    const aRun = items.find((it) => it.kind === "text" && it.text === "a");
    expect(aRun).toBeDefined();
    if (aRun === undefined || aRun.kind !== "text") throw new Error("unreachable");
    expect(typeof aRun.attrs[INSERTION_SUGGESTION_ATTR]).toBe("string");
    // The image embed must NOT appear at insert time.
    expect(items.find((it) => it.kind === "embed" && it.embedType === "image")).toBeUndefined();
    // No embed at all appears (paragraph-break suggestions are block tags, not items).
    expect(items.some((it) => it.kind === "embed")).toBe(false);

    // accept-all → the inserted "a" is PRESENT (now plain — insertion id stripped, so
    // it coalesces with the original "hello" into "ahello") and NO embed survives (the
    // dropped content embed leaves zero residue).
    const accItems = resolveBlock(acceptAll(mkSuggested()).state, asBlockId("P"))?.block
      .inlineContent?.items ?? [];
    expect(blockText(accItems)).toBe("ahello");
    expect(accItems.every((it) => it.kind === "text")).toBe(true);
    expect(
      accItems.every((it) => it.kind !== "text" || it.attrs[INSERTION_SUGGESTION_ATTR] === undefined),
    ).toBe(true);

    // reject-all → the inserted "a" is REMOVED (only original "hello" remains) and NO
    // embed survives.
    const rejItems = resolveBlock(rejectAll(mkSuggested()).state, asBlockId("P"))?.block
      .inlineContent?.items ?? [];
    expect(blockText(rejItems)).toBe("hello");
    expect(rejItems.every((it) => it.kind === "text")).toBe(true);
  });

  it("caret / endPosition stays correct when content embeds are filtered (filter-then-measure)", () => {
    // Fragment: single line = [text "ab", embed "inline-image", text "cd"].
    // Filtered items = [text "ab", text "cd"] → length 4.
    // endPosition.offset must be c(=0) + 4 = 4, NOT 5 (which would include the embed).
    const state = singlePara(inlineContent([text("x")]));
    const sp = createSpan(
      createPosition(asBlockId("P"), 0),
      createPosition(asBlockId("P"), 0),
    );
    const fragment: SiblingBlockInit[] = [
      {
        type: "paragraph",
        inlineContent: inlineContent([
          text("ab"),
          embed("inline-image", { src: "y.png" }),
          text("cd"),
        ]),
      },
    ];
    const plan = planReplaceWithSuggestedFragment(
      state,
      sp,
      fragment,
      REPL("d", "ins"),
      createTestAllocator(),
    );
    // Without filtering: "ab"(2) + embed(1) + "cd"(2) = 5.
    // With filtering:    "ab"(2) + "cd"(2) = 4.
    expect(plan.endPosition.offset).toBe(4);
  });
});

/** Serialize a raw `InlineItem[]` (the pre-S2 full-replace content for a block). */
function serializeItems(items: ReadonlyArray<InlineItem>): unknown {
  return items.map((it) =>
    it.kind === "text"
      ? { kind: "text", text: it.text, attrs: it.attrs }
      : { kind: "embed", embedType: it.embedType, attrs: it.attrs, properties: it.properties },
  );
}

/**
 * The pre-S2 (old full-replace) oracle for a block: the planner's `writes[k].items`
 * IS exactly what `writeBlockInlineContentInTx` would have written for that block.
 * Re-plan on a FRESH copy (so the live doc is untouched) and serialize the matching
 * write's items. (`mergeAdjacentTextItems` already normalized them in the planner,
 * so this is byte-identical to the surgical applier's normalized result.)
 */
function oracleBlock(
  span: ReturnType<typeof createSpan>,
  fragment: readonly SiblingBlockInit[],
  blockId: string,
): unknown {
  const input = fourBlocks(B(), I1(), I2(), E());
  const plan = planReplaceWithSuggestedFragment(input, span, fragment, REPL("d", "i"), createTestAllocator());
  const write = plan.writes.find((w) => w.blockId === asBlockId(blockId));
  if (write === undefined) throw new Error(`oracleBlock: no write for "${blockId}"`);
  return serializeItems(write.items);
}

describe("replaceWithSuggestedFragment — span endpoint inside a surrogate pair", () => {
  // "ab😀cd": the emoji occupies [2,4); offset 3 is inside the pair.
  const oneBlock = (): State =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "B", lastChildId: "B" }),
        buildBlock({ id: "B", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("ab😀cd")]) }),
      ],
    });
  const XY: SiblingBlockInit[] = [
    { type: "paragraph", inlineContent: inlineContent([text("X")]) },
    { type: "paragraph", inlineContent: inlineContent([text("Y")]) },
  ];
  /** Per block: its text and the struck (deletion-tagged) text. */
  const view = (st: State) =>
    blockSeq(st).map((id) => {
      const items = resolveBlock(st, id as BlockId)?.block.inlineContent?.items ?? [];
      const runs = items.filter((i): i is Extract<InlineItem, { kind: "text" }> => i.kind === "text");
      return {
        text: runs.map((r) => r.text).join(""),
        struck: runs.filter((r) => "deletionSuggestionId" in r.attrs).map((r) => r.text).join(""),
      };
    });
  const at = (a: number, b: number) => createSpan(createPosition(asBlockId("B"), a), createPosition(asBlockId("B"), b));

  it("[3,5) → snapped once to [2,5): one cut point for the strike, the insert and the moved tail", () => {
    const r = replaceWithSuggestedFragment(oneBlock(), at(3, 5), XY, REPL("d", "i"), createTestAllocator());
    expect(view(r.state)).toEqual([
      { text: "abX", struck: "" },
      { text: "Y😀cd", struck: "😀c" },
    ]);
  });

  it("collapsed @3 → snapped to 2", () => {
    const r = replaceWithSuggestedFragment(oneBlock(), at(3, 3), XY, REPL("d", "i"), createTestAllocator());
    expect(view(r.state)).toEqual([
      { text: "abX", struck: "" },
      { text: "Y😀cd", struck: "" },
    ]);
  });

  it("[1,3) → snapped out to [1,4)", () => {
    const r = replaceWithSuggestedFragment(oneBlock(), at(1, 3), XY, REPL("d", "i"), createTestAllocator());
    expect(view(r.state)).toEqual([
      { text: "aX", struck: "" },
      { text: "Yb😀cd", struck: "b😀" },
    ]);
  });
});
