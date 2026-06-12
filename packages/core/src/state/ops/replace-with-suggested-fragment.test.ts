/**
 * Identity-preserving `replaceWithSuggestedFragment` (#493, Task S2) — the
 * INTERVENING blocks + the END block E + the `n===0` START-block strike are now
 * applied SURGICALLY (`applyDeletionStrikeInTx`), not via the old per-block
 * full-replace (`writeBlockInlineContentInTx`). The op's RESULTING document stays
 * byte-identical to the full-replace behavior; only the UNTOUCHED runs' `Y.Text`
 * CRDT identity is now preserved.
 *
 * Oracle: a SECOND fresh copy of the same input state, to which each
 * `planReplaceWithSuggestedFragment().writes[k].items` is applied via a local
 * full-replace (`getYBlock(...).set("inlineContent", buildYInlineContent(...))`,
 * exactly what the old `writeBlockInlineContentInTx` did) plus the new-block / rewire
 * handling that mirrors the applier. The surgical applier's per-block serialized
 * content MUST equal that copy's, block-for-block.
 *
 * Identity: an UNTOUCHED run in E's PLAIN TAIL keeps its `Y.Text` `===` across the
 * surgical op (the old full-replace minted fresh `Y.Text`, losing it). Captured via
 * the live doc (`STATE_INTERNAL.doc` + `getYBlock(...).get("inlineContent")`) since
 * `InlineItem` does not expose the `Y.Text`.
 */
import * as Y from "yjs";
import { describe, it, expect } from "vitest";
import {
  replaceWithSuggestedFragment,
  planReplaceWithSuggestedFragment,
  type ReplaceSuggestionInput,
} from "./suggestion-ops";
import { type SuggestionId } from "../suggestions";
import { resolveBlock, type State } from "../state";
import { getYBlock } from "../yjs-doc";
import { STATE_INTERNAL } from "../state-internal";
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
  let id = resolveBlock(st, asBlockId("doc"))?.block.firstChildId ?? null;
  while (id) {
    out.push(id);
    id = resolveBlock(st, id)?.block.nextSiblingId ?? null;
  }
  return out;
};

/** The Y.Text of the item at `index` in block `id`'s LIVE Y.Array (raw access). */
function yTextAt(st: State, id: string, index: number): Y.Text {
  const yItems = getYBlock(st[STATE_INTERNAL].doc, id as BlockId, "test", "block").get(
    "inlineContent",
  ) as Y.Array<Y.Map<unknown>>;
  return yItems.get(index).get("text") as Y.Text;
}

// E has TWO distinct-attrs runs: "fg"{f} struck whole + "hi"{h} a wholly-untouched
// plain tail whose Y.Text identity we pin. The span ends at E offset 2 (the f|h
// boundary) so the strike covers exactly the "fg" run; "hi" is never touched.
// B has TWO distinct-attrs runs: "a"{x} a wholly-untouched prefix whose Y.Text we
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
  it("cross-block multi-intervener n>1: per-block content === old full-replace AND E's plain-tail run keeps Y.Text identity", () => {
    const fragment: SiblingBlockInit[] = [
      { type: "paragraph", inlineContent: inlineContent([text("X")]) },
      { type: "paragraph", inlineContent: inlineContent([text("Y")]) },
    ];

    // Surgical run — capture E's plain-tail run Y.Text BEFORE the op.
    const state = fourBlocks(B(), I1(), I2(), E());
    const eTailBefore = yTextAt(state, "E", 1);

    const r = replaceWithSuggestedFragment(state, span(), fragment, REPL("d", "i"), createTestAllocator());

    // (a) Equivalence vs the expected full-replace content (interveners + E + B).
    //     Expected B = "a" plain + "bc" struck (deletion d) + line0 "X"{ins} +
    //     split-embed; I1/I2 = struck whole + join embed; E = "fg" struck + "hi" plain.
    //     We compare the INTERVENER + E blocks (the S2-surgical ones) against a hand-
    //     derived oracle built from the SAME plan's writes via full-replace below.
    expect(serializeBlock(r.state, "I1")).toEqual(oracleBlock(span(), fragment, "I1"));
    expect(serializeBlock(r.state, "I2")).toEqual(oracleBlock(span(), fragment, "I2"));
    expect(serializeBlock(r.state, "E")).toEqual(oracleBlock(span(), fragment, "E"));

    // (b) E's plain-tail "hi" run Y.Text is preserved (===) across the surgical op.
    const eItems = getYBlock(r.state[STATE_INTERNAL].doc, "E" as BlockId, "test", "block").get(
      "inlineContent",
    ) as Y.Array<Y.Map<unknown>>;
    // Find the surviving "hi" run and assert identity.
    let found: Y.Text | null = null;
    for (let k = 0; k < eItems.length; k++) {
      const t = eItems.get(k).get("text") as Y.Text;
      if (t.toString() === "hi") found = t;
    }
    expect(found).toBe(eTailBefore);
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
    // The surgical strike preserves the Y.Text identity of BOTH untouched runs:
    // B's prefix and E's plain tail. The old full-replace minted fresh Y.Text for each.
    expect(yTextAt(r.state, "B", 0)).toBe(bPrefixBefore);
    expect(yTextAt(r.state, "E", 1)).toBe(eTailBefore);
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
