import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import {
  createYDoc,
  getBlocksMap,
  getTemplateContentsMap,
  runTransaction,
} from "./yjs-doc";
import {
  getBlockSnapshot,
  getTemplateContentSnapshot,
  invalidateSnapshot,
  invalidateAll,
  createSnapshotCache,
  createOverlayCache,
  compactCache,
} from "./snapshot";
import type { BlockId } from "./block-id";

function buildParagraphYBlock(text: string): Y.Map<unknown> {
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
  return yBlock;
}

function seedParagraphBlock(doc: Y.Doc, id: string, text: string): void {
  runTransaction(doc, () => {
    getBlocksMap(doc).set(id, buildParagraphYBlock(text));
  });
}

function seedTemplateBlock(doc: Y.Doc, id: string, text: string): void {
  runTransaction(doc, () => {
    getTemplateContentsMap(doc).set(id, buildParagraphYBlock(text));
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

  describe("overlay cache (S-A2)", () => {
    it("reads fall through from overlay to base", () => {
      const doc = createYDoc();
      seedParagraphBlock(doc, "p1", "hello");
      const base = createSnapshotCache();
      // Warm the base.
      const baseSnap = getBlockSnapshot(doc, "p1" as BlockId, base);
      expect(baseSnap).not.toBeNull();
      // New overlay on top of base. "p1" is NOT in the overlay's
      // invalidated set, so reads should fall through to base.
      const overlay = createOverlayCache(base, new Set());
      const snap = getBlockSnapshot(doc, "p1" as BlockId, overlay);
      expect(snap).toBe(baseSnap);
    });

    it("read on overlay promotes the entry from base into the overlay map", () => {
      const doc = createYDoc();
      seedParagraphBlock(doc, "p1", "hello");
      const base = createSnapshotCache();
      getBlockSnapshot(doc, "p1" as BlockId, base);
      const overlay = createOverlayCache(base, new Set());
      // Overlay starts with no own entries.
      expect(overlay.snapshots.block.size).toBe(0);
      getBlockSnapshot(doc, "p1" as BlockId, overlay);
      // After the read, the overlay holds the promoted entry too.
      expect(overlay.snapshots.block.size).toBe(1);
      expect(overlay.snapshots.block.get("p1" as BlockId)).toBe(
        base.snapshots.block.get("p1" as BlockId),
      );
    });

    it("invalidated ids skip the base fall-through and re-snapshot from the doc", () => {
      const doc = createYDoc();
      seedParagraphBlock(doc, "p1", "hello");
      const base = createSnapshotCache();
      const baseSnap = getBlockSnapshot(doc, "p1" as BlockId, base);
      // Mutate the Y.Doc under "p1" — base snap is now stale.
      runTransaction(doc, () => {
        const yBlock = getBlocksMap(doc).get("p1");
        if (yBlock === undefined) throw new Error("p1 vanished");
        yBlock.set("type", "heading");
      });
      // Overlay invalidates "p1" so it MUST not return the stale base snap.
      const overlay = createOverlayCache(
        base,
        new Set(["p1" as BlockId]),
      );
      const overlaySnap = getBlockSnapshot(doc, "p1" as BlockId, overlay);
      expect(overlaySnap).not.toBeNull();
      expect(overlaySnap).not.toBe(baseSnap);
      expect(overlaySnap?.type).toBe("heading");
      // The base cache itself is untouched (per-State view stability).
      expect(base.snapshots.block.get("p1" as BlockId)).toBe(baseSnap);
    });

    it("base remains untouched when overlay is read and mutated", () => {
      const doc = createYDoc();
      seedParagraphBlock(doc, "p1", "hello");
      seedParagraphBlock(doc, "p2", "world");
      const base = createSnapshotCache();
      const beforeP1 = getBlockSnapshot(doc, "p1" as BlockId, base);
      const overlay = createOverlayCache(
        base,
        new Set(["p2" as BlockId]),
      );
      getBlockSnapshot(doc, "p1" as BlockId, overlay);
      getBlockSnapshot(doc, "p2" as BlockId, overlay);
      // Base still has the original p1 entry, no p2 entry was added there.
      expect(base.snapshots.block.get("p1" as BlockId)).toBe(beforeP1);
      expect(base.snapshots.block.has("p2" as BlockId)).toBe(false);
    });

    it("depth-3 chain fall-through promotes the entry into every visited layer", () => {
      // Three-layer chain (root → L1 → L2). The entry lives in root only;
      // reading it from L2 should walk all the way down, then on the way
      // back promote the snapshot into L2 AND L1 so subsequent reads at
      // any layer are O(1).
      const doc = createYDoc();
      seedParagraphBlock(doc, "p1", "hello");
      const root = createSnapshotCache();
      const rootSnap = getBlockSnapshot(doc, "p1" as BlockId, root);
      expect(rootSnap).not.toBeNull();
      const l1 = createOverlayCache(root, new Set());
      const l2 = createOverlayCache(l1, new Set());
      expect(l1.snapshots.block.size).toBe(0);
      expect(l2.snapshots.block.size).toBe(0);
      const fromL2 = getBlockSnapshot(doc, "p1" as BlockId, l2);
      expect(fromL2).toBe(rootSnap);
      // Both intermediate layers received the promoted entry.
      expect(l1.snapshots.block.get("p1" as BlockId)).toBe(rootSnap);
      expect(l2.snapshots.block.get("p1" as BlockId)).toBe(rootSnap);
    });

    it("invalidateAll causes reads to re-snapshot for previously-cached ids", () => {
      const doc = createYDoc();
      seedParagraphBlock(doc, "p1", "hello");
      const base = createSnapshotCache();
      const beforeP1 = getBlockSnapshot(doc, "p1" as BlockId, base);
      const overlay = createOverlayCache(base, new Set());
      // Promote p1 into the overlay.
      getBlockSnapshot(doc, "p1" as BlockId, overlay);
      // Now mutate underlying Y.Doc and invalidate everything on the
      // overlay — subsequent reads must come from a fresh Y.Doc snapshot.
      runTransaction(doc, () => {
        const yBlock = getBlocksMap(doc).get("p1");
        if (yBlock === undefined) throw new Error("p1 vanished");
        yBlock.set("type", "heading");
      });
      invalidateAll(overlay);
      const afterP1 = getBlockSnapshot(doc, "p1" as BlockId, overlay);
      expect(afterP1).not.toBe(beforeP1);
      expect(afterP1?.type).toBe("heading");
      // Base is untouched; reading there still returns the original snap.
      expect(base.snapshots.block.get("p1" as BlockId)).toBe(beforeP1);
    });

    it("invalidateAll does not affect ids that were never cached anywhere", () => {
      // Pre-positioned API correctness: ids known only to Y.Doc (never
      // materialized in any cache layer) should read correctly after
      // invalidateAll, since invalidation only blocks fall-through for
      // ids the chain knows about.
      const doc = createYDoc();
      seedParagraphBlock(doc, "p1", "hello");
      const cache = createOverlayCache(createSnapshotCache(), new Set());
      invalidateAll(cache);
      const snap = getBlockSnapshot(doc, "p1" as BlockId, cache);
      expect(snap).not.toBeNull();
      expect(snap?.type).toBe("paragraph");
    });
  });

  // C.2a-T3: the templateContents dimension mirrors embedContents exactly.
  // Template bodies live in their own top-level Y.Map (getTemplateContentsMap)
  // and read through the same layered SnapshotCache via
  // getTemplateContentSnapshot.
  describe("getTemplateContentSnapshot", () => {
    it("(a) reuses the same snapshot reference when the underlying Y.Map is unchanged", () => {
      const doc = createYDoc();
      seedTemplateBlock(doc, "tmplP", "header");
      const cache = createSnapshotCache();
      const a = getTemplateContentSnapshot(doc, "tmplP" as BlockId, cache);
      const b = getTemplateContentSnapshot(doc, "tmplP" as BlockId, cache);
      expect(a).not.toBeNull();
      expect(a!.id).toBe("tmplP");
      expect(a).toBe(b);
    });

    it("returns null for an unknown template id", () => {
      const doc = createYDoc();
      const cache = createSnapshotCache();
      expect(
        getTemplateContentSnapshot(doc, "missing" as BlockId, cache),
      ).toBeNull();
    });

    it("(b) produces a fresh snapshot after invalidation reflecting a Y.Doc mutation", () => {
      const doc = createYDoc();
      seedTemplateBlock(doc, "tmplP", "header");
      const cache = createSnapshotCache();
      const a = getTemplateContentSnapshot(doc, "tmplP" as BlockId, cache);
      // Mutate the underlying template body Y.Map — `a` is now stale.
      runTransaction(doc, () => {
        const yBlock = getTemplateContentsMap(doc).get("tmplP");
        if (yBlock === undefined) throw new Error("tmplP vanished");
        yBlock.set("type", "heading");
      });
      invalidateSnapshot(cache, "tmplP" as BlockId);
      const b = getTemplateContentSnapshot(doc, "tmplP" as BlockId, cache);
      expect(b).not.toBe(a);
      expect(b!.id).toBe("tmplP");
      expect(b!.type).toBe("heading");
    });

    it("(c) template snapshot survives compaction when its id is NOT in dirtyIds", () => {
      const doc = createYDoc();
      seedTemplateBlock(doc, "tmplP", "header");
      seedTemplateBlock(doc, "other", "footer");
      // Build a multi-layer chain so compaction is non-trivial: read on a
      // chained overlay to populate a pre-compaction layer.
      const root = createSnapshotCache();
      const overlay = createOverlayCache(root, new Set());
      const first = getTemplateContentSnapshot(doc, "tmplP" as BlockId, overlay);
      expect(first).not.toBeNull();
      // Now compact with an UNRELATED dirty id; "tmplP" must be carried
      // into the compacted root cache and served WITHOUT touching the Y.Doc.
      const getSpy = vi.spyOn(getTemplateContentsMap(doc), "get");
      const compacted = compactCache(overlay, new Set(["other" as BlockId]));
      const second = getTemplateContentSnapshot(
        doc,
        "tmplP" as BlockId,
        compacted,
      );
      // Served from the compacted cache, not re-snapshotted from the Y.Doc.
      expect(getSpy).not.toHaveBeenCalled();
      expect(second).toBe(first);
      getSpy.mockRestore();
    });

    it("(d) compaction WITH the template id in dirtyIds re-snapshots on next read", () => {
      const doc = createYDoc();
      seedTemplateBlock(doc, "tmplP", "header");
      const root = createSnapshotCache();
      const overlay = createOverlayCache(root, new Set());
      const first = getTemplateContentSnapshot(doc, "tmplP" as BlockId, overlay);
      expect(first).not.toBeNull();
      const getSpy = vi.spyOn(getTemplateContentsMap(doc), "get");
      const compacted = compactCache(overlay, new Set(["tmplP" as BlockId]));
      const second = getTemplateContentSnapshot(
        doc,
        "tmplP" as BlockId,
        compacted,
      );
      // dirtyId ⊇ {tmplP} → the entry was dropped from the compacted cache,
      // so the next read re-snapshots from the Y.Doc.
      expect(getSpy).toHaveBeenCalled();
      expect(second).not.toBe(first);
      expect(second!.id).toBe("tmplP");
      getSpy.mockRestore();
    });

    it("invalidateAll causes template reads to re-snapshot for previously-cached ids", () => {
      const doc = createYDoc();
      seedTemplateBlock(doc, "tmplP", "header");
      const base = createSnapshotCache();
      const before = getTemplateContentSnapshot(doc, "tmplP" as BlockId, base);
      const overlay = createOverlayCache(base, new Set());
      // Promote tmplP into the overlay.
      getTemplateContentSnapshot(doc, "tmplP" as BlockId, overlay);
      runTransaction(doc, () => {
        const yBlock = getTemplateContentsMap(doc).get("tmplP");
        if (yBlock === undefined) throw new Error("tmplP vanished");
        yBlock.set("type", "heading");
      });
      invalidateAll(overlay);
      const after = getTemplateContentSnapshot(doc, "tmplP" as BlockId, overlay);
      expect(after).not.toBe(before);
      expect(after?.type).toBe("heading");
      // Base untouched (per-State view stability).
      expect(base.snapshots.template.get("tmplP" as BlockId)).toBe(before);
    });
  });
});
