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
