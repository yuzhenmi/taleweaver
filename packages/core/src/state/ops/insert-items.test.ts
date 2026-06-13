/**
 * Identity-preserving arbitrary-`InlineItem[]` insert (#493, Task S1) — direct unit
 * tests for `planInsertItemsSplitInPlace` / `planReplaceBlockTailInPlace` + the
 * `insertItemsInTx` applier.
 *
 * This is the arbitrary-items generalization of `insert-text.ts`'s split-in-place
 * mode (which inserts a single text run). Two modes:
 *   - `split-in-place`: insert an arbitrary `InlineItem[]` at an offset, splitting
 *     only the straddling run (every OTHER run keeps its Y.Text `===` identity).
 *   - `replace-tail`: keep [0:keepOffset], delete the rest of the block, append the
 *     items (the start-block truncate of a multi-block suggested fragment).
 *
 * Load-bearing properties pinned here: (a) a boundary insert loses ZERO identity;
 * (b) a mid-run insert splits ONLY the straddler; (c) replace-tail at a boundary /
 * mid-run keeps the prefix runs' identity and drops the tail; (d) end-of-content
 * append, empty block, embed-adjacent placement; (e) same-attrs coalescing fires
 * (with AND without a registry).
 *
 * These call the applier directly inside a Y.Doc transaction, reading/capturing raw
 * Y types via `getYBlock` and the `STATE_INTERNAL` live-doc accessor (mirroring
 * `insert-text-split-in-place.test.ts`).
 */
import * as Y from "yjs";
import { describe, it, expect } from "vitest";
import {
  planInsertItemsSplitInPlace,
  planReplaceBlockTailInPlace,
  insertItemsInTx,
} from "./insert-items";
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
import type { InlineContent, InlineItem } from "../inline-content";
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

function liveItems(state: State): ReadonlyArray<InlineItem> {
  const resolved = resolveBlock(state, "p" as BlockId);
  if (resolved === null || resolved.block.inlineContent === null) {
    throw new Error("test fixture: block p has no inlineContent");
  }
  return resolved.block.inlineContent.items;
}

/**
 * Drive a split-in-place insert end-to-end against the live Y.Array of block "p".
 * Returns the live Y.Array for assertions.
 */
function splitInPlace(
  state: State,
  offset: number,
  items: ReadonlyArray<InlineItem>,
  registry?: AttrRegistry,
): Y.Array<Y.Map<unknown>> {
  const doc = state[STATE_INTERNAL].doc;
  const plan = planInsertItemsSplitInPlace(
    "p" as BlockId,
    "block",
    liveItems(state),
    offset,
    items,
    registry,
  );
  runTransaction(doc, () => {
    insertItemsInTx(doc, plan);
  });
  return yItemsOf(state);
}

/** Drive a replace-tail insert end-to-end against the live Y.Array of block "p". */
function replaceTail(
  state: State,
  keepOffset: number,
  items: ReadonlyArray<InlineItem>,
  registry?: AttrRegistry,
): Y.Array<Y.Map<unknown>> {
  const doc = state[STATE_INTERNAL].doc;
  const plan = planReplaceBlockTailInPlace(
    "p" as BlockId,
    "block",
    liveItems(state),
    keepOffset,
    items,
    registry,
  );
  runTransaction(doc, () => {
    insertItemsInTx(doc, plan);
  });
  return yItemsOf(state);
}

// Three DISTINCT-attrs runs so the normalize pass never coalesces them.
function threeRuns(): InlineContent {
  return inlineContent([
    text("aaa", { a: 1 }),
    text("bbb", { b: 1 }),
    text("ccc", { c: 1 }),
  ]);
}

describe("planInsertItemsSplitInPlace + split-in-place applier", () => {
  it("boundary insert: [A,B,C] + [X] at A|B → [A, X, B, C]; A, B, C keep identity", () => {
    const state = oneBlock(threeRuns());
    const yItems = yItemsOf(state);
    const aText = yTextAt(yItems, 0);
    const bText = yTextAt(yItems, 1);
    const cText = yTextAt(yItems, 2);

    // offset 3 == end of run A "aaa" == the A|B boundary.
    const after = splitInPlace(state, 3, [text("X", { x: 1 })]);

    expect(after.length).toBe(4);
    expect(yTextAt(after, 0).toString()).toBe("aaa");
    expect(attrsAt(after, 0)).toEqual({ a: 1 });
    expect(yTextAt(after, 1).toString()).toBe("X");
    expect(attrsAt(after, 1)).toEqual({ x: 1 });
    expect(yTextAt(after, 2).toString()).toBe("bbb");
    expect(attrsAt(after, 2)).toEqual({ b: 1 });
    expect(yTextAt(after, 3).toString()).toBe("ccc");
    expect(attrsAt(after, 3)).toEqual({ c: 1 });
    // Boundary insert → no run split → all three originals survive (===).
    expect(yTextAt(after, 0)).toBe(aText);
    expect(yTextAt(after, 2)).toBe(bText);
    expect(yTextAt(after, 3)).toBe(cText);
  });

  it("mid-run insert: [A,B,C] + [X] inside B → [A, B-before, X, B-after, C]; only B loses identity", () => {
    const state = oneBlock(threeRuns());
    const yItems = yItemsOf(state);
    const aText = yTextAt(yItems, 0);
    const bText = yTextAt(yItems, 1);
    const cText = yTextAt(yItems, 2);

    // offset 4 == 1 char into run B "bbb" → split B into "b" | "bb".
    const after = splitInPlace(state, 4, [text("X", { x: 1 })]);

    expect(after.length).toBe(5);
    expect(yTextAt(after, 0).toString()).toBe("aaa");
    expect(yTextAt(after, 1).toString()).toBe("b");
    expect(attrsAt(after, 1)).toEqual({ b: 1 });
    expect(yTextAt(after, 2).toString()).toBe("X");
    expect(attrsAt(after, 2)).toEqual({ x: 1 });
    expect(yTextAt(after, 3).toString()).toBe("bb");
    expect(attrsAt(after, 3)).toEqual({ b: 1 });
    expect(yTextAt(after, 4).toString()).toBe("ccc");
    // Only the straddled run B loses identity; A and C are untouched.
    expect(yTextAt(after, 0)).toBe(aText);
    expect(yTextAt(after, 4)).toBe(cText);
    expect(yTextAt(after, 1)).not.toBe(bText);
    expect(yTextAt(after, 3)).not.toBe(bText);
  });

  it("end-of-content: itemIndex >= length appends the items; existing run preserved", () => {
    const state = oneBlock(inlineContent([text("aaa", { a: 1 })]));
    const yItems = yItemsOf(state);
    const aText = yTextAt(yItems, 0);

    const after = splitInPlace(state, 3, [text("X", { x: 1 }), text("Y", { y: 1 })]);

    expect(after.length).toBe(3);
    expect(yTextAt(after, 0).toString()).toBe("aaa");
    expect(yTextAt(after, 1).toString()).toBe("X");
    expect(yTextAt(after, 2).toString()).toBe("Y");
    expect(yTextAt(after, 0)).toBe(aText); // append → no split
  });

  it("empty block: inserts just the items", () => {
    const state = oneBlock(inlineContent([]));

    const after = splitInPlace(state, 0, [text("X", { x: 1 })]);

    expect(after.length).toBe(1);
    expect(yTextAt(after, 0).toString()).toBe("X");
    expect(attrsAt(after, 0)).toEqual({ x: 1 });
  });

  it("embed-adjacent: insert at the embed boundary, embed + neighbour untouched", () => {
    // [ embed, "ab"{} ] — insert "X" at offset 1 (after the embed, before "ab").
    const state = oneBlock(
      inlineContent([embed(FOOTNOTE_ANCHOR, { contentBlockId: "fn1" }, {}), text("ab", {})]),
    );
    const yItems = yItemsOf(state);
    const abText = yTextAt(yItems, 1);

    const after = splitInPlace(state, 1, [text("X", { x: 1 })]);

    expect(after.length).toBe(3);
    expect(after.get(0).get("kind")).toBe("embed");
    expect(after.get(0).get("embedType")).toBe(FOOTNOTE_ANCHOR);
    expect(yTextAt(after, 1).toString()).toBe("X");
    expect(yTextAt(after, 2).toString()).toBe("ab");
    expect(yTextAt(after, 2)).toBe(abText); // text run untouched
  });

  it("coalesces an inserted item into an adjacent same-attrs run (deep-compare)", () => {
    // [ "a"{k:1} ] — insert "b"{k:1} at end → merges to [ "ab"{k:1} ].
    const state = oneBlock(inlineContent([text("a", { k: 1 })]));

    const after = splitInPlace(state, 1, [text("b", { k: 1 })]);

    expect(after.length).toBe(1);
    expect(yTextAt(after, 0).toString()).toBe("ab");
    expect(attrsAt(after, 0)).toEqual({ k: 1 });
  });

  it("registry-aware coalesce: custom equals merges runs that deep-compare unequal", () => {
    const registry = new AttrRegistry();
    registry.register({
      attrKey: "comment",
      toStyle: () => ({}),
      equals: (a, b) => (a as { id: string }).id === (b as { id: string }).id,
    });
    const state = oneBlock(inlineContent([text("a", { comment: { id: "c1", ts: 1 } })]));

    const after = splitInPlace(state, 1, [text("b", { comment: { id: "c1", ts: 2 } })], registry);

    expect(after.length).toBe(1);
    expect(yTextAt(after, 0).toString()).toBe("ab");
    expect(attrsAt(after, 0)).toEqual({ comment: { id: "c1", ts: 1 } });
  });

  it("control: WITHOUT the registry, the same custom-equals case does NOT coalesce", () => {
    const state = oneBlock(inlineContent([text("a", { comment: { id: "c1", ts: 1 } })]));

    const after = splitInPlace(state, 1, [text("b", { comment: { id: "c1", ts: 2 } })]);

    expect(after.length).toBe(2);
    expect(yTextAt(after, 0).toString()).toBe("a");
    expect(yTextAt(after, 1).toString()).toBe("b");
  });
});

describe("planReplaceBlockTailInPlace + replace-tail applier", () => {
  it("boundary keep: [A,B,C] keep at A|B, replace [B,C] with items → [A, ...items]; A keeps identity", () => {
    const state = oneBlock(threeRuns());
    const yItems = yItemsOf(state);
    const aText = yTextAt(yItems, 0);

    // keepOffset 3 == A|B boundary → keep [A], drop [B,C], append items.
    const after = replaceTail(state, 3, [text("X", { x: 1 }), text("Y", { y: 1 })]);

    expect(after.length).toBe(3);
    expect(yTextAt(after, 0).toString()).toBe("aaa");
    expect(attrsAt(after, 0)).toEqual({ a: 1 });
    expect(yTextAt(after, 1).toString()).toBe("X");
    expect(yTextAt(after, 2).toString()).toBe("Y");
    expect(yTextAt(after, 0)).toBe(aText); // prefix run preserved
  });

  it("mid-run keep: [A,B,C] keep inside B → [A, B-before, ...items]; A keeps identity, tail dropped", () => {
    const state = oneBlock(threeRuns());
    const yItems = yItemsOf(state);
    const aText = yTextAt(yItems, 0);

    // keepOffset 4 == 1 char into B → keep [A, "b"], drop "bb"+C, append items.
    const after = replaceTail(state, 4, [text("X", { x: 1 })]);

    expect(after.length).toBe(3);
    expect(yTextAt(after, 0).toString()).toBe("aaa");
    expect(attrsAt(after, 0)).toEqual({ a: 1 });
    expect(yTextAt(after, 1).toString()).toBe("b");
    expect(attrsAt(after, 1)).toEqual({ b: 1 });
    expect(yTextAt(after, 2).toString()).toBe("X");
    expect(yTextAt(after, 0)).toBe(aText); // run A preserved (untouched prefix)
  });

  it("keep at offset 0: drops everything, inserts just the items", () => {
    const state = oneBlock(threeRuns());

    const after = replaceTail(state, 0, [text("X", { x: 1 })]);

    expect(after.length).toBe(1);
    expect(yTextAt(after, 0).toString()).toBe("X");
    expect(attrsAt(after, 0)).toEqual({ x: 1 });
  });

  it("replace-tail coalesces the appended item into the kept prefix run when attrs match", () => {
    // [ "aaaa"{k:1} ] — keep 2 chars ("aa"), append "X"{k:1} → coalesce to [ "aaX"{k:1} ].
    const state = oneBlock(inlineContent([text("aaaa", { k: 1 })]));

    const after = replaceTail(state, 2, [text("X", { k: 1 })]);

    expect(after.length).toBe(1);
    expect(yTextAt(after, 0).toString()).toBe("aaX");
    expect(attrsAt(after, 0)).toEqual({ k: 1 });
  });
});
