/**
 * `insertItemsInTx` — the arbitrary-`InlineItem[]` offset insert, an offset write on
 * the block's inline `Y.Text`: no existing character is re-minted, so every surviving character keeps its identity — even
 * when the insert lands inside a differently-formatted run.
 */
import { describe, it, expect } from "vitest";
import { planInsertItemsAt, insertItemsInTx } from "./insert-items";
import { resolveBlock } from "../state";
import { runTransaction } from "../yjs-doc";
import { STATE_INTERNAL } from "../state-internal";
import { buildBlock, buildState, text, embed, inlineContent, withTestAttrs } from "../../test-utils/state-builders";
import { relAt, survives } from "../../test-utils/relpos-survival";
import { AttrRegistry } from "../../cascade/attr-registry";
import { freshState } from "../state";
import type { State } from "../state";
import type { InlineContent, InlineItem } from "../inline-content";
import type { BlockId } from "../block-id";

/** doc > [ p(<items>) ] — one leaf block "p" holding the given inline content. */
function oneBlock(content: InlineContent): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: content }),
    ],
  });
}

function apply(state: State, plan: ReturnType<typeof planInsertItemsAt>): ReadonlyArray<InlineItem> {
  const doc = state[STATE_INTERNAL].doc;
  const { dirtyIds } = runTransaction(doc, () => insertItemsInTx(doc, plan));
  const after = freshState(state, dirtyIds);
  return resolveBlock(after, "p" as BlockId)?.block.inlineContent?.items ?? [];
}

const threeRuns = (): InlineContent =>
  inlineContent([text("aaa", { a: 1 }), text("bbb", { b: 1 }), text("ccc", { c: 1 })]);

describe("planInsertItemsAt + insertItemsInTx", () => {
  it("boundary insert: [A,B,C] + [X] at A|B → [A, X, B, C]", () => {
    const s = oneBlock(threeRuns());
    expect(apply(s, planInsertItemsAt("p" as BlockId, "block", 3, [text("X", { x: 1 })]))).toEqual([
      text("aaa", { a: 1 }),
      text("X", { x: 1 }),
      text("bbb", { b: 1 }),
      text("ccc", { c: 1 }),
    ]);
  });

  it("mid-run insert keeps EVERY existing character (the straddled run is not re-minted)", () => {
    const s = oneBlock(threeRuns());
    const rels = [0, 3, 5, 6].map((o) => relAt(s, "p", o));
    const items = apply(s, planInsertItemsAt("p" as BlockId, "block", 4, [text("X", { x: 1 })]));
    expect(items).toEqual([
      text("aaa", { a: 1 }),
      text("b", { b: 1 }),
      text("X", { x: 1 }),
      text("bb", { b: 1 }),
      text("ccc", { c: 1 }),
    ]);
    const after = freshState(s, new Set(["p" as BlockId]));
    expect(rels.map((r, k) => survives(r, after, "abbc".charAt(k)))).toEqual([true, true, true, true]);
  });

  it("end-of-content append and empty block", () => {
    expect(apply(oneBlock(inlineContent([text("aaa")])), planInsertItemsAt("p" as BlockId, "block", 3, [text("X", { x: 1 }), text("Y", { y: 1 })])))
      .toEqual([text("aaa"), text("X", { x: 1 }), text("Y", { y: 1 })]);
    expect(apply(oneBlock(inlineContent([])), planInsertItemsAt("p" as BlockId, "block", 0, [text("X", { x: 1 })])))
      .toEqual([text("X", { x: 1 })]);
  });

  it("embed-adjacent insert leaves the embed untouched", () => {
    const s = oneBlock(inlineContent([embed("footnote-anchor", { contentBlockId: "fn" }), text("ab")]));
    expect(apply(s, planInsertItemsAt("p" as BlockId, "block", 1, [text("X", { x: 1 })]))).toEqual([
      embed("footnote-anchor", { contentBlockId: "fn" }),
      text("X", { x: 1 }),
      text("ab"),
    ]);
  });

  it("an inserted item with deep-equal attrs reads back as one run with its neighbour", () => {
    const s = oneBlock(inlineContent([text("a", { k: 1 })]));
    expect(apply(s, planInsertItemsAt("p" as BlockId, "block", 1, [text("b", { k: 1 })]))).toEqual([text("ab", { k: 1 })]);
  });

  it("registry-equal attrs are written as the neighbour's stored value (canonical storage)", () => {
    const registry = new AttrRegistry();
    registry.register({
      attrKey: "comment",
      toStyle: () => ({}),
      equals: (a, b) =>
        typeof a === "object" && a !== null && typeof b === "object" && b !== null && "id" in a && "id" in b && a.id === b.id,
    });
    const s = withTestAttrs(oneBlock(inlineContent([text("a", { comment: { id: "c1", ts: 1 } })])), registry);
    expect(
      apply(s, planInsertItemsAt("p" as BlockId, "block", 1, [text("b", { comment: { id: "c1", ts: 2 } })])),
    ).toEqual([text("ab", { comment: { id: "c1", ts: 1 } })]);
    // Control: without the registry the values differ → two runs.
    const s2 = oneBlock(inlineContent([text("a", { comment: { id: "c1", ts: 1 } })]));
    expect(apply(s2, planInsertItemsAt("p" as BlockId, "block", 1, [text("b", { comment: { id: "c1", ts: 2 } })]))).toHaveLength(2);
  });
});
