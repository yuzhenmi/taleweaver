/**
 * Identity-preserving resolve applier (#484, Task 2) — direct unit tests for
 * `applyResolveDecisionsInTx`.
 *
 * The applier walks a `decisions[]` list (aligned to the pre-resolve snapshot
 * item order) against the LIVE Y.Array of one owning block, applying each in
 * place: `keep` advances, `rewrite` swaps the item's attrs Y.Map (preserving its
 * Y.Text / embedType / properties — and therefore the per-character CRDT
 * identity), `drop`/`breakDrop` delete-by-index (don't-advance discipline), then
 * `mergeAdjacentSameAttrsTextItemsInPlace` restores the normalization invariants.
 *
 * The load-bearing properties exercised here: (a) an UNTOUCHED survivor keeps
 * its Y.Text `===` identity; (b) a `rewrite` swaps attrs in place keeping that
 * item's Y.Text identity; (c) a `drop` removes its item by index (delete
 * discipline, distinct attrs so no coalesce); (d) post-coalesce merges
 * newly-same-attrs neighbors; (e) all-drop leaves an empty Y.Array; (f) a
 * visible-embed rewrite preserves embedType/properties while updating attrs;
 * (g) `breakDrop` shares the delete-by-index arm with `drop`.
 *
 * These call the applier directly inside a Y.Doc transaction (mirroring
 * `apply-attrs.test.ts`), reading/capturing raw Y types via `getYBlock` and the
 * `STATE_INTERNAL` live-doc accessor — none are re-exported from `../state`.
 */
import * as Y from "yjs";
import { describe, it, expect } from "vitest";
import { applyResolveDecisionsInTx } from "./suggestion-ops";
import type { ScanItemResult } from "./suggestion-ops";
import { getYBlock, runTransaction } from "../yjs-doc";
import { STATE_INTERNAL } from "../state-internal";
import {
  buildBlock,
  buildState,
  text,
  embed,
  inlineContent,
} from "../../test-utils/state-builders";
import type { State } from "../state";
import type { InlineContent } from "../inline-content";
import type { BlockId } from "../block-id";

const FOOTNOTE_ANCHOR = "footnote-anchor";

/** doc > [ p(<items>) ] — one leaf block "p" holding the given inline content. */
function oneBlock(content: InlineContent): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: content,
      }),
    ],
  });
}

/** The live Y.Array of block "p"'s inline content (raw Y access for the test). */
function yItemsOf(state: State): Y.Array<Y.Map<unknown>> {
  const doc = state[STATE_INTERNAL].doc;
  const yBlock = getYBlock(doc, "p" as BlockId, "test", "block");
  return yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>>;
}

/** The Y.Text child of the item at `index` (raw Y access). */
function yTextAt(yItems: Y.Array<Y.Map<unknown>>, index: number): Y.Text {
  return yItems.get(index).get("text") as Y.Text;
}

/** The plain attrs object of the item at `index`. */
function attrsAt(yItems: Y.Array<Y.Map<unknown>>, index: number): Record<string, unknown> {
  const yAttrs = yItems.get(index).get("attrs") as Y.Map<unknown>;
  return yAttrs.toJSON() as Record<string, unknown>;
}

describe("applyResolveDecisionsInTx", () => {
  it("coalesces the newly-same-attrs pair after a strip and preserves the keep-survivor's Y.Text identity", () => {
    // items: text("a", {ins:"s1"}), text("b", {}), text("c", {bold:true})
    // decisions: rewrite run0 → {} (strip ins); keep run1; keep run2.
    // After rewrite run0.attrs === {} === run1.attrs ⇒ they coalesce into "ab"{}.
    // run2 ({bold:true}) is non-adjacent to the merged pair + distinct-attrs, so it
    // CANNOT coalesce — its Y.Text MUST be the SAME object (`===`) after.
    const state = oneBlock(
      inlineContent([
        text("a", { ins: "s1" }),
        text("b", {}),
        text("c", { bold: true }),
      ]),
    );
    const doc = state[STATE_INTERNAL].doc;
    const yItems = yItemsOf(state);
    const survivorCText = yTextAt(yItems, 2); // the "c" {bold:true} survivor

    const decisions: readonly ScanItemResult[] = [
      { op: "rewrite", attrs: {} },
      { op: "keep" },
      { op: "keep" },
    ];
    runTransaction(doc, () => {
      applyResolveDecisionsInTx(doc, "p" as BlockId, "block", decisions, undefined);
    });

    // run0+run1 coalesced into one "ab"{} run; "c"{bold} follows.
    expect(yItems.length).toBe(2);
    expect(yTextAt(yItems, 0).toString()).toBe("ab");
    expect(attrsAt(yItems, 0)).toEqual({});
    expect(yTextAt(yItems, 1).toString()).toBe("c");
    expect(attrsAt(yItems, 1)).toEqual({ bold: true });
    // The non-coalesced survivor keeps its Y.Text object identity (now at index 1).
    expect(yTextAt(yItems, 1)).toBe(survivorCText);
  });

  it("preserves Y.Text identity of a rewritten item when it does NOT coalesce", () => {
    // items: text("x", {ins:"s1"}), text("y", {bold:true})
    // decision: rewrite run0 → {italic:true} (distinct from run1's {bold:true}), keep run1.
    // run0 stays distinct from run1 ⇒ NO coalesce ⇒ run0's Y.Text MUST survive (`===`),
    // proving the rewrite is an in-place attrs swap, not a delete+insert.
    const state = oneBlock(
      inlineContent([
        text("x", { ins: "s1" }),
        text("y", { bold: true }),
      ]),
    );
    const doc = state[STATE_INTERNAL].doc;
    const yItems = yItemsOf(state);
    const xText = yTextAt(yItems, 0);

    const decisions: readonly ScanItemResult[] = [
      { op: "rewrite", attrs: { italic: true } },
      { op: "keep" },
    ];
    runTransaction(doc, () => {
      applyResolveDecisionsInTx(doc, "p" as BlockId, "block", decisions, undefined);
    });

    expect(yItems.length).toBe(2);
    expect(yTextAt(yItems, 0).toString()).toBe("x");
    expect(attrsAt(yItems, 0)).toEqual({ italic: true });
    expect(yTextAt(yItems, 0)).toBe(xText); // in-place: same Y.Text object
  });

  it("drops an item by index without advancing (delete discipline; distinct attrs so no coalesce)", () => {
    // items: text("x", {}), text("y", {del:"s1"}), text("z", {bold:true})
    // decisions: keep, drop, keep → result ["x"{}, "z"{bold}]; "y" removed.
    // The "z" attrs are distinct from "x", so no spurious coalesce masks the drop.
    const state = oneBlock(
      inlineContent([
        text("x", {}),
        text("y", { del: "s1" }),
        text("z", { bold: true }),
      ]),
    );
    const doc = state[STATE_INTERNAL].doc;
    const yItems = yItemsOf(state);
    const xText = yTextAt(yItems, 0);
    const zText = yTextAt(yItems, 2);

    const decisions: readonly ScanItemResult[] = [
      { op: "keep" },
      { op: "drop" },
      { op: "keep" },
    ];
    runTransaction(doc, () => {
      applyResolveDecisionsInTx(doc, "p" as BlockId, "block", decisions, undefined);
    });

    expect(yItems.length).toBe(2);
    expect(yTextAt(yItems, 0).toString()).toBe("x");
    expect(yTextAt(yItems, 1).toString()).toBe("z");
    // The two kept survivors keep their Y.Text identity (delete-by-index, no rebuild).
    expect(yTextAt(yItems, 0)).toBe(xText);
    expect(yTextAt(yItems, 1)).toBe(zText);
  });

  it("treats breakDrop like drop — deletes by index without advancing", () => {
    // breakDrop shares the applier's delete-by-index arm with drop (it differs only
    // in the caller, which records a merge owner). Pin that the applier handles it
    // identically: keep, breakDrop, keep → ["x"{}, "z"{bold}]; "y" removed.
    const state = oneBlock(
      inlineContent([
        text("x", {}),
        text("y", { del: "s1" }),
        text("z", { bold: true }),
      ]),
    );
    const doc = state[STATE_INTERNAL].doc;
    const yItems = yItemsOf(state);
    const xText = yTextAt(yItems, 0);
    const zText = yTextAt(yItems, 2);

    const decisions: readonly ScanItemResult[] = [
      { op: "keep" },
      { op: "breakDrop", merge: false },
      { op: "keep" },
    ];
    runTransaction(doc, () => {
      applyResolveDecisionsInTx(doc, "p" as BlockId, "block", decisions, undefined);
    });

    expect(yItems.length).toBe(2);
    expect(yTextAt(yItems, 0).toString()).toBe("x");
    expect(yTextAt(yItems, 1).toString()).toBe("z");
    expect(yTextAt(yItems, 0)).toBe(xText);
    expect(yTextAt(yItems, 1)).toBe(zText);
  });

  it("leaves an empty Y.Array when every item drops", () => {
    // items: text("a", {del:"s1"}), text("b", {del:"s1"})
    // decisions all drop → array empties. Don't-advance discipline must delete
    // BOTH despite the index sliding (a naive index++ would skip the second).
    const state = oneBlock(
      inlineContent([
        text("a", { del: "s1" }),
        text("b", { del: "s1" }),
      ]),
    );
    const doc = state[STATE_INTERNAL].doc;
    const yItems = yItemsOf(state);

    const decisions: readonly ScanItemResult[] = [{ op: "drop" }, { op: "drop" }];
    runTransaction(doc, () => {
      applyResolveDecisionsInTx(doc, "p" as BlockId, "block", decisions, undefined);
    });

    expect(yItems.length).toBe(0);
  });

  it("rewrites a visible embed's attrs in place, preserving embedType and properties", () => {
    // item: embed(footnote-anchor, properties:{contentBlockId:"fn1"}, attrs:{fmt:"s1"})
    // decision: rewrite attrs without fmt → embedType + properties unchanged, attrs updated.
    const state = oneBlock(
      inlineContent([
        embed(FOOTNOTE_ANCHOR, { contentBlockId: "fn1" }, { fmt: "s1" }),
      ]),
    );
    const doc = state[STATE_INTERNAL].doc;
    const yItems = yItemsOf(state);

    const decisions: readonly ScanItemResult[] = [{ op: "rewrite", attrs: {} }];
    runTransaction(doc, () => {
      applyResolveDecisionsInTx(doc, "p" as BlockId, "block", decisions, undefined);
    });

    expect(yItems.length).toBe(1);
    const item = yItems.get(0);
    expect(item.get("kind")).toBe("embed");
    expect(item.get("embedType")).toBe(FOOTNOTE_ANCHOR);
    const properties = (item.get("properties") as Y.Map<unknown>).toJSON();
    expect(properties).toEqual({ contentBlockId: "fn1" });
    expect(attrsAt(yItems, 0)).toEqual({}); // fmt stripped
  });
});
