import { describe, it, expect } from "vitest";
import {
  createTextItem,
  createEmbedItem,
  createInlineContent,
  type TextItem,
  type EmbedItem,
  inlineContentLength,
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
