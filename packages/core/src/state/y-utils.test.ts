import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { yMapAsObject, cloneInlineItem } from "./y-utils";

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
});
