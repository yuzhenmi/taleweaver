import { describe, it, expect } from "vitest";
import { applyAttrsToRange } from "./apply-attrs";
import { buildBlock, buildState, text, embed } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import { createPosition, createSpan } from "./block-position";
import type { BlockId } from "./block-id";

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
          inlineContent: createInlineContent([text("helloworld")]),
        }),
      ],
    });

  it("splits the affected text item into prefix + attrs-applied middle + suffix", () => {
    const state = fixture();
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
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

  it("preserves immutability + structural sharing (does not mutate original; unmodified blocks share identity)", () => {
    const state = fixture();
    const beforeP = state.blocks.get("p" as BlockId);
    const beforeDoc = state.blocks.get("doc" as BlockId);
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = applyAttrsToRange(state, span, { bold: true });
    expect(result.state).not.toBe(state);
    expect(result.state.blocks.get("p" as BlockId)).not.toBe(beforeP);
    // Original block's content unchanged:
    expect(beforeP?.inlineContent?.items).toHaveLength(1);
    expect(beforeP?.inlineContent?.items[0]).toMatchObject({ text: "helloworld", attrs: {} });
    // Unmodified blocks (doc) share identity.
    expect(result.state.blocks.get("doc" as BlockId)).toBe(beforeDoc);
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
          inlineContent: createInlineContent([text("helloworld", { italic: true })]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ text: "hel", attrs: { italic: true } });
    expect(items?.[1]).toMatchObject({ text: "lowo", attrs: { italic: true, bold: true } });
    expect(items?.[2]).toMatchObject({ text: "rld", attrs: { italic: true } });
  });

  it("re-collapses prefix+middle+suffix when applying value-equal attrs (split-then-merge contract pin)", () => {
    // text("helloworld", { bold: true }) and apply { bold: true } over [3,7).
    // The algorithm splits into prefix/middle/suffix (all with value-equal attrs);
    // the post-pass mergeAdjacentTextItems must re-collapse them into one item.
    // Pins the contract that attrsEqual is value-based (not reference-based) so
    // that future changes to attrsEqual cannot silently break this case.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([text("helloworld", { bold: true })]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
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
          inlineContent: createInlineContent([text("hello"), text("world", { italic: true })]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 8));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
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
          inlineContent: createInlineContent([text("hello"), text("world")]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
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
          inlineContent: createInlineContent([text("aaa"), text("bbb"), text("ccc")]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 6));
    const result = applyAttrsToRange(state, span, { bold: true });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
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
    // After run-merge: text items have same attrs but are separated by the embed,
    // so they don't merge across it.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: createInlineContent([
            text("a"),
            embed("image", { src: "u" }),
            text("b"),
          ]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3));
    const result = applyAttrsToRange(state, span, { link: "http://x" });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
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
          inlineContent: createInlineContent([
            embed("image", { src: "u" }, { comment: "c1" }),
          ]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 1));
    const result = applyAttrsToRange(state, span, { link: "http://x" });
    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({
      kind: "embed",
      embedType: "image",
      properties: { src: "u" },
      attrs: { comment: "c1", link: "http://x" },
    });
  });
});
