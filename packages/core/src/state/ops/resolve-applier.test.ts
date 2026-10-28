/**
 * Identity-preserving resolve applier (#484) — direct unit tests for
 * `applyResolveDecisionsInTx`.
 *
 * `decisions[k]` applies to snapshot item `items[k]`: `keep` writes nothing,
 * `rewrite` formats the item's range with the attrs diff (its characters keep
 * their identity), `drop` deletes the item's range. The load-bearing
 * properties: (a) untouched and rewritten characters keep their CRDT identity;
 * (b) drops remove exactly their item (descending offsets, so later drops are not
 * mis-offset); (c) a rewrite that makes neighbours equal reads back as one run;
 * (d) a visible-embed rewrite preserves embedType / properties.
 */
import { describe, it, expect } from "vitest";
import { applyResolveDecisionsInTx } from "./suggestion-ops";
import type { ScanItemResult } from "./suggestion-ops";
import { runTransaction } from "../yjs-doc";
import { STATE_INTERNAL } from "../state-internal";
import { freshState, resolveBlock } from "../state";
import { buildBlock, buildState, text, embed, inlineContent } from "../../test-utils/state-builders";
import { relAt, survives } from "../../test-utils/relpos-survival";
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

/** Apply `decisions` (aligned to block "p"'s current items) and return the post-state + items. */
function resolveP(state: State, decisions: readonly ScanItemResult[]): { after: State; items: readonly InlineItem[] } {
  const doc = state[STATE_INTERNAL].doc;
  const items = resolveBlock(state, "p" as BlockId)?.block.inlineContent?.items ?? [];
  const { dirtyIds } = runTransaction(doc, () => {
    applyResolveDecisionsInTx(doc, [{ blockId: "p" as BlockId, items, decisions }]);
  });
  const after = freshState(state, dirtyIds);
  return { after, items: resolveBlock(after, "p" as BlockId)?.block.inlineContent?.items ?? [] };
}

describe("applyResolveDecisionsInTx", () => {
  it("a strip that makes neighbours equal reads back as one run; every character survives", () => {
    const state = oneBlock(inlineContent([text("a", { ins: "s1" }), text("b", {}), text("c", { bold: true })]));
    const rels = [0, 1, 2].map((o) => relAt(state, "p", o));
    const { after, items } = resolveP(state, [{ op: "rewrite", attrs: {} }, { op: "keep" }, { op: "keep" }]);
    expect(items).toEqual([text("ab"), text("c", { bold: true })]);
    expect(rels.map((r, k) => survives(r, after, "abc".charAt(k)))).toEqual([true, true, true]);
  });

  it("a rewrite is an in-place format (the rewritten characters keep their identity)", () => {
    const state = oneBlock(inlineContent([text("x", { ins: "s1" }), text("y", { bold: true })]));
    const relX = relAt(state, "p", 0);
    const { after, items } = resolveP(state, [{ op: "rewrite", attrs: { italic: true } }, { op: "keep" }]);
    expect(items).toEqual([text("x", { italic: true }), text("y", { bold: true })]);
    expect(survives(relX, after, "x")).toBe(true);
  });

  it("drop deletes exactly its item; kept characters survive", () => {
    const state = oneBlock(inlineContent([text("x", {}), text("y", { del: "s1" }), text("z", { bold: true })]));
    const relZ = relAt(state, "p", 2);
    const { after, items } = resolveP(state, [{ op: "keep" }, { op: "drop" }, { op: "keep" }]);
    expect(items).toEqual([text("x"), text("z", { bold: true })]);
    expect(survives(relZ, after, "z")).toBe(true);
  });

  it("several drops in one block (descending offsets) empty it exactly", () => {
    const state = oneBlock(inlineContent([text("a", { del: "s1" }), text("b", { bold: true }), text("cd", { del: "s2" })]));
    const { items } = resolveP(state, [{ op: "drop" }, { op: "keep" }, { op: "drop" }]);
    expect(items).toEqual([text("b", { bold: true })]);
    const { items: none } = resolveP(oneBlock(inlineContent([text("a", { del: "s1" }), text("b", { x: 1 })])), [
      { op: "drop" },
      { op: "drop" },
    ]);
    expect(none).toEqual([]);
  });

  it("rewrites a visible embed's attrs in place, preserving embedType and properties", () => {
    const state = oneBlock(inlineContent([embed("footnote-anchor", { contentBlockId: "fn1" }, { fmt: "s1" })]));
    const { items } = resolveP(state, [{ op: "rewrite", attrs: {} }]);
    expect(items).toEqual([embed("footnote-anchor", { contentBlockId: "fn1" })]);
  });
});
