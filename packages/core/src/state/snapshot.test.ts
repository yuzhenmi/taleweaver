import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createYDoc, getBlocksMap, runTransaction } from "./yjs-doc";
import {
  getBlockSnapshot,
  invalidateSnapshot,
  createSnapshotCache,
} from "./snapshot";
import type { BlockId } from "./block-id";

function seedParagraphBlock(doc: Y.Doc, id: string, text: string): void {
  runTransaction(doc, () => {
    const blocks = getBlocksMap(doc);
    const yBlock = new Y.Map<unknown>();
    yBlock.set("type", "paragraph");
    const attrs = new Y.Map();
    yBlock.set("attrs", attrs);
    yBlock.set("parentId", null);
    yBlock.set("prevSiblingId", null);
    yBlock.set("nextSiblingId", null);
    yBlock.set("firstChildId", null);
    yBlock.set("lastChildId", null);
    const items = new Y.Array<Y.Map<unknown>>();
    const textItem = new Y.Map<unknown>();
    textItem.set("kind", "text");
    const yText = new Y.Text();
    yText.insert(0, text);
    textItem.set("text", yText);
    textItem.set("attrs", new Y.Map());
    items.push([textItem]);
    yBlock.set("inlineContent", items);
    blocks.set(id, yBlock);
  });
}

describe("snapshot", () => {
  describe("getBlockSnapshot", () => {
    it("returns a frozen Block-shaped view of a Y.Map", () => {
      const doc = createYDoc();
      seedParagraphBlock(doc, "p1", "hello");
      const cache = createSnapshotCache();

      const snap = getBlockSnapshot(doc, "p1" as BlockId, cache);
      expect(snap).not.toBeNull();
      expect(snap!.id).toBe("p1");
      expect(snap!.type).toBe("paragraph");
      expect(snap!.parentId).toBeNull();
      expect(Object.isFrozen(snap)).toBe(true);
    });

    it("returns null for an unknown id", () => {
      const doc = createYDoc();
      const cache = createSnapshotCache();
      expect(getBlockSnapshot(doc, "missing" as BlockId, cache)).toBeNull();
    });

    it("reuses the same snapshot reference when the underlying Y.Map is unchanged", () => {
      const doc = createYDoc();
      seedParagraphBlock(doc, "p1", "hello");
      const cache = createSnapshotCache();
      const a = getBlockSnapshot(doc, "p1" as BlockId, cache);
      const b = getBlockSnapshot(doc, "p1" as BlockId, cache);
      expect(a).toBe(b);
    });

    it("produces a fresh snapshot after invalidation", () => {
      const doc = createYDoc();
      seedParagraphBlock(doc, "p1", "hello");
      const cache = createSnapshotCache();
      const a = getBlockSnapshot(doc, "p1" as BlockId, cache);
      invalidateSnapshot(cache, "p1" as BlockId);
      const b = getBlockSnapshot(doc, "p1" as BlockId, cache);
      expect(a).not.toBe(b);
      expect(b!.id).toBe("p1");
    });

    it("snapshot inlineContent reflects underlying Y.Text content", () => {
      const doc = createYDoc();
      seedParagraphBlock(doc, "p1", "hello");
      const cache = createSnapshotCache();
      const snap = getBlockSnapshot(doc, "p1" as BlockId, cache)!;
      expect(snap.inlineContent).not.toBeNull();
      expect(snap.inlineContent!.items.length).toBe(1);
      const item = snap.inlineContent!.items[0];
      expect(item.kind).toBe("text");
      if (item.kind === "text") {
        expect(item.text).toBe("hello");
      }
    });
  });
});
