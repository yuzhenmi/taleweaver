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

    // T39: read-path guard. Snapshot must reject nested Y types in embed
    // `properties`. Without this guard a nested Y.Map / Y.Text would leak
    // into the frozen snapshot as a live shared-type reference (mutating
    // it post-snapshot would silently mutate the "frozen" reference) and
    // would propagate to a foreign Y.Doc on cross-doc paste.
    function seedEmbedWithNestedProperty(
      doc: Y.Doc,
      id: string,
      nestedProperty: unknown,
    ): void {
      runTransaction(doc, () => {
        const blocks = getBlocksMap(doc);
        const yBlock = new Y.Map<unknown>();
        yBlock.set("type", "paragraph");
        yBlock.set("attrs", new Y.Map<unknown>());
        yBlock.set("parentId", null);
        yBlock.set("prevSiblingId", null);
        yBlock.set("nextSiblingId", null);
        yBlock.set("firstChildId", null);
        yBlock.set("lastChildId", null);
        const items = new Y.Array<Y.Map<unknown>>();
        const embedItem = new Y.Map<unknown>();
        embedItem.set("kind", "embed");
        embedItem.set("embedType", "image");
        embedItem.set("attrs", new Y.Map<unknown>());
        const yProps = new Y.Map<unknown>();
        yProps.set("nested", nestedProperty);
        embedItem.set("properties", yProps);
        items.push([embedItem]);
        yBlock.set("inlineContent", items);
        blocks.set(id, yBlock);
      });
    }

    it("throws on snapshot when embed properties contains a nested Y.Map", () => {
      const doc = createYDoc();
      seedEmbedWithNestedProperty(doc, "p1", new Y.Map<unknown>());
      const cache = createSnapshotCache();
      expect(() => getBlockSnapshot(doc, "p1" as BlockId, cache)).toThrow(
        /nested Y types are not allowed/i,
      );
    });

    it("throws on snapshot when embed properties contains a nested Y.Text", () => {
      const doc = createYDoc();
      seedEmbedWithNestedProperty(doc, "p1", new Y.Text());
      const cache = createSnapshotCache();
      expect(() => getBlockSnapshot(doc, "p1" as BlockId, cache)).toThrow(
        /nested Y types are not allowed/i,
      );
    });

    // T30: undefined-vs-null hardening. Yjs `Y.Map.get` returns
    // `undefined` for absent keys. Previously `?? null` widened undefined
    // to null silently, hiding malformed blocks; now every required field
    // is explicitly guarded.
    //
    // Helper seeds a block but skips setting one named field, then asserts
    // that getBlockSnapshot throws a clear error naming that field.
    function seedBlockMissingField(doc: Y.Doc, id: string, omit: string): void {
      runTransaction(doc, () => {
        const blocks = getBlocksMap(doc);
        const yBlock = new Y.Map<unknown>();
        if (omit !== "type") yBlock.set("type", "paragraph");
        if (omit !== "attrs") yBlock.set("attrs", new Y.Map<unknown>());
        if (omit !== "parentId") yBlock.set("parentId", null);
        if (omit !== "prevSiblingId") yBlock.set("prevSiblingId", null);
        if (omit !== "nextSiblingId") yBlock.set("nextSiblingId", null);
        if (omit !== "firstChildId") yBlock.set("firstChildId", null);
        if (omit !== "lastChildId") yBlock.set("lastChildId", null);
        if (omit !== "inlineContent") {
          const items = new Y.Array<Y.Map<unknown>>();
          yBlock.set("inlineContent", items);
        }
        blocks.set(id, yBlock);
      });
    }

    it("throws when block is missing required type field", () => {
      const doc = createYDoc();
      seedBlockMissingField(doc, "p1", "type");
      const cache = createSnapshotCache();
      expect(() => getBlockSnapshot(doc, "p1" as BlockId, cache)).toThrow(
        /missing required "type" field/,
      );
    });

    it("throws when block is missing required attrs field", () => {
      const doc = createYDoc();
      seedBlockMissingField(doc, "p1", "attrs");
      const cache = createSnapshotCache();
      expect(() => getBlockSnapshot(doc, "p1" as BlockId, cache)).toThrow(
        /missing required "attrs" field/,
      );
    });

    it("throws when block is missing required parentId field", () => {
      const doc = createYDoc();
      seedBlockMissingField(doc, "p1", "parentId");
      const cache = createSnapshotCache();
      expect(() => getBlockSnapshot(doc, "p1" as BlockId, cache)).toThrow(
        /missing required "parentId" field/,
      );
    });

    it("throws when block is missing required prevSiblingId field", () => {
      const doc = createYDoc();
      seedBlockMissingField(doc, "p1", "prevSiblingId");
      const cache = createSnapshotCache();
      expect(() => getBlockSnapshot(doc, "p1" as BlockId, cache)).toThrow(
        /missing required "prevSiblingId" field/,
      );
    });

    it("throws when block is missing required nextSiblingId field", () => {
      const doc = createYDoc();
      seedBlockMissingField(doc, "p1", "nextSiblingId");
      const cache = createSnapshotCache();
      expect(() => getBlockSnapshot(doc, "p1" as BlockId, cache)).toThrow(
        /missing required "nextSiblingId" field/,
      );
    });

    it("throws when block is missing required firstChildId field", () => {
      const doc = createYDoc();
      seedBlockMissingField(doc, "p1", "firstChildId");
      const cache = createSnapshotCache();
      expect(() => getBlockSnapshot(doc, "p1" as BlockId, cache)).toThrow(
        /missing required "firstChildId" field/,
      );
    });

    it("throws when block is missing required lastChildId field", () => {
      const doc = createYDoc();
      seedBlockMissingField(doc, "p1", "lastChildId");
      const cache = createSnapshotCache();
      expect(() => getBlockSnapshot(doc, "p1" as BlockId, cache)).toThrow(
        /missing required "lastChildId" field/,
      );
    });

    it("throws when block is missing required inlineContent field", () => {
      const doc = createYDoc();
      seedBlockMissingField(doc, "p1", "inlineContent");
      const cache = createSnapshotCache();
      expect(() => getBlockSnapshot(doc, "p1" as BlockId, cache)).toThrow(
        /missing required "inlineContent" field/,
      );
    });
  });
});
