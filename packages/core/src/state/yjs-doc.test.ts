import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  createYDoc,
  getBlocksMap,
  getEmbedContentsMap,
  getMetaMap,
  getYBlock,
  runTransaction,
  __getWalkStepsForTest,
  __resetWalkStepsForTest,
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

    it("amortizes parent-chain walks across changed Y types (S-A1)", () => {
      // Mutate text + attrs of many items across few blocks. Each item
      // contributes two entries to `changedParentTypes` whose walks all
      // share intermediate cursors (the item Y.Map, the inlineContent
      // Y.Array, the block Y.Map). Without per-transaction memoization
      // every changed Y type re-walks the full chain; with memoization
      // each cursor is visited at most once.
      const doc = createYDoc();
      const blocks = getBlocksMap(doc);

      const NUM_BLOCKS = 5;
      const ITEMS_PER_BLOCK = 10;
      const itemHandles: Array<{ text: Y.Text; attrs: Y.Map<unknown> }> = [];

      runTransaction(doc, () => {
        for (let b = 0; b < NUM_BLOCKS; b++) {
          const yBlock = new Y.Map<unknown>();
          const yArray = new Y.Array<Y.Map<unknown>>();
          for (let i = 0; i < ITEMS_PER_BLOCK; i++) {
            const yItem = new Y.Map<unknown>();
            const yText = new Y.Text();
            yText.insert(0, "hi");
            const yAttrs = new Y.Map<unknown>();
            yItem.set("text", yText);
            yItem.set("attrs", yAttrs);
            yArray.push([yItem]);
            itemHandles.push({ text: yText, attrs: yAttrs });
          }
          yBlock.set("inlineContent", yArray);
          blocks.set(`blk-${b}` as BlockId, yBlock);
        }
      });

      __resetWalkStepsForTest();
      const result = runTransaction(doc, () => {
        for (const { text, attrs } of itemHandles) {
          text.insert(0, "X");
          attrs.set("bold", true);
        }
      });

      // Correctness: exactly NUM_BLOCKS unique ids are dirty.
      expect(result.dirtyIds.size).toBe(NUM_BLOCKS);
      for (let b = 0; b < NUM_BLOCKS; b++) {
        expect(result.dirtyIds.has(`blk-${b}` as BlockId)).toBe(true);
      }

      // Empirical separation for this fixture (NUM_BLOCKS=5,
      // ITEMS_PER_BLOCK=10, mutating text + attrs of every item):
      //   memoized walk:    161 steps
      //   non-memoized walk: 566 steps
      // The 250-step threshold cleanly separates the two regimes. The
      // `> 0` lower bound guards against a silent regression in the
      // counter or in the memo plumbing that would suppress instrumentation
      // entirely and let `< 250` pass vacuously.
      const steps = __getWalkStepsForTest();
      expect(steps).toBeGreaterThan(0);
      expect(steps).toBeLessThan(250);
    });
  });

  describe("getYBlock", () => {
    it("returns the per-block Y.Map for a known id", () => {
      const doc = createYDoc();
      const yBlock = new Y.Map<unknown>();
      runTransaction(doc, () => {
        getBlocksMap(doc).set("p1", yBlock);
      });
      expect(getYBlock(doc, "p1" as BlockId, "test")).toBe(yBlock);
    });

    it("throws with op name when the id is missing", () => {
      const doc = createYDoc();
      expect(() => getYBlock(doc, "missing" as BlockId, "myOp")).toThrow(
        /myOp: block "missing" disappeared mid-transaction/,
      );
    });

    it("kind='embedContent' reads from the embedContents map", () => {
      const doc = createYDoc();
      const yBody = new Y.Map<unknown>();
      runTransaction(doc, () => {
        getEmbedContentsMap(doc).set("body-1", yBody);
      });
      expect(getYBlock(doc, "body-1" as BlockId, "test", "embedContent")).toBe(yBody);
    });
  });
});
