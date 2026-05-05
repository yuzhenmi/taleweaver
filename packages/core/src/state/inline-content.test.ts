import { describe, it, expect } from "vitest";
import {
  createTextItem,
  createEmbedItem,
  createInlineContent,
  type TextItem,
  type EmbedItem,
  inlineContentLength,
  findItemAtOffset,
  mergeAdjacentTextItems,
} from "./inline-content";

describe("inline content factories", () => {
  it("createTextItem produces a frozen text item", () => {
    const t: TextItem = createTextItem("hello", { bold: true });
    expect(t.kind).toBe("text");
    expect(t.text).toBe("hello");
    expect(t.attrs).toEqual({ bold: true });
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(t.attrs)).toBe(true);
  });

  it("createTextItem defaults attrs to empty bag", () => {
    const t = createTextItem("hi");
    expect(t.attrs).toEqual({});
  });

  it("createEmbedItem produces a frozen embed item", () => {
    const e: EmbedItem = createEmbedItem("image", { src: "u" }, { link: "http://x" });
    expect(e.kind).toBe("embed");
    expect(e.embedType).toBe("image");
    expect(e.properties).toEqual({ src: "u" });
    expect(e.attrs).toEqual({ link: "http://x" });
    expect(Object.isFrozen(e)).toBe(true);
  });

  it("createInlineContent produces a frozen container", () => {
    const c = createInlineContent([createTextItem("a"), createTextItem("b")]);
    expect(c.items).toHaveLength(2);
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.items)).toBe(true);
  });
});

describe("inlineContentLength", () => {
  it("returns 0 for empty content", () => {
    expect(inlineContentLength(createInlineContent([]))).toBe(0);
  });

  it("sums text lengths in UTF-16 code units", () => {
    const c = createInlineContent([createTextItem("hello"), createTextItem(" world")]);
    expect(inlineContentLength(c)).toBe(11);
  });

  it("counts each embed item as exactly 1", () => {
    const c = createInlineContent([
      createTextItem("a"),
      createEmbedItem("image"),
      createTextItem("b"),
      createEmbedItem("mention"),
    ]);
    expect(inlineContentLength(c)).toBe(4); // 1 + 1 + 1 + 1
  });

  it("counts non-BMP characters as their UTF-16 code-unit length", () => {
    // 😀 is U+1F600, which is two UTF-16 code units (surrogate pair)
    const c = createInlineContent([createTextItem("a😀b")]);
    expect(inlineContentLength(c)).toBe(4); // "a" + surrogate-high + surrogate-low + "b"
  });
});

describe("findItemAtOffset", () => {
  const content = createInlineContent([
    createTextItem("hello"),       // offsets 0..5
    createEmbedItem("image"),       // offset 5 (1 unit)
    createTextItem("world"),        // offsets 6..11
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
    const empty = createInlineContent([]);
    expect(findItemAtOffset(empty, 0)).toEqual({ itemIndex: 0, withinItem: 0 });
  });
});

describe("mergeAdjacentTextItems", () => {
  it("returns the input as a fresh array when there is one item or fewer", () => {
    expect(mergeAdjacentTextItems([])).toEqual([]);
    const single = [createTextItem("hello", { bold: true })];
    const result = mergeAdjacentTextItems(single);
    expect(result).toEqual(single);
    expect(result).not.toBe(single);
  });

  it("merges two adjacent text items with equal attrs into one", () => {
    const items = [
      createTextItem("hel", { bold: true }),
      createTextItem("lo", { bold: true }),
    ];
    const result = mergeAdjacentTextItems(items);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "text", text: "hello", attrs: { bold: true } });
  });

  it("preserves two adjacent text items with different attrs", () => {
    const items = [
      createTextItem("hel", { bold: true }),
      createTextItem("lo", { italic: true }),
    ];
    const result = mergeAdjacentTextItems(items);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ text: "hel", attrs: { bold: true } });
    expect(result[1]).toMatchObject({ text: "lo", attrs: { italic: true } });
  });

  it("does not merge text items across an embed even when their attrs match", () => {
    const items = [
      createTextItem("a", { bold: true }),
      createEmbedItem("img"),
      createTextItem("b", { bold: true }),
    ];
    const result = mergeAdjacentTextItems(items);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ kind: "text", text: "a", attrs: { bold: true } });
    expect(result[1]).toMatchObject({ kind: "embed", embedType: "img" });
    expect(result[2]).toMatchObject({ kind: "text", text: "b", attrs: { bold: true } });
  });

  it("does not mutate the input array", () => {
    const items = [
      createTextItem("hel", { bold: true }),
      createTextItem("lo", { bold: true }),
    ];
    const before = items.slice();
    mergeAdjacentTextItems(items);
    expect(items).toEqual(before);
  });

  it("merges runs of three or more same-attrs text items into one", () => {
    const items = [
      createTextItem("a", { bold: true }),
      createTextItem("b", { bold: true }),
      createTextItem("c", { bold: true }),
    ];
    const result = mergeAdjacentTextItems(items);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "text", text: "abc", attrs: { bold: true } });
  });
});
