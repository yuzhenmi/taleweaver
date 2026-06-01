import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  yMapAsObject,
  cloneInlineItem,
  mergeAdjacentSameAttrsTextItems,
} from "./y-utils";
import { buildYInlineItem } from "./y-block";

// Per the y-block.ts contract: detached Y types can't be read from in Yjs ^13.6.
// Attach to a throwaway Y.Doc before reading.
function attach<T extends Y.Map<unknown>>(yMap: T): T {
  const doc = new Y.Doc();
  doc.getMap("root").set("v", yMap);
  return yMap;
}

describe("y-utils", () => {
  describe("yMapAsObject", () => {
    it("returns a plain object snapshot of a Y.Map", () => {
      const yMap = attach(new Y.Map<unknown>());
      yMap.set("a", 1);
      yMap.set("b", "two");
      expect(yMapAsObject(yMap)).toEqual({ a: 1, b: "two" });
    });

    it("returns {} for an empty Y.Map", () => {
      const yMap = attach(new Y.Map<unknown>());
      expect(yMapAsObject(yMap)).toEqual({});
    });
  });

  describe("cloneInlineItem", () => {
    it("clones a text item with a fresh Y.Text", () => {
      const src = attach(new Y.Map<unknown>());
      src.set("kind", "text");
      const srcText = new Y.Text();
      src.set("text", srcText);
      srcText.insert(0, "hello");
      src.set("attrs", new Y.Map<unknown>());
      const clone = attach(cloneInlineItem(src));
      expect(clone.get("kind")).toBe("text");
      expect((clone.get("text") as Y.Text).toString()).toBe("hello");
      expect(clone.get("text")).not.toBe(srcText);
    });

    it("clones an embed item with fresh attrs and properties Y.Maps", () => {
      const src = attach(new Y.Map<unknown>());
      src.set("kind", "embed");
      src.set("embedType", "image");
      const srcAttrs = new Y.Map<unknown>();
      src.set("attrs", srcAttrs);
      const srcProps = new Y.Map<unknown>();
      src.set("properties", srcProps);
      srcProps.set("src", "/x");
      const clone = attach(cloneInlineItem(src));
      expect(clone.get("kind")).toBe("embed");
      expect(clone.get("embedType")).toBe("image");
      expect((clone.get("properties") as Y.Map<unknown>).get("src")).toBe("/x");
      expect(clone.get("attrs")).not.toBe(srcAttrs);
    });
  });

  describe("mergeAdjacentSameAttrsTextItems", () => {
    function makeArray(items: Y.Map<unknown>[]): Y.Array<Y.Map<unknown>> {
      const doc = new Y.Doc();
      const yItems = doc.getArray<Y.Map<unknown>>("items");
      yItems.push(items);
      return yItems;
    }

    function itemsAsTuples(
      yItems: Y.Array<Y.Map<unknown>>,
    ): Array<{ kind: string; text?: string; attrs?: Record<string, unknown> }> {
      const out: Array<{ kind: string; text?: string; attrs?: Record<string, unknown> }> = [];
      for (let i = 0; i < yItems.length; i++) {
        const item = yItems.get(i);
        const kind = item.get("kind") as string;
        if (kind === "text") {
          out.push({
            kind,
            text: (item.get("text") as Y.Text).toString(),
            attrs: yMapAsObject(item.get("attrs") as Y.Map<unknown>),
          });
        } else {
          out.push({ kind });
        }
      }
      return out;
    }

    it("merges two adjacent text items with equal attrs into one", () => {
      const yItems = makeArray([
        buildYInlineItem({ kind: "text", text: "hel", attrs: { bold: true } }),
        buildYInlineItem({ kind: "text", text: "lo", attrs: { bold: true } }),
      ]);
      mergeAdjacentSameAttrsTextItems(yItems);
      expect(itemsAsTuples(yItems)).toEqual([
        { kind: "text", text: "hello", attrs: { bold: true } },
      ]);
    });

    it("does not merge text items whose attrs differ", () => {
      const yItems = makeArray([
        buildYInlineItem({ kind: "text", text: "hel", attrs: { bold: true } }),
        buildYInlineItem({ kind: "text", text: "lo", attrs: { italic: true } }),
      ]);
      mergeAdjacentSameAttrsTextItems(yItems);
      expect(itemsAsTuples(yItems)).toEqual([
        { kind: "text", text: "hel", attrs: { bold: true } },
        { kind: "text", text: "lo", attrs: { italic: true } },
      ]);
    });

    it("does not merge across an embed (embed acts as barrier)", () => {
      const yItems = makeArray([
        buildYInlineItem({ kind: "text", text: "a", attrs: { bold: true } }),
        buildYInlineItem({ kind: "embed", embedType: "img", attrs: {}, properties: {} }),
        buildYInlineItem({ kind: "text", text: "b", attrs: { bold: true } }),
      ]);
      mergeAdjacentSameAttrsTextItems(yItems);
      expect(itemsAsTuples(yItems)).toEqual([
        { kind: "text", text: "a", attrs: { bold: true } },
        { kind: "embed" },
        { kind: "text", text: "b", attrs: { bold: true } },
      ]);
    });

    it("performs a cascading merge across three equal-attrs neighbors", () => {
      const yItems = makeArray([
        buildYInlineItem({ kind: "text", text: "a", attrs: {} }),
        buildYInlineItem({ kind: "text", text: "b", attrs: {} }),
        buildYInlineItem({ kind: "text", text: "c", attrs: {} }),
      ]);
      mergeAdjacentSameAttrsTextItems(yItems);
      expect(itemsAsTuples(yItems)).toEqual([
        { kind: "text", text: "abc", attrs: {} },
      ]);
    });

    it("is a no-op on an empty array or a singleton", () => {
      const empty = makeArray([]);
      mergeAdjacentSameAttrsTextItems(empty);
      expect(empty.length).toBe(0);

      const singleton = makeArray([
        buildYInlineItem({ kind: "text", text: "x", attrs: {} }),
      ]);
      mergeAdjacentSameAttrsTextItems(singleton);
      expect(itemsAsTuples(singleton)).toEqual([
        { kind: "text", text: "x", attrs: {} },
      ]);
    });

    it("drops a sole zero-length text item", () => {
      const yItems = makeArray([
        buildYInlineItem({ kind: "text", text: "", attrs: {} }),
      ]);
      mergeAdjacentSameAttrsTextItems(yItems);
      expect(itemsAsTuples(yItems)).toEqual([]);
    });

    it("drops a leading zero-length text item", () => {
      const yItems = makeArray([
        buildYInlineItem({ kind: "text", text: "", attrs: {} }),
        buildYInlineItem({ kind: "text", text: "a", attrs: {} }),
      ]);
      mergeAdjacentSameAttrsTextItems(yItems);
      expect(itemsAsTuples(yItems)).toEqual([
        { kind: "text", text: "a", attrs: {} },
      ]);
    });

    it("drops a trailing zero-length text item", () => {
      const yItems = makeArray([
        buildYInlineItem({ kind: "text", text: "a", attrs: {} }),
        buildYInlineItem({ kind: "text", text: "", attrs: {} }),
      ]);
      mergeAdjacentSameAttrsTextItems(yItems);
      expect(itemsAsTuples(yItems)).toEqual([
        { kind: "text", text: "a", attrs: {} },
      ]);
    });

    it("drops an empty bridge text item, allowing the two same-attrs neighbors to merge", () => {
      const yItems = makeArray([
        buildYInlineItem({ kind: "text", text: "a", attrs: { bold: true } }),
        buildYInlineItem({ kind: "text", text: "", attrs: {} }),
        buildYInlineItem({ kind: "text", text: "b", attrs: { bold: true } }),
      ]);
      mergeAdjacentSameAttrsTextItems(yItems);
      expect(itemsAsTuples(yItems)).toEqual([
        { kind: "text", text: "ab", attrs: { bold: true } },
      ]);
    });

    it("drops an empty text item between an embed and a text item without breaking embed barrier", () => {
      const yItems = makeArray([
        buildYInlineItem({ kind: "text", text: "a", attrs: { bold: true } }),
        buildYInlineItem({ kind: "embed", embedType: "img", attrs: {}, properties: {} }),
        buildYInlineItem({ kind: "text", text: "", attrs: { bold: true } }),
        buildYInlineItem({ kind: "text", text: "b", attrs: { bold: true } }),
      ]);
      mergeAdjacentSameAttrsTextItems(yItems);
      expect(itemsAsTuples(yItems)).toEqual([
        { kind: "text", text: "a", attrs: { bold: true } },
        { kind: "embed" },
        { kind: "text", text: "b", attrs: { bold: true } },
      ]);
    });

    it("drops an empty text item between two embeds without merging the embeds", () => {
      const yItems = makeArray([
        buildYInlineItem({ kind: "embed", embedType: "img1", attrs: {}, properties: {} }),
        buildYInlineItem({ kind: "text", text: "", attrs: {} }),
        buildYInlineItem({ kind: "embed", embedType: "img2", attrs: {}, properties: {} }),
      ]);
      mergeAdjacentSameAttrsTextItems(yItems);
      expect(itemsAsTuples(yItems)).toEqual([
        { kind: "embed" },
        { kind: "embed" },
      ]);
    });
  });
});
