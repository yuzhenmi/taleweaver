/**
 * PF-1 (paste-as-suggestion): `insertFragmentAsSuggestion` — insert a 1..N-line
 * fragment at a COLLAPSED position as ONE tracked insertion (runs carry the
 * insertion id; inter-line breaks are block-split-suggestion embeds sharing it;
 * one insertion record). Accept-all keeps text + makes splits real; reject-all
 * removes the whole fragment (re-merges). Tree-`kind`-aware (works in any body).
 */
import { describe, it, expect } from "vitest";
import {
  insertFragmentAsSuggestion,
  replaceWithSuggestedFragment,
  replaceWithSuggestion,
  acceptAll,
  rejectAll,
} from "./suggestion-ops";
import {
  getSuggestions,
  INSERTION_SUGGESTION_ATTR,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  type SuggestionId,
} from "../suggestions";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";
import { resolveBlock, type State } from "../state";
import { createPosition, createSpan } from "../block-position";
import { asBlockId, createTestAllocator } from "../block-id";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const INPUT = (id: string) => ({ id: id as SuggestionId, author: "alice", createdAt: 1 });
function oneBlock(s = "abcdef"): State {
  return buildState({ rootId: "doc", blocks: [
    buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
    buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text(s)]) }) ] });
}
const blockText = (st: State, id: string) =>
  (resolveBlock(st, asBlockId(id))?.block.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "")).join("");
const blockSeq = (st: State): string[] => {
  const out: string[] = [];
  let id = resolveBlock(st, asBlockId("doc"))?.block.firstChildId ?? null;
  while (id) { out.push(id); id = resolveBlock(st, id)?.block.nextSiblingId ?? null; }
  return out;
};

describe("insertFragmentAsSuggestion — collapsed-span tracked fragment insert (PF-1)", () => {
  it("single-line fragment ≡ mintInsertion (no split, tagged run, suffix preserved)", () => {
    const r = insertFragmentAsSuggestion(oneBlock("abcdef"), createPosition(asBlockId("p"), 3),
      [{ type: "paragraph", inlineContent: inlineContent([text("Z")]) }], INPUT("s1"), createTestAllocator());
    expect(blockText(r.state, "p")).toBe("abcZdef");
    expect(getSuggestions(r.state).map((x) => x.kind)).toEqual(["insertion"]);
    const items = resolveBlock(r.state, asBlockId("p"))?.block.inlineContent?.items ?? [];
    const z = items.find((i) => i.kind === "text" && i.text === "Z");
    expect(z?.kind === "text" && z.attrs[INSERTION_SUGGESTION_ATTR]).toBe("s1");
    expect(r.endPosition).toEqual(createPosition(asBlockId("p"), 4));
  });

  it("two-line fragment splits the block: B keeps prefix+line0+split-embed; new block holds line1+suffix", () => {
    const r = insertFragmentAsSuggestion(oneBlock("abcdef"), createPosition(asBlockId("p"), 3),
      [{ type: "paragraph", inlineContent: inlineContent([text("X")]) },
       { type: "paragraph", inlineContent: inlineContent([text("Y")]) }], INPUT("s1"), createTestAllocator());
    const seq = blockSeq(r.state);
    expect(seq.length).toBe(2);
    expect(blockText(r.state, nth(seq, 0, "block"))).toBe("abcX");
    expect(blockText(r.state, nth(seq, 1, "block"))).toBe("Ydef");
    const p0 = resolveBlock(r.state, asBlockId(nth(seq, 0, "block")))?.block.inlineContent?.items ?? [];
    const emb = p0.find((i) => i.kind === "embed" && i.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE);
    expect(emb && emb.kind === "embed" && emb.properties.suggestionId).toBe("s1");
    expect(getSuggestions(r.state).map((x) => x.kind)).toEqual(["insertion"]);
  });

  it("ACCEPT-all keeps the two-line split for real (2 blocks, no embed, no suggestions)", () => {
    const r = insertFragmentAsSuggestion(oneBlock("abcdef"), createPosition(asBlockId("p"), 3),
      [{ type: "paragraph", inlineContent: inlineContent([text("X")]) },
       { type: "paragraph", inlineContent: inlineContent([text("Y")]) }], INPUT("s1"), createTestAllocator());
    const accepted = acceptAll(r.state).state;
    const seq = blockSeq(accepted);
    expect(seq.map((id) => blockText(accepted, id))).toEqual(["abcX", "Ydef"]);
    expect(getSuggestions(accepted).length).toBe(0);
  });

  it("REJECT-all removes the whole fragment (1 block, original text restored)", () => {
    const r = insertFragmentAsSuggestion(oneBlock("abcdef"), createPosition(asBlockId("p"), 3),
      [{ type: "paragraph", inlineContent: inlineContent([text("X")]) },
       { type: "paragraph", inlineContent: inlineContent([text("Y")]) }], INPUT("s1"), createTestAllocator());
    const rejected = rejectAll(r.state).state;
    const seq = blockSeq(rejected);
    expect(seq.length).toBe(1);
    expect(blockText(rejected, nth(seq, 0, "block"))).toBe("abcdef");
    expect(getSuggestions(rejected).length).toBe(0);
  });

  it("three-line fragment: middle block gets a split-embed (not the suffix); accept keeps 3, reject re-merges", () => {
    const mk = () => insertFragmentAsSuggestion(oneBlock("abcdef"), createPosition(asBlockId("p"), 3),
      [{ type: "paragraph", inlineContent: inlineContent([text("X")]) },
       { type: "paragraph", inlineContent: inlineContent([text("Y")]) },
       { type: "paragraph", inlineContent: inlineContent([text("Z")]) }], INPUT("s1"), createTestAllocator());
    const r = mk();
    const seq = blockSeq(r.state);
    expect(seq.length).toBe(3);
    expect(seq.map((id) => blockText(r.state, id))).toEqual(["abcX", "Y", "Zdef"]);
    // B and the MIDDLE block each carry a split-embed sharing s1; the LAST does not.
    const splitEmbedSuggestionId = (id: string): string | null => {
      const emb = (resolveBlock(r.state, asBlockId(id))?.block.inlineContent?.items ?? [])
        .find((i) => i.kind === "embed" && i.embedType === BLOCK_SPLIT_SUGGESTION_EMBED_TYPE);
      return emb && emb.kind === "embed" ? String(emb.properties.suggestionId) : null;
    };
    expect(splitEmbedSuggestionId(nth(seq, 0, "block"))).toBe("s1");
    expect(splitEmbedSuggestionId(nth(seq, 1, "block"))).toBe("s1");
    expect(splitEmbedSuggestionId(nth(seq, 2, "block"))).toBeNull(); // last new block has the plain suffix, no embed
    expect(getSuggestions(r.state).map((x) => x.kind)).toEqual(["insertion"]);
    // accept keeps all three splits for real; reject (fresh state) re-merges to one.
    const accepted = acceptAll(mk().state).state;
    expect(blockSeq(accepted).map((id) => blockText(accepted, id))).toEqual(["abcX", "Y", "Zdef"]);
    expect(getSuggestions(accepted).length).toBe(0);
    const rejected = rejectAll(mk().state).state;
    const rseq = blockSeq(rejected);
    expect(rseq.length).toBe(1);
    expect(blockText(rejected, nth(rseq, 0, "block"))).toBe("abcdef");
    expect(getSuggestions(rejected).length).toBe(0);
  });

  it("body-context (footnote) collapsed fragment resolves tree-correctly (MT round-trip)", () => {
    const st = buildState({ rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
               buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("m")]) })],
      embedContents: [buildBlock({ id: "fn", type: "body-container", firstChildId: "fnp", lastChildId: "fnp" }),
               buildBlock({ id: "fnp", type: "paragraph", parentId: "fn", inlineContent: inlineContent([text("body")]) })] });
    const r = insertFragmentAsSuggestion(st, createPosition(asBlockId("fnp"), 4),
      [{ type: "paragraph", inlineContent: inlineContent([text("P")]) },
       { type: "paragraph", inlineContent: inlineContent([text("Q")]) }], INPUT("s1"), createTestAllocator());
    expect(getSuggestions(r.state).map((x) => x.kind)).toEqual(["insertion"]);
    const accepted = acceptAll(r.state).state;
    const fnSeqA: string[] = [];
    let fnidA = resolveBlock(accepted, asBlockId("fn"))?.block.firstChildId ?? null;
    while (fnidA) { fnSeqA.push(fnidA); fnidA = resolveBlock(accepted, fnidA)?.block.nextSiblingId ?? null; }
    expect(fnSeqA.length).toBe(2);
    expect(blockText(accepted, nth(fnSeqA, 0, "block"))).toBe("bodyP");
    expect(blockText(accepted, nth(fnSeqA, 1, "block"))).toBe("Q"); // second block survives accept with correct content
    expect(getSuggestions(accepted).length).toBe(0);
  });

  it("body-context reject restores the footnote body to ONE block (MT round-trip, reject side)", () => {
    // A FRESH insert — acceptAll/rejectAll mutate the shared Y.Doc in place, so the
    // reject side needs its own state (it cannot reuse one already accepted above).
    const st = buildState({ rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
               buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("m")]) })],
      embedContents: [buildBlock({ id: "fn", type: "body-container", firstChildId: "fnp", lastChildId: "fnp" }),
               buildBlock({ id: "fnp", type: "paragraph", parentId: "fn", inlineContent: inlineContent([text("body")]) })] });
    const r = insertFragmentAsSuggestion(st, createPosition(asBlockId("fnp"), 4),
      [{ type: "paragraph", inlineContent: inlineContent([text("P")]) },
       { type: "paragraph", inlineContent: inlineContent([text("Q")]) }], INPUT("s1"), createTestAllocator());
    const rejected = rejectAll(r.state).state;
    const fnSeq: string[] = [];
    let fnid = resolveBlock(rejected, asBlockId("fn"))?.block.firstChildId ?? null;
    while (fnid) { fnSeq.push(fnid); fnid = resolveBlock(rejected, fnid)?.block.nextSiblingId ?? null; }
    expect(fnSeq).toEqual(["fnp"]); // the suggested split was removed → blocks re-merged
    expect(blockText(rejected, "fnp")).toBe("body");
    expect(getSuggestions(rejected).length).toBe(0);
  });
});

const REPL = (d: string, i: string) => ({
  deletionId: d as SuggestionId, insertionId: i as SuggestionId, author: "alice", createdAt: 1,
});
function twoBlocks(a: string, b: string): State {
  return buildState({ rootId: "doc", blocks: [
    buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
    buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text(a)]) }),
    buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text(b)]) }) ] });
}
const hasJoinEmbed = (st: State, id: string, sugId: string): boolean =>
  (resolveBlock(st, asBlockId(id))?.block.inlineContent?.items ?? []).some(
    (it) => it.kind === "embed" && it.embedType === BLOCK_JOIN_SUGGESTION_EMBED_TYPE
      && it.properties.suggestionId === sugId);

describe("replaceWithSuggestedFragment — strike + fragment (PF-2)", () => {
  it("empty fragment over a single-block selection ≡ markDeletion (no new blocks)", () => {
    const r = replaceWithSuggestedFragment(oneBlock("abcdef"),
      createSpan(createPosition(asBlockId("p"), 1), createPosition(asBlockId("p"), 4)), [], REPL("d", "i"), createTestAllocator());
    expect(blockText(r.state, "p")).toBe("abcdef"); // soft delete: text kept, tagged
    expect(getSuggestions(r.state).map((x) => x.kind)).toEqual(["deletion"]);
    expect(blockSeq(r.state).length).toBe(1); // no new blocks
    expect(blockText(acceptAll(r.state).state, "p")).toBe("aef"); // bcd dropped on accept
  });

  it("single-block text fragment is byte-identical to replaceWithSuggestion", () => {
    // Replace p[1..4] of "abcdef" with the text "XY" — once via the new fragment op
    // (single-block, single-line fragment), once via the shipped replaceWithSuggestion.
    const span = createSpan(createPosition(asBlockId("p"), 1), createPosition(asBlockId("p"), 4));
    const viaFragment = replaceWithSuggestedFragment(oneBlock("abcdef"), span,
      [{ type: "paragraph", inlineContent: inlineContent([text("XY")]) }], REPL("d", "i"), createTestAllocator());
    const viaShipped = replaceWithSuggestion(oneBlock("abcdef"), span, "XY", {}, REPL("d", "i"));
    expect(resolveBlock(viaFragment.state, asBlockId("p"))?.block.inlineContent?.items)
      .toEqual(resolveBlock(viaShipped.state, asBlockId("p"))?.block.inlineContent?.items);
  });

  it("CROSS-block selection + 1-line fragment: strikes both blocks + a join embed; accept merges to one flow; reject restores", () => {
    // p1="abcdef", p2="ghijkl"; select p1[2..] .. p2[..4]; paste "XYZ".
    const mk = () => replaceWithSuggestedFragment(twoBlocks("abcdef", "ghijkl"),
      createSpan(createPosition(asBlockId("p1"), 2), createPosition(asBlockId("p2"), 4)),
      [{ type: "paragraph", inlineContent: inlineContent([text("XYZ")]) }], REPL("d", "i"), createTestAllocator());
    const r = mk();
    // p1 holds the deletion-flavored join embed (its boundary to p2). No new blocks (1-line).
    expect(hasJoinEmbed(r.state, "p1", "d")).toBe(true);
    expect(blockSeq(r.state).length).toBe(2);
    expect(getSuggestions(r.state).map((x) => x.kind).sort()).toEqual(["deletion", "insertion"]);
    // accept: "ab" + "XYZ" + "kl" merged into ONE block (struck cdef/ghij removed, break joined).
    const accepted = acceptAll(mk().state).state;
    expect(blockSeq(accepted).map((id) => blockText(accepted, id))).toEqual(["abXYZkl"]);
    expect(getSuggestions(accepted).length).toBe(0);
    // reject: original two blocks restored verbatim.
    const rejected = rejectAll(mk().state).state;
    expect(blockSeq(rejected).map((id) => blockText(rejected, id))).toEqual(["abcdef", "ghijkl"]);
    expect(getSuggestions(rejected).length).toBe(0);
  });

  it("CROSS-block selection + 2-line fragment: accept yields ab+line0 | line1+kl across the merged flow; reject restores", () => {
    const mk = () => replaceWithSuggestedFragment(twoBlocks("abcdef", "ghijkl"),
      createSpan(createPosition(asBlockId("p1"), 2), createPosition(asBlockId("p2"), 4)),
      [{ type: "paragraph", inlineContent: inlineContent([text("X")]) },
       { type: "paragraph", inlineContent: inlineContent([text("Y")]) }], REPL("d", "i"), createTestAllocator());
    const accepted = acceptAll(mk().state).state;
    expect(blockSeq(accepted).map((id) => blockText(accepted, id))).toEqual(["abX", "Ykl"]);
    expect(getSuggestions(accepted).length).toBe(0);
    const rejected = rejectAll(mk().state).state;
    expect(blockSeq(rejected).map((id) => blockText(rejected, id))).toEqual(["abcdef", "ghijkl"]);
    expect(getSuggestions(rejected).length).toBe(0);
  });
});
