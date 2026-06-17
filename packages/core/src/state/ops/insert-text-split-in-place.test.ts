/**
 * Identity-preserving `split-in-place` insert (#492, Task 1) — direct unit tests
 * for `planInsertTextSplitInPlace` + the `insertTextInTx` `split-in-place` branch.
 *
 * The mode inserts a DIFFERENTLY-attributed run into a block's LIVE Y.Array by
 * dropping it at a run boundary (zero identity loss — no run is split) or, when
 * the offset lands strictly inside a text run, splitting only that straddling run
 * (its two halves become fresh Y.Text; every OTHER run keeps its Y.Text `===`
 * identity). After the structural edit, `mergeAdjacentSameAttrsTextItemsInPlace` restores
 * the normalization invariants (with the plan's optional `registry` threaded for
 * custom per-key `equals`).
 *
 * Load-bearing properties pinned here: (a) a boundary insert loses ZERO identity
 * (both neighbours `===`); (b) insert at start / end-of-content preserves the
 * untouched run; (c) a mid-run insert splits only the straddler; (d) empty block
 * and embed-adjacent placement; (e) coalescing-into-neighbour fires; (f) the
 * `registry` is threaded so a custom-`equals` coalesce merges runs that
 * deep-compare unequal.
 *
 * These call the applier directly inside a Y.Doc transaction (mirroring
 * `resolve-applier.test.ts` / `apply-attrs.test.ts`), reading/capturing raw Y
 * types via `getYBlock` and the `STATE_INTERNAL` live-doc accessor.
 */
import * as Y from "yjs";
import { describe, it, expect } from "vitest";
import { planInsertTextSplitInPlace, insertTextInTx } from "./insert-text";
import { resolveBlock } from "../state";
import { getYBlock, runTransaction } from "../yjs-doc";
import { STATE_INTERNAL } from "../state-internal";
import {
  buildBlock,
  buildState,
  text,
  embed,
  inlineContent,
} from "../../test-utils/state-builders";
import { AttrRegistry } from "../../cascade/attr-registry";
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

/**
 * Drive a split-in-place insert end-to-end against the live Y.Array of block "p":
 * snapshot its items, plan, then apply inside a transaction. Returns the live
 * Y.Array for assertions.
 */
function splitInPlace(
  state: State,
  offset: number,
  insertText: string,
  insertAttrs: Record<string, unknown>,
  registry?: AttrRegistry,
): Y.Array<Y.Map<unknown>> {
  const doc = state[STATE_INTERNAL].doc;
  const resolved = resolveBlock(state, "p" as BlockId);
  if (resolved === null || resolved.block.inlineContent === null) {
    throw new Error("test fixture: block p has no inlineContent");
  }
  const plan = planInsertTextSplitInPlace(
    "p" as BlockId,
    "block",
    resolved.block.inlineContent.items,
    offset,
    insertText,
    insertAttrs,
    registry,
  );
  runTransaction(doc, () => {
    insertTextInTx(doc, plan);
  });
  return yItemsOf(state);
}

describe("planInsertTextSplitInPlace + split-in-place applier", () => {
  it("boundary insert loses ZERO identity (both neighbours ===)", () => {
    // [ "ab"{}, "cd"{x:1} ] — insert "Z"{ins:"s1"} at offset 2 (the boundary).
    // Result: [ "ab"{}, "Z"{ins:"s1"}, "cd"{x:1} ]; NEITHER neighbour is split.
    const state = oneBlock(inlineContent([text("ab", {}), text("cd", { x: 1 })]));
    const yItems = yItemsOf(state);
    const abText = yTextAt(yItems, 0);
    const cdText = yTextAt(yItems, 1);

    const after = splitInPlace(state, 2, "Z", { ins: "s1" });

    expect(after.length).toBe(3);
    expect(yTextAt(after, 0).toString()).toBe("ab");
    expect(attrsAt(after, 0)).toEqual({});
    expect(yTextAt(after, 1).toString()).toBe("Z");
    expect(attrsAt(after, 1)).toEqual({ ins: "s1" });
    expect(yTextAt(after, 2).toString()).toBe("cd");
    expect(attrsAt(after, 2)).toEqual({ x: 1 });
    // Boundary insert → no run split → both original Y.Text survive (===).
    expect(yTextAt(after, 0)).toBe(abText);
    expect(yTextAt(after, 2)).toBe(cdText);
  });

  it("insert at start (offset 0) puts the new run first; run 0 preserved", () => {
    // [ "ab"{x:1} ] — insert "Z"{ins:"s1"} at offset 0 → [ "Z"{ins}, "ab"{x:1} ].
    const state = oneBlock(inlineContent([text("ab", { x: 1 })]));
    const yItems = yItemsOf(state);
    const abText = yTextAt(yItems, 0);

    const after = splitInPlace(state, 0, "Z", { ins: "s1" });

    expect(after.length).toBe(2);
    expect(yTextAt(after, 0).toString()).toBe("Z");
    expect(attrsAt(after, 0)).toEqual({ ins: "s1" });
    expect(yTextAt(after, 1).toString()).toBe("ab");
    expect(attrsAt(after, 1)).toEqual({ x: 1 });
    expect(yTextAt(after, 1)).toBe(abText); // run 0 preserved
  });

  it("insert at end-of-content appends; the single run is preserved", () => {
    // [ "ab"{x:1} ] — insert "Z"{ins:"s1"} at offset 2 (end) → [ "ab"{x:1}, "Z"{ins} ].
    const state = oneBlock(inlineContent([text("ab", { x: 1 })]));
    const yItems = yItemsOf(state);
    const abText = yTextAt(yItems, 0);

    const after = splitInPlace(state, 2, "Z", { ins: "s1" });

    expect(after.length).toBe(2);
    expect(yTextAt(after, 0).toString()).toBe("ab");
    expect(attrsAt(after, 0)).toEqual({ x: 1 });
    expect(yTextAt(after, 1).toString()).toBe("Z");
    expect(attrsAt(after, 1)).toEqual({ ins: "s1" });
    expect(yTextAt(after, 0)).toBe(abText); // run 0 preserved (append, no split)
  });

  it("mid-run insert splits ONLY the straddling run; the straddler loses identity", () => {
    // [ "abcd"{} ] — insert "Z"{ins:"s1"} at offset 2 → [ "ab"{}, "Z"{ins}, "cd"{} ].
    // The straddled run is split into two FRESH Y.Text halves.
    const state = oneBlock(inlineContent([text("abcd", {})]));
    const yItems = yItemsOf(state);
    const abcdText = yTextAt(yItems, 0);

    const after = splitInPlace(state, 2, "Z", { ins: "s1" });

    expect(after.length).toBe(3);
    expect(yTextAt(after, 0).toString()).toBe("ab");
    expect(attrsAt(after, 0)).toEqual({});
    expect(yTextAt(after, 1).toString()).toBe("Z");
    expect(attrsAt(after, 1)).toEqual({ ins: "s1" });
    expect(yTextAt(after, 2).toString()).toBe("cd");
    expect(attrsAt(after, 2)).toEqual({});
    // The straddler was split → its halves are fresh Y.Text (NOT the original).
    expect(yTextAt(after, 0)).not.toBe(abcdText);
    expect(yTextAt(after, 2)).not.toBe(abcdText);
  });

  it("mid-run split preserves OTHER runs' identity", () => {
    // [ "abcd"{}, "ef"{x:1} ] — insert "Z"{ins} at offset 2 (inside run 0).
    // run 1 ("ef"{x:1}) is untouched → its Y.Text survives (===).
    const state = oneBlock(inlineContent([text("abcd", {}), text("ef", { x: 1 })]));
    const yItems = yItemsOf(state);
    const efText = yTextAt(yItems, 1);

    const after = splitInPlace(state, 2, "Z", { ins: "s1" });

    expect(after.length).toBe(4);
    expect(yTextAt(after, 0).toString()).toBe("ab");
    expect(yTextAt(after, 1).toString()).toBe("Z");
    expect(yTextAt(after, 2).toString()).toBe("cd");
    expect(yTextAt(after, 3).toString()).toBe("ef");
    expect(attrsAt(after, 3)).toEqual({ x: 1 });
    expect(yTextAt(after, 3)).toBe(efText); // untouched neighbour preserved
  });

  it("empty block: inserts the single run", () => {
    // [] — insert "Z"{ins:"s1"} at offset 0 → [ "Z"{ins} ].
    const state = oneBlock(inlineContent([]));

    const after = splitInPlace(state, 0, "Z", { ins: "s1" });

    expect(after.length).toBe(1);
    expect(yTextAt(after, 0).toString()).toBe("Z");
    expect(attrsAt(after, 0)).toEqual({ ins: "s1" });
  });

  it("embed-adjacent: places the new run between the embed and the text run, both untouched", () => {
    // [ embed, "ab"{} ] — insert "Z"{ins} at offset 1 (after the embed, before "ab").
    // → [ embed, "Z"{ins}, "ab"{} ]; embed (length 1) + "ab" untouched.
    const state = oneBlock(
      inlineContent([embed(FOOTNOTE_ANCHOR, { contentBlockId: "fn1" }, {}), text("ab", {})]),
    );
    const yItems = yItemsOf(state);
    const abText = yTextAt(yItems, 1);

    const after = splitInPlace(state, 1, "Z", { ins: "s1" });

    expect(after.length).toBe(3);
    expect(after.get(0).get("kind")).toBe("embed");
    expect(after.get(0).get("embedType")).toBe(FOOTNOTE_ANCHOR);
    expect(yTextAt(after, 1).toString()).toBe("Z");
    expect(attrsAt(after, 1)).toEqual({ ins: "s1" });
    expect(yTextAt(after, 2).toString()).toBe("ab");
    expect(yTextAt(after, 2)).toBe(abText); // text run untouched
  });

  it("coalesces the new run into an adjacent same-attrs run (deep-compare)", () => {
    // [ "a"{k:1} ] — insert "b"{k:1} at end → the post-pass merges to [ "ab"{k:1} ].
    const state = oneBlock(inlineContent([text("a", { k: 1 })]));

    const after = splitInPlace(state, 1, "b", { k: 1 });

    expect(after.length).toBe(1);
    expect(yTextAt(after, 0).toString()).toBe("ab");
    expect(attrsAt(after, 0)).toEqual({ k: 1 });
  });

  it("registry-aware coalesce: custom equals merges runs that deep-compare unequal", () => {
    // A comment interpreter whose `equals` compares only `.id`. Existing run carries
    // {comment:{id:"c1",ts:1}}; insert a run with {comment:{id:"c1",ts:2}} — these
    // deep-compare UNEQUAL (ts differs) but custom-equals EQUAL. With the registry
    // threaded, the post-pass coalesces; without it (deep compare) it would NOT.
    const registry = new AttrRegistry();
    registry.register({
      attrKey: "comment",
      toStyle: () => ({}),
      equals: (a, b) => (a as { id: string }).id === (b as { id: string }).id,
    });
    const state = oneBlock(inlineContent([text("a", { comment: { id: "c1", ts: 1 } })]));

    const after = splitInPlace(state, 1, "b", { comment: { id: "c1", ts: 2 } }, registry);

    // Registry threaded → custom-equals coalesce fires → single merged run.
    expect(after.length).toBe(1);
    expect(yTextAt(after, 0).toString()).toBe("ab");
    // The merge keeps the FIRST (existing) run's attrs (mergeAdjacentSameAttrsTextItemsInPlace
    // appends the donor into the receiver, which carries `aAttrs`).
    expect(attrsAt(after, 0)).toEqual({ comment: { id: "c1", ts: 1 } });
  });

  it("control: WITHOUT the registry, the same custom-equals case does NOT coalesce", () => {
    // Same inputs as above but no registry → deep compare → ts differs → two runs.
    const state = oneBlock(inlineContent([text("a", { comment: { id: "c1", ts: 1 } })]));

    const after = splitInPlace(state, 1, "b", { comment: { id: "c1", ts: 2 } });

    expect(after.length).toBe(2);
    expect(yTextAt(after, 0).toString()).toBe("a");
    expect(yTextAt(after, 1).toString()).toBe("b");
  });
});
