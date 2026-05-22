import { describe, it, expect } from "vitest";
import {
  inlineContentLength,
  findItemAtOffset,
  mergeAdjacentTextItems,
  splitInlineContentAtOffset,
} from "./inline-content";
import { text, embed, inlineContent } from "../test-utils/state-builders";

describe("inlineContentLength", () => {
  it("returns 0 for empty content", () => {
    expect(inlineContentLength(inlineContent([]))).toBe(0);
  });

  it("sums text lengths in UTF-16 code units", () => {
    const c = inlineContent([text("hello"), text(" world")]);
    expect(inlineContentLength(c)).toBe(11);
  });

  it("counts each embed item as exactly 1", () => {
    const c = inlineContent([
      text("a"),
      embed("image"),
      text("b"),
      embed("mention"),
    ]);
    expect(inlineContentLength(c)).toBe(4); // 1 + 1 + 1 + 1
  });

  it("counts non-BMP characters as their UTF-16 code-unit length", () => {
    // U+1F600 is two UTF-16 code units (surrogate pair).
    const c = inlineContent([text("a😀b")]);
    expect(inlineContentLength(c)).toBe(4); // "a" + surrogate-high + surrogate-low + "b"
  });
});

describe("findItemAtOffset", () => {
  const content = inlineContent([
    text("hello"),       // offsets 0..5
    embed("image"),       // offset 5 (1 unit)
    text("world"),        // offsets 6..11
  ]);

  it("returns the text item containing offset 0", () => {
    expect(findItemAtOffset(content, 0)).toEqual({ itemIndex: 0, withinItem: 0 });
  });

  it("returns the text item with the offset position within it", () => {
    expect(findItemAtOffset(content, 3)).toEqual({ itemIndex: 0, withinItem: 3 });
  });

  it("returns the embed item when offset lands on the embed", () => {
    expect(findItemAtOffset(content, 5)).toEqual({ itemIndex: 1, withinItem: 0 });
  });

  it("returns the next text item when offset is past the embed", () => {
    expect(findItemAtOffset(content, 6)).toEqual({ itemIndex: 2, withinItem: 0 });
  });

  it("returns end-of-block when offset equals total length", () => {
    expect(findItemAtOffset(content, 11)).toEqual({ itemIndex: 3, withinItem: 0 });
  });

  it("returns end-of-block for empty content at offset 0", () => {
    const empty = inlineContent([]);
    expect(findItemAtOffset(empty, 0)).toEqual({ itemIndex: 0, withinItem: 0 });
  });
});

describe("mergeAdjacentTextItems", () => {
  it("returns the input as a fresh array when there is one item or fewer", () => {
    expect(mergeAdjacentTextItems([])).toEqual([]);
    const single = [text("hello", { bold: true })];
    const result = mergeAdjacentTextItems(single);
    expect(result).toEqual(single);
    expect(result).not.toBe(single);
  });

  it("merges two adjacent text items with equal attrs into one", () => {
    const items = [
      text("hel", { bold: true }),
      text("lo", { bold: true }),
    ];
    const result = mergeAdjacentTextItems(items);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "text", text: "hello", attrs: { bold: true } });
  });

  it("preserves two adjacent text items with different attrs", () => {
    const items = [
      text("hel", { bold: true }),
      text("lo", { italic: true }),
    ];
    const result = mergeAdjacentTextItems(items);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ text: "hel", attrs: { bold: true } });
    expect(result[1]).toMatchObject({ text: "lo", attrs: { italic: true } });
  });

  it("does not merge text items across an embed even when their attrs match", () => {
    const items = [
      text("a", { bold: true }),
      embed("img"),
      text("b", { bold: true }),
    ];
    const result = mergeAdjacentTextItems(items);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ kind: "text", text: "a", attrs: { bold: true } });
    expect(result[1]).toMatchObject({ kind: "embed", embedType: "img" });
    expect(result[2]).toMatchObject({ kind: "text", text: "b", attrs: { bold: true } });
  });

  it("does not mutate the input array", () => {
    const items = [
      text("hel", { bold: true }),
      text("lo", { bold: true }),
    ];
    const before = items.slice();
    mergeAdjacentTextItems(items);
    expect(items).toEqual(before);
  });

  it("merges runs of three or more same-attrs text items into one", () => {
    const items = [
      text("a", { bold: true }),
      text("b", { bold: true }),
      text("c", { bold: true }),
    ];
    const result = mergeAdjacentTextItems(items);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "text", text: "abc", attrs: { bold: true } });
  });

  it("drops a sole zero-length text item", () => {
    const items = [text("", {})];
    expect(mergeAdjacentTextItems(items)).toEqual([]);
  });

  it("drops a leading zero-length text item", () => {
    const items = [text("", {}), text("a", {})];
    const result = mergeAdjacentTextItems(items);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "text", text: "a", attrs: {} });
  });

  it("drops a trailing zero-length text item", () => {
    const items = [text("a", {}), text("", {})];
    const result = mergeAdjacentTextItems(items);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "text", text: "a", attrs: {} });
  });

  it("drops an empty bridge text item, allowing the two same-attrs neighbors to merge", () => {
    // Without dropping the empty bridge, the merge would not happen — the
    // empty item's attrs ({}) differ from the bold neighbors. The empty must
    // be dropped WITHIN the merge loop so the same-attrs merge fires.
    const items = [
      text("a", { bold: true }),
      text("", {}),
      text("b", { bold: true }),
    ];
    const result = mergeAdjacentTextItems(items);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "text", text: "ab", attrs: { bold: true } });
  });

  it("drops an empty text item between an embed and a text item without breaking embed barrier", () => {
    const items = [
      text("a", { bold: true }),
      embed("img"),
      text("", { bold: true }),
      text("b", { bold: true }),
    ];
    const result = mergeAdjacentTextItems(items);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ kind: "text", text: "a", attrs: { bold: true } });
    expect(result[1]).toMatchObject({ kind: "embed", embedType: "img" });
    expect(result[2]).toMatchObject({ kind: "text", text: "b", attrs: { bold: true } });
  });

  it("drops an empty text item between two embeds without merging the embeds", () => {
    const items = [embed("img1"), text("", {}), embed("img2")];
    const result = mergeAdjacentTextItems(items);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ kind: "embed", embedType: "img1" });
    expect(result[1]).toMatchObject({ kind: "embed", embedType: "img2" });
  });
});

describe("splitInlineContentAtOffset", () => {
  it("returns [[], []] for an empty inline content at offset 0", () => {
    const content = inlineContent([]);
    const [left, right] = splitInlineContentAtOffset(content, 0);
    expect(left).toEqual([]);
    expect(right).toEqual([]);
  });

  it("returns [[], allItems] for offset 0 of non-empty content", () => {
    const content = inlineContent([text("hello"), text(" world", { italic: true })]);
    const [left, right] = splitInlineContentAtOffset(content, 0);
    expect(left).toEqual([]);
    expect(right).toHaveLength(2);
    expect(right[0]).toMatchObject({ text: "hello" });
    expect(right[1]).toMatchObject({ text: " world", attrs: { italic: true } });
  });

  it("returns [allItems, []] for offset === total length", () => {
    const content = inlineContent([text("hello")]);
    const [left, right] = splitInlineContentAtOffset(content, 5);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ text: "hello" });
    expect(right).toEqual([]);
  });

  it("clean-cuts at a text-item boundary", () => {
    // [text("hello"), text(" world")] — offset 5 = exactly between items.
    const content = inlineContent([text("hello"), text(" world")]);
    const [left, right] = splitInlineContentAtOffset(content, 5);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ text: "hello" });
    expect(right).toHaveLength(1);
    expect(right[0]).toMatchObject({ text: " world" });
  });

  it("splits a text item mid-text, preserving attrs on both halves", () => {
    // [text("hello", { bold: true })] — offset 3 = mid-text.
    const content = inlineContent([text("hello", { bold: true })]);
    const [left, right] = splitInlineContentAtOffset(content, 3);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ text: "hel", attrs: { bold: true } });
    expect(right).toHaveLength(1);
    expect(right[0]).toMatchObject({ text: "lo", attrs: { bold: true } });
  });

  it("clean-cuts at an embed leading edge", () => {
    // [text("a"), embed("img"), text("b")] — offset 1 = leading edge of embed.
    const content = inlineContent([
      text("a"),
      embed("img"),
      text("b"),
    ]);
    const [left, right] = splitInlineContentAtOffset(content, 1);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ kind: "text", text: "a" });
    expect(right).toHaveLength(2);
    expect(right[0]).toMatchObject({ kind: "embed", embedType: "img" });
    expect(right[1]).toMatchObject({ kind: "text", text: "b" });
  });

  it("clean-cuts at an embed trailing edge", () => {
    // Same fixture; offset 2 = trailing edge of embed.
    const content = inlineContent([
      text("a"),
      embed("img"),
      text("b"),
    ]);
    const [left, right] = splitInlineContentAtOffset(content, 2);
    expect(left).toHaveLength(2);
    expect(left[0]).toMatchObject({ kind: "text", text: "a" });
    expect(left[1]).toMatchObject({ kind: "embed", embedType: "img" });
    expect(right).toHaveLength(1);
    expect(right[0]).toMatchObject({ kind: "text", text: "b" });
  });
});
