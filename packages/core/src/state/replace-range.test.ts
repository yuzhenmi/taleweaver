import { describe, it, expect } from "vitest";
import { replaceRange } from "./replace-range";
import { buildBlock, buildState, text, embed } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import { createPosition, createSpan } from "./block-position";
import type { BlockId } from "./block-id";

describe("replaceRange — basic single-block replacement", () => {
  // doc > [p("hello world")]
  // Replace range [3, 7) with "FOO" — drops "lo w", inserts "FOO" at position 3.
  // Expected: p("helFOOorld")
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world")]) }),
      ],
    });

  it("deletes the range and inserts the replacement text at the seam", () => {
    const state = fixture();
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = replaceRange(state, span, "FOO", {});

    const block = result.state.blocks.get("p" as BlockId);
    expect(block?.inlineContent?.items).toHaveLength(1);
    expect(block?.inlineContent?.items[0]).toMatchObject({ kind: "text", text: "helFOOorld", attrs: {} });

    // dirtyIds: just the modified block (deleteRange dirties "p"; insertText dirties "p"; union = {"p"}).
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p"]));
  });
});

describe("replaceRange — same-block coverage", () => {
  it("replaces a range mid-text-item, inheriting the caller's attrs (NOT the deleted range's attrs)", () => {
    // [text("hello world", { bold: true })] — replace [3, 7) with "FOO" + {italic: true}.
    // Expected items: text("hel", {bold:true}), text("FOO", {italic:true}), text("orld", {bold:true})
    // The inserted text takes the caller's attrs ({italic:true}); the surviving
    // halves keep the block's original attrs ({bold:true}). No run-merging at the
    // seams because attrs differ.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world", { bold: true })]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = replaceRange(state, span, "FOO", { italic: true });

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(3);
    expect(items?.[0]).toMatchObject({ text: "hel", attrs: { bold: true } });
    expect(items?.[1]).toMatchObject({ text: "FOO", attrs: { italic: true } });
    expect(items?.[2]).toMatchObject({ text: "orld", attrs: { bold: true } });
  });

  it("replaces a range and run-merges with neighbors when attrs match", () => {
    // [text("hello world", { bold: true })] — replace [3, 7) with "FOO" + {bold: true}.
    // After: prefix text("hel", {bold}) + insert text("FOO", {bold}) + suffix text("orld", {bold}).
    // All three have same attrs → run-merged into one item: text("helFOOorld", {bold:true}).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hello world", { bold: true })]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 3), createPosition("p" as BlockId, 7));
    const result = replaceRange(state, span, "FOO", { bold: true });

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "helFOOorld", attrs: { bold: true } });
  });

  it("replaces a range covering an embed item with text", () => {
    // [text("a"), embed("img"), text("b")] — replace [1, 2) (the embed) with "X" + {}.
    // After: anchor [text("a"), text("X"), text("b")] — all same attrs → run-merged.
    // Final: [text("aXb", {})]
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("a"), embed("img"), text("b")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 2));
    const result = replaceRange(state, span, "X", {});

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "aXb", attrs: {} });
  });

  it("replaces a range that spans multiple text items", () => {
    // [text("ab"), text("cd"), text("ef")] — replace [1, 5) with "Z" + {}.
    // After delete: [text("a"), text("f")] (run-merged from "a" + "f" = "af").
    // After insert at offset 1 (which is now end-of-"a"): [text("aZf", {})] (run-merged).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("ab"), text("cd"), text("ef")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 5));
    const result = replaceRange(state, span, "Z", {});

    const items = result.state.blocks.get("p" as BlockId)?.inlineContent?.items;
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({ text: "aZf", attrs: {} });
  });
});
