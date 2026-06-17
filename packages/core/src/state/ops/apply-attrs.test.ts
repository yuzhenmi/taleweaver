import { describe, it, expect } from "vitest";
import { applyAttrsToRange, planApplyAttrsToRange, applyAttrsToRangeInTx } from "./apply-attrs";
import { getBlock, applyOperation } from "../state";
import { buildBlock, buildState, text, embed, inlineContent } from "../../test-utils/state-builders";
import { createPosition, createSpan } from "../block-position";
import type { BlockId } from "../block-id";
import { STATE_INTERNAL } from "../state-internal";

describe("applyAttrsToRange — single-block sub-range (splits one item into prefix + middle + suffix)", () => {
  // Block: [text("helloworld") {}]
  // Apply { bold: true } to range [3, 7) — chars "lowo".
  // Expected: [text("hel") {}, text("lowo") {bold:true}, text("rld") {}]
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("helloworld")]),
        }),
      ],
    });

  it("splits the affected text item into prefix + attrs-applied middle + suffix", () => {
    const state = fixture();
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hel", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "lowo", attrs: { bold: true } });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "rld", attrs: {} });
  });

  it("returns dirtyIds containing only the modified block", () => {
    const state = fixture();
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = applyAttrsToRange(state, span, { bold: true });
    expect([...result.dirtyIds]).toEqual(["p"]);
  });

  it("preserves immutability + structural sharing (input snapshot unchanged; unmodified blocks share identity)", () => {
    const state = fixture();
    const beforeP = getBlock(state, "p" as BlockId);
    const beforeDoc = getBlock(state, "doc" as BlockId);
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = applyAttrsToRange(state, span, { bold: true });
    // Y.Doc op produces a fresh State (new snapshot cache).
    expect(result.state).not.toBe(state);
    // Modified block produces a fresh snapshot.
    expect(getBlock(result.state, "p" as BlockId)).not.toBe(beforeP);
    // Original (frozen) snapshot of `p` retains the pre-op view.
    expect(beforeP?.inlineContent?.items).toHaveLength(1);
    expect(beforeP?.inlineContent?.items[0]).toMatchObject({ text: "helloworld", attrs: {} });
    // Unmodified blocks (doc) share snapshot identity via applyOperation's
    // carry-forward cache — memoized renderers can `prev === next` to skip.
    expect(getBlock(result.state, "doc" as BlockId)).toBe(beforeDoc);
  });

  it("merges incoming attrs with existing attrs (does not replace)", () => {
    // Pre-existing item has { italic: true }; applying { bold: true } should yield { italic: true, bold: true } in the affected range.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("helloworld", { italic: true })]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ text: "hel", attrs: { italic: true } });
    expect(items?.[1]).toMatchObject({ text: "lowo", attrs: { italic: true, bold: true } });
    expect(items?.[2]).toMatchObject({ text: "rld", attrs: { italic: true } });
  });

  it("partial overlap with value-equal attrs collapses back to a single item via post-pass merge", () => {
    // text("helloworld", { bold: true }) and apply { bold: true } over [3,7).
    // The op splits the text item via delete+insert (Yjs has no in-place
    // Y.Text split primitive), then the post-pass merges the three same-attrs
    // neighbors back into one — upholding mergeAdjacentTextItems's invariant
    // (no two adjacent text items with equal attrs). The Y.Text identity of
    // the original "helloworld" is lost (rebuilt during the split), but the
    // structural invariant holds.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("helloworld", { bold: true })]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "helloworld", attrs: { bold: true } });
  });
});

describe("applyAttrsToRange — single block, multi-item span", () => {
  it("applies attrs across two text items, merging with each item's existing attrs", () => {
    // Block: [text("hello") {}, text("world") { italic: true }]  (length 10)
    // Apply { bold: true } over [3, 8) — covers "lo" (in first item) + "wor" (in second item).
    // Expected: [text("hel") {}, text("lo") {bold:true}, text("wor") {italic:true, bold:true}, text("ld") {italic:true}]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello"), text("world", { italic: true })]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 8));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(4);
    expect(items?.[0]).toMatchObject({ text: "hel", attrs: {} });
    expect(items?.[1]).toMatchObject({ text: "lo", attrs: { bold: true } });
    expect(items?.[2]).toMatchObject({ text: "wor", attrs: { italic: true, bold: true } });
    expect(items?.[3]).toMatchObject({ text: "ld", attrs: { italic: true } });
  });

  it("applies attrs to a fully-covered text item without splitting", () => {
    // Block: [text("hello") {}, text("world") {}]
    // Apply { bold: true } over [0, 5) — covers exactly the first item.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello"), text("world")]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({ text: "hello", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ text: "world", attrs: {} });
  });

  it("leaves items entirely outside the range untouched (3-item block, range covers only the middle)", () => {
    // Block: [text("aaa"), text("bbb"), text("ccc")] — lengths 3+3+3=9
    // Apply { bold: true } over [3, 6) — covers exactly the middle item.
    // First item ends at 3 (itemEnd <= rangeStart) → keep.
    // Last item starts at 6 (itemStart >= rangeEnd) → keep.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("aaa"), text("bbb"), text("ccc")]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 6));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ text: "aaa", attrs: {} });
    expect(items?.[1]).toMatchObject({ text: "bbb", attrs: { bold: true } });
    expect(items?.[2]).toMatchObject({ text: "ccc", attrs: {} });
  });
});

describe("applyAttrsToRange — embed items in range", () => {
  it("applies attrs to an embed's wrap-attrs (NOT its properties)", () => {
    // Block: [text("a"), embed("image", { src: "u" }), text("b")]  (length 3)
    // Apply { link: "http://x" } over [0, 3) — covers everything.
    // Expected:
    //   - text("a") gets { link: "http://x" }
    //   - embed gets attrs = { link: "http://x" }; properties unchanged
    //   - text("b") gets { link: "http://x" }
    // The embed-affected behavior pins that embed items ARE included in
    // the range: embeds are single positions whose wrap-attrs participate
    // in the merge.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("a"),
            embed("image", { src: "u" }),
            text("b"),
          ]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3));
    const result = applyAttrsToRange(state, span, { link: "http://x" });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a", attrs: { link: "http://x" } });
    expect(items?.[1]).toMatchObject({
      kind: "embed",
      embedType: "image",
      properties: { src: "u" },
      attrs: { link: "http://x" },
    });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b", attrs: { link: "http://x" } });
  });

  it("preserves an embed's pre-existing wrap-attrs and merges with incoming", () => {
    // Embed pre-attrs: { comment: "c1" }; apply { link: "http://x" }
    // Expected merged: { comment: "c1", link: "http://x" }
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            embed("image", { src: "u" }, { comment: "c1" }),
          ]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 1));
    const result = applyAttrsToRange(state, span, { link: "http://x" });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({
      kind: "embed",
      embedType: "image",
      properties: { src: "u" },
      attrs: { comment: "c1", link: "http://x" },
    });
  });

  it("does NOT stamp inline-format attrs onto zero-width structural marker embeds (#465)", () => {
    // [text("a"), comment-start marker, block-split-suggestion marker, text("b")]
    // Apply { bold: true } over the whole range. Text items get bold; the two
    // STRUCTURAL MARKER embeds keep attrs={} — markers carry no formattable
    // content (contrast the visible `image` embed tests above, which DO merge).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("a"),
            embed("comment-start", { commentId: "c1" }),
            embed("block-split-suggestion", { suggestionId: "s1" }),
            text("b"),
          ]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 4));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(4);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "comment-start", properties: { commentId: "c1" } });
    expect(items?.[2]).toMatchObject({ kind: "embed", embedType: "block-split-suggestion", properties: { suggestionId: "s1" } });
    expect(items?.[3]).toMatchObject({ kind: "text", text: "b", attrs: { bold: true } });
    // Strict: the markers' attrs must be EXACTLY {} (toMatchObject's {} is vacuous).
    expect(items?.[1]?.attrs).toEqual({});
    expect(items?.[2]?.attrs).toEqual({});
  });

  it("does NOT stamp a tracked-change provenance attr onto a marker embed (#465 dangling-ref root cause)", () => {
    // The markFormatting path applies { formattingSuggestionId } over a range. A
    // comment marker in that range must NOT receive it — else, after the
    // suggestion record is deleted on resolve, the marker keeps a dangling
    // reference to a since-deleted record forever.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("a"),
            embed("comment-end", { commentId: "c1" }),
            text("b"),
          ]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3));
    const result = applyAttrsToRange(state, span, { formattingSuggestionId: "fs1" });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items?.[1]).toMatchObject({ kind: "embed", embedType: "comment-end" });
    expect(items?.[1]?.attrs).toEqual({}); // no dangling formattingSuggestionId
  });
});

describe("applyAttrsToRange — multi-block span", () => {
  // doc > [p1("hello"), p2("world"), p3("!")]
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("world")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([text("!")]) }),
      ],
    });

  it("applies attrs across two blocks: anchor block partial + focus block partial", () => {
    const state = fixture();
    // Span p1@2 → p2@3: covers p1 [2, 5) + p2 [0, 3).
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3));
    const result = applyAttrsToRange(state, span, { bold: true });

    // p1 split: [text("he") {}, text("llo") {bold}]
    const p1Items = getBlock(result.state, "p1" as BlockId)?.inlineContent?.items;
    expect(p1Items).toHaveLength(2);
    expect(p1Items?.[0]).toMatchObject({ text: "he", attrs: {} });
    expect(p1Items?.[1]).toMatchObject({ text: "llo", attrs: { bold: true } });

    // p2 split: [text("wor") {bold}, text("ld") {}]
    const p2Items = getBlock(result.state, "p2" as BlockId)?.inlineContent?.items;
    expect(p2Items).toHaveLength(2);
    expect(p2Items?.[0]).toMatchObject({ text: "wor", attrs: { bold: true } });
    expect(p2Items?.[1]).toMatchObject({ text: "ld", attrs: {} });

    // p3 untouched.
    const p3Items = getBlock(result.state, "p3" as BlockId)?.inlineContent?.items;
    expect(p3Items).toHaveLength(1);
    expect(p3Items?.[0]).toMatchObject({ text: "!", attrs: {} });

    // dirtyIds: only p1 and p2 changed.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2"]));
  });

  it("applies attrs across three blocks: anchor partial, intervening leaf full, focus partial", () => {
    const state = fixture();
    // Span p1@1 → p3@1: covers p1 [1, 5) + p2 [0, 5) + p3 [0, 1).
    const span = createSpan(createPosition("p1" as BlockId, 1), createPosition("p3" as BlockId, 1));
    const result = applyAttrsToRange(state, span, { bold: true });

    // p1: [text("h") {}, text("ello") {bold}]
    const p1Items = getBlock(result.state, "p1" as BlockId)?.inlineContent?.items;
    expect(p1Items).toHaveLength(2);
    expect(p1Items?.[0]).toMatchObject({ text: "h", attrs: {} });
    expect(p1Items?.[1]).toMatchObject({ text: "ello", attrs: { bold: true } });

    // p2 fully covered → [text("world") {bold}]
    const p2Items = getBlock(result.state, "p2" as BlockId)?.inlineContent?.items;
    expect(p2Items).toHaveLength(1);
    expect(p2Items?.[0]).toMatchObject({ text: "world", attrs: { bold: true } });

    // p3: [text("!") {bold}]
    const p3Items = getBlock(result.state, "p3" as BlockId)?.inlineContent?.items;
    expect(p3Items).toHaveLength(1);
    expect(p3Items?.[0]).toMatchObject({ text: "!", attrs: { bold: true } });

    // dirtyIds: p1, p2, p3 all changed.
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p1", "p2", "p3"]));
  });

  it("preserves structural sharing: untouched blocks share identity across the operation", () => {
    const state = fixture();
    const beforeP3 = getBlock(state, "p3" as BlockId);
    const beforeDoc = getBlock(state, "doc" as BlockId);
    // Span only over p1 and p2.
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p2" as BlockId, 5));
    const result = applyAttrsToRange(state, span, { bold: true });
    expect(getBlock(result.state, "p3" as BlockId)).toBe(beforeP3);
    expect(getBlock(result.state, "doc" as BlockId)).toBe(beforeDoc);
  });
});

describe("applyAttrsToRange — removing attrs (undefined values)", () => {
  it("removes a key from text items in range when value is undefined", () => {
    // Block: [text("hello world", { bold: true, italic: true })]
    // Apply { bold: undefined } over [3, 8) — should remove `bold` from "lo wo".
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello world", { bold: true, italic: true })]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 8));
    const result = applyAttrsToRange(state, span, { bold: undefined });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ text: "hel", attrs: { bold: true, italic: true } });
    expect(items?.[1]).toMatchObject({ text: "lo wo", attrs: { italic: true } });
    expect(items?.[2]).toMatchObject({ text: "rld", attrs: { bold: true, italic: true } });
  });

  it("removing a key that doesn't exist on an item is a no-op for that item", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello", { italic: true })]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5));
    // Attempting to remove `bold` when only `italic` exists.
    const result = applyAttrsToRange(state, span, { bold: undefined });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    // After merge attrs: still { italic: true } (bold key never existed).
    expect(items?.[0]).toMatchObject({ text: "hello", attrs: { italic: true } });
  });

  it("can add and remove attrs in the same call", () => {
    // Block: [text("hello", { bold: true })]
    // Apply { bold: undefined, italic: true }: should remove bold AND add italic.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello", { bold: true })]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5));
    const result = applyAttrsToRange(state, span, { bold: undefined, italic: true });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "hello", attrs: { italic: true } });
  });
});

describe("applyAttrsToRange — same-attrs no-op (#358)", () => {
  it("applying attrs equal to existing returns empty dirtyIds (no spurious dirty)", () => {
    // The pre-#358 bug: toggling bold over an already-bold range fired
    // Y.Map.set("attrs", buildYAttrs(merged)) for each in-range item even
    // when `merged` equaled the existing attrs — every block landed in
    // dirtyIds and cascaded into spurious re-render/re-layout. Now the
    // per-item attrsEqual guard skips the write when nothing would change.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello world", { bold: true })]),
        }),
      ],
    });
    const span = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("p" as BlockId, 11),
    );
    const result = applyAttrsToRange(state, span, { bold: true });
    expect(result.dirtyIds.size).toBe(0);
    // applyOperation's no-op contract: result.state === state on empty dirtyIds.
    expect(result.state).toBe(state);
  });

  it("applying attrs equal to existing on an embed returns empty dirtyIds", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            embed("image", { src: "x.png" }, { caption: "alt" }),
          ]),
        }),
      ],
    });
    const span = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("p" as BlockId, 1),
    );
    const result = applyAttrsToRange(state, span, { caption: "alt" });
    expect(result.dirtyIds.size).toBe(0);
    expect(result.state).toBe(state);
  });

  it("mixed range: skips items whose merged attrs are unchanged, dirties items that change", () => {
    // Two text items in one block: "hello" is already bold; "world" is not.
    // Toggling bold over the full range should ONLY rewrite the second item;
    // the first item's per-item attrsEqual guard skips its write.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("hello", { bold: true }),
            text(" world"),
          ]),
        }),
      ],
    });
    const span = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("p" as BlockId, 11),
    );
    const result = applyAttrsToRange(state, span, { bold: true });
    // The block IS dirty (one item changed); but the per-item guard
    // skipped the no-op write on "hello".
    expect(result.dirtyIds.has("p" as BlockId)).toBe(true);
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    // mergeAdjacentSameAttrsTextItemsInPlace collapses the two text items now
    // that both carry `{ bold: true }`.
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "hello world", attrs: { bold: true } });
  });
});

describe("applyAttrsToRange — empty span no-op", () => {
  it("returns the original state with empty dirtyIds for a collapsed span", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 2);
    const span = createSpan(pos, pos);
    const result = applyAttrsToRange(state, span, { bold: true });
    expect(result.state).toBe(state);
    expect([...result.dirtyIds]).toEqual([]);
  });

  it("returns the original state with empty dirtyIds when incoming attrs is empty {}", () => {
    // No-op for empty attrs — avoids re-allocating items unnecessarily.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello", { bold: true })]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5));
    const result = applyAttrsToRange(state, span, {});
    expect(result.state).toBe(state);
    expect([...result.dirtyIds]).toEqual([]);
  });
});

describe("applyAttrsToRange — same-attrs merge post-pass", () => {
  it("collapses three adjacent text items when attrs converge to value-equal", () => {
    // Block: [text("a", { bold: true }), text("b") {}, text("c", { bold: true })]
    // Apply { bold: true } over the whole range — every item gets bold,
    // then the post-pass collapses the three same-attrs neighbors into one,
    // upholding mergeAdjacentTextItems's "no adjacent same-attrs text items"
    // invariant.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("a", { bold: true }),
            text("b"),
            text("c", { bold: true }),
          ]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "abc", attrs: { bold: true } });
  });

  it("does NOT merge across an embed even when text neighbors share attrs", () => {
    // Block: [text("a"), embed("image"), text("b")]
    // Apply { bold: true } over the whole range — both text items get bold; embed gets bold wrap.
    // Embed is a barrier; text neighbors keep their separate items regardless.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("a"), embed("image"), text("b")]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "a", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ kind: "embed", attrs: { bold: true } });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "b", attrs: { bold: true } });
  });
});

describe("applyAttrsToRange — error cases", () => {
  it("throws when an endpoint references a missing block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("missing" as BlockId, 1),
    );
    expect(() => applyAttrsToRange(state, span, { bold: true })).toThrow(/not found/);
  });

  it("throws when an endpoint references a container block (not a leaf)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "s", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const span = createSpan(
      createPosition("s" as BlockId, 0),
      createPosition("p" as BlockId, 1),
    );
    expect(() => applyAttrsToRange(state, span, { bold: true })).toThrow(/container/);
  });

  it("throws when endpoints are in different selection contexts", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
        buildBlock({ id: "fn", type: "footnote-body", inlineContent: inlineContent([text("footnote")]) }),
      ],
    });
    const span = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("fn" as BlockId, 1),
    );
    expect(() => applyAttrsToRange(state, span, { bold: true })).toThrow(/different selection contexts/);
  });
});

describe("applyAttrsToRange — plan/InTx split (composition primitive)", () => {
  // Block: [text("helloworld") {}] — apply { bold: true } to [3, 7) through the
  // InTx primitive directly (not the public op), asserting the same per-item
  // split the public op produces lands AND the merge post-pass runs.
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("helloworld")]),
        }),
      ],
    });

  it("planApplyAttrsToRange + applyAttrsToRangeInTx applies attrs through a transaction", () => {
    const state = fixture();
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const plan = planApplyAttrsToRange(state, span);
    expect(plan).not.toBeNull();
    if (plan === null) return;
    // Drive the InTx primitive through applyOperation so reading back the
    // result sees a fresh State snapshot (a raw runTransaction mutates Yjs but
    // does not refresh the original state's lazy snapshot cache).
    const result = applyOperation(state, () =>
      applyAttrsToRangeInTx(state[STATE_INTERNAL].doc, plan, { bold: true }, undefined),
    );
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "hel", attrs: {} });
    expect(items?.[1]).toMatchObject({ kind: "text", text: "lowo", attrs: { bold: true } });
    expect(items?.[2]).toMatchObject({ kind: "text", text: "rld", attrs: {} });
  });

  it("InTx merge post-pass collapses adjacent same-attrs items", () => {
    // Two adjacent items that converge to the same attrs after applying
    // { bold: true } across the full span — the merge pass must collapse them.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello"), text("world", { italic: true })]),
        }),
      ],
    });
    // Apply { italic: true } across both → first becomes {italic:true}, second
    // stays {italic:true} → adjacent same-attrs → merge collapses to one item.
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 10));
    const plan = planApplyAttrsToRange(state, span);
    expect(plan).not.toBeNull();
    if (plan === null) return;
    const result = applyOperation(state, () =>
      applyAttrsToRangeInTx(state[STATE_INTERNAL].doc, plan, { italic: true }, undefined),
    );
    const items = getBlock(result.state, "p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ kind: "text", text: "helloworld", attrs: { italic: true } });
  });

  it("applyAttrsToRangeInTx throws when called outside any Y.Doc transaction", () => {
    const state = fixture();
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const plan = planApplyAttrsToRange(state, span);
    expect(plan).not.toBeNull();
    if (plan === null) return;
    expect(() =>
      applyAttrsToRangeInTx(state[STATE_INTERNAL].doc, plan, { bold: true }, undefined),
    ).toThrow(/applyAttrsToRange: must be called inside Y\.Doc\.transact/);
  });
});
