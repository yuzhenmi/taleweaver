import { describe, it, expect } from "vitest";
import {
  inlineContentLength,
  findItemAtOffset,
  mergeAdjacentTextItems,
  splitInlineContentAtOffset,
} from "./inline-content";
import { text, embed, inlineContent } from "../test-utils/state-builders";
import { AttrRegistry } from "../cascade/attr-registry";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

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

  // T32: out-of-range guard. The pre-T32 implementation silently treated
  // offset > inlineContentLength like offset === inlineContentLength (both
  // fell through to end-of-content). After T32, anything strictly past the
  // total throws. Negative offsets throw too. The exact equality case
  // (offset === inlineContentLength) must remain a legitimate end-of-block
  // position — this is what end-of-block splits rely on.
  it("throws when offset is strictly greater than the total length", () => {
    const c = inlineContent([text("abc")]);
    expect(() => findItemAtOffset(c, 100)).toThrow(/out of range \[0, 3\]/);
  });

  it("throws when offset is negative", () => {
    const c = inlineContent([text("abc")]);
    expect(() => findItemAtOffset(c, -1)).toThrow(/out of range \[0, 3\]/);
  });

  it("does NOT throw when offset equals total length (end-of-content)", () => {
    const c = inlineContent([text("abc")]);
    expect(findItemAtOffset(c, 3)).toEqual({ itemIndex: 1, withinItem: 0 });
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

  // T-C: registry threading. Custom-equals interpreters opt into per-key
  // equality semantics; mergeAdjacentTextItems must consult the registry so
  // adjacent text runs that the interpreter considers equal merge into one.
  describe("AttrRegistry opt-in equality (T-C)", () => {
    interface CommentAttr {
      readonly id: string;
      readonly timestamp: number;
    }

    function isCommentAttr(value: unknown): value is CommentAttr {
      return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { id?: unknown }).id === "string" &&
        typeof (value as { timestamp?: unknown }).timestamp === "number"
      );
    }

    function commentRegistry(): AttrRegistry {
      const r = new AttrRegistry();
      r.register({
        attrKey: "comment",
        toStyle: () => ({}),
        equals: (a, b) => {
          if (!isCommentAttr(a) || !isCommentAttr(b)) return false;
          return a.id === b.id;
        },
      });
      return r;
    }

    it("does NOT merge two text items with comment-id-equal-but-timestamp-different attrs WITHOUT a registry", () => {
      const items = [
        text("hel", { comment: { id: "c1", timestamp: 100 } }),
        text("lo", { comment: { id: "c1", timestamp: 200 } }),
      ];
      const result = mergeAdjacentTextItems(items);
      // Without registry → deep-equal sees timestamps differ → no merge.
      expect(result).toHaveLength(2);
    });

    it("MERGES two text items with comment-id-equal-but-timestamp-different attrs WHEN registry has custom equals", () => {
      const items = [
        text("hel", { comment: { id: "c1", timestamp: 100 } }),
        text("lo", { comment: { id: "c1", timestamp: 200 } }),
      ];
      const result = mergeAdjacentTextItems(items, commentRegistry());
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ kind: "text", text: "hello" });
      // Merged result keeps the FIRST run's attrs (the pending item) —
      // that's the existing mergeAdjacentTextItems contract.
      const merged = nth(result, 0, "merged item");
      if (merged.kind !== "text") throw new Error("expected text item");
      const attrs = merged.attrs.comment;
      if (!isCommentAttr(attrs)) throw new Error("expected comment attr");
      expect(attrs.id).toBe("c1");
      expect(attrs.timestamp).toBe(100);
    });

    it("still does NOT merge two text items with different comment ids", () => {
      const items = [
        text("hel", { comment: { id: "c1", timestamp: 100 } }),
        text("lo", { comment: { id: "c2", timestamp: 100 } }),
      ];
      const result = mergeAdjacentTextItems(items, commentRegistry());
      expect(result).toHaveLength(2);
    });
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

  // T32 defensive lock-in: the new out-of-range guard in findItemAtOffset
  // uses a STRICTLY GREATER check (offset > total), not >=. The exact
  // equality case (offset === inlineContentLength) must remain a valid
  // end-of-block split that yields [allItems, []]. If a future contributor
  // tightens the guard to `offset >= total`, this test fires.
  it("does NOT throw at offset === inlineContentLength (end-of-block split, T32)", () => {
    const content = inlineContent([text("abc")]);
    const [left, right] = splitInlineContentAtOffset(content, 3);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ kind: "text", text: "abc" });
    expect(right).toEqual([]);
  });
});
