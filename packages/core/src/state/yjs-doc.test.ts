import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  createYDoc,
  getBlocksMap,
  getEmbedContentsMap,
  getMetaMap,
  runTransaction,
} from "./yjs-doc";
import type { BlockId } from "./block-id";

describe("yjs-doc", () => {
  describe("createYDoc", () => {
    it("creates a Y.Doc with the three top-level maps", () => {
      const doc = createYDoc();
      expect(getBlocksMap(doc)).toBeInstanceOf(Y.Map);
      expect(getEmbedContentsMap(doc)).toBeInstanceOf(Y.Map);
      expect(getMetaMap(doc)).toBeInstanceOf(Y.Map);
    });

    it("seeds meta.rootId when provided", () => {
      const doc = createYDoc({ rootId: "root-1" as BlockId });
      expect(getMetaMap(doc).get("rootId")).toBe("root-1");
    });

    it("leaves meta.rootId unset when not provided", () => {
      const doc = createYDoc();
      expect(getMetaMap(doc).get("rootId")).toBeUndefined();
    });
  });

  describe("runTransaction", () => {
    it("executes the callback inside a Y.Doc transaction (mutations visible afterward)", () => {
      const doc = createYDoc();
      let called = false;
      runTransaction(doc, () => {
        called = true;
        getBlocksMap(doc).set("test", new Y.Map());
      });
      expect(called).toBe(true);
      expect(getBlocksMap(doc).has("test")).toBe(true);
    });

    it("returns the set of changed BlockIds (blocks map)", () => {
      const doc = createYDoc();
      const result = runTransaction(doc, () => {
        const blocks = getBlocksMap(doc);
        const yBlock = new Y.Map();
        yBlock.set("type", "paragraph");
        blocks.set("blk-1", yBlock);
      });
      expect(result.dirtyIds.has("blk-1" as BlockId)).toBe(true);
    });

    it("captures BlockId mutations inside a block's Y.Map as that block's dirtyId", () => {
      const doc = createYDoc();
      const blocks = getBlocksMap(doc);
      const yBlock = new Y.Map<unknown>();
      yBlock.set("type", "paragraph");
      yBlock.set("attrs", new Y.Map());
      runTransaction(doc, () => {
        blocks.set("blk-1", yBlock);
      });

      const result = runTransaction(doc, () => {
        (yBlock.get("attrs") as Y.Map<unknown>).set("bold", true);
      });
      expect(result.dirtyIds.has("blk-1" as BlockId)).toBe(true);
    });

    it("captures embed-content map mutations as dirty BlockIds", () => {
      const doc = createYDoc();
      const result = runTransaction(doc, () => {
        const embeds = getEmbedContentsMap(doc);
        const yBody = new Y.Map();
        yBody.set("type", "fn-body");
        embeds.set("body-1", yBody);
      });
      expect(result.dirtyIds.has("body-1" as BlockId)).toBe(true);
    });

    it("captures Y.Text mutation deep inside Y.Array inside block as the block's dirtyId", () => {
      const doc = createYDoc();
      const blocks = getBlocksMap(doc);
      const yBlock = new Y.Map<unknown>();
      const yArray = new Y.Array<Y.Map<unknown>>();
      const yItem = new Y.Map<unknown>();
      const yText = new Y.Text();
      yText.insert(0, "hello");
      yItem.set("text", yText);
      yArray.push([yItem]);
      yBlock.set("inlineContent", yArray);
      runTransaction(doc, () => {
        blocks.set("blk-1", yBlock);
      });

      const result = runTransaction(doc, () => {
        yText.insert(0, "X");
      });
      expect(result.dirtyIds.has("blk-1" as BlockId)).toBe(true);
    });

    it("captures block deletion as a dirtyId", () => {
      const doc = createYDoc();
      const blocks = getBlocksMap(doc);
      runTransaction(doc, () => {
        blocks.set("blk-1", new Y.Map());
      });
      const result = runTransaction(doc, () => {
        blocks.delete("blk-1");
      });
      expect(result.dirtyIds.has("blk-1" as BlockId)).toBe(true);
    });
  });
});
