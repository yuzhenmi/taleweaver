import { describe, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { createYDoc, runTransaction } from "./yjs-doc";
import { getRegistry } from "./registry";
import { blockText } from "./block-text";
import { DOCUMENT_INTERNAL } from "./document-internal";
import { buildBlock, buildDocument, inlineContent, text } from "../test-utils/document-builders";
import {
  getBlockSnapshot,
  getTemplateContentSnapshot,
  createSnapshotCache,
  createOverlayCache,
  compactCache,
} from "./snapshot";
import type { BlockId } from "./block-id";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/** doc > p1 "hello", p2 "world"; template bodies tmplP > hp "header", other > op "footer". */
function seedDoc(): Y.Doc {
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
      buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
      buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("world")]) }),
    ],
    templateContents: [
      buildBlock({ id: "tmplP", type: "header-body", firstChildId: "hp", lastChildId: "hp" }),
      buildBlock({ id: "hp", type: "paragraph", parentId: "tmplP", inlineContent: inlineContent([text("header")]) }),
      buildBlock({ id: "other", type: "footer-body", firstChildId: "op", lastChildId: "op" }),
      buildBlock({ id: "op", type: "paragraph", parentId: "other", inlineContent: inlineContent([text("footer")]) }),
    ],
  })[DOCUMENT_INTERNAL].doc;
}

/** Retype block `id` directly in its registry entry (a raw Y.Doc mutation). */
function retype(doc: Y.Doc, id: string, type: string): void {
  runTransaction(doc, () => {
    const entry = getRegistry(doc).get(id);
    if (entry === undefined) throw new Error(`${id} vanished`);
    entry.set("type", type);
  });
}

describe("snapshot", () => {
  describe("getBlockSnapshot", () => {
    it("returns a frozen Block-shaped view of a registry entry", () => {
      const doc = seedDoc();
      const cache = createSnapshotCache();

      const snap = getBlockSnapshot(doc, "p1" as BlockId, cache);
      expect(snap).not.toBeNull();
      expect(snap!.id).toBe("p1");
      expect(snap!.type).toBe("paragraph");
      // The parent of a section-less document's block is the root's final section.
      expect(snap!.parentId).toBe(getBlockSnapshot(doc, "doc" as BlockId, cache)?.firstChildId);
      expect(Object.isFrozen(snap)).toBe(true);
    });

    it("returns null for an unknown id", () => {
      const doc = createYDoc();
      const cache = createSnapshotCache();
      expect(getBlockSnapshot(doc, "missing" as BlockId, cache)).toBeNull();
    });

    it("reuses the same snapshot reference when the underlying Y.Map is unchanged", () => {
      const doc = seedDoc();
      const cache = createSnapshotCache();
      const a = getBlockSnapshot(doc, "p1" as BlockId, cache);
      const b = getBlockSnapshot(doc, "p1" as BlockId, cache);
      expect(a).toBe(b);
    });

    it("produces a fresh snapshot after invalidation (via the production overlay path)", () => {
      // Production drives invalidation through createOverlayCache: a new
      // Document minted by applyOperation/freshDocument carries an overlay whose
      // `invalidated` set contains the dirty ids. The next read of an
      // invalidated id skips fall-through and re-snapshots from the Y.Doc.
      const doc = seedDoc();
      const base = createSnapshotCache();
      const a = getBlockSnapshot(doc, "p1" as BlockId, base);
      // Mint a fresh overlay with "p1" in the dirty set (the production
      // post-mutation handoff), then read through it.
      const overlay = createOverlayCache(base, new Set(["p1" as BlockId]));
      const b = getBlockSnapshot(doc, "p1" as BlockId, overlay);
      expect(a).not.toBe(b);
      expect(b!.id).toBe("p1");
      // Equal value (the Y.Doc was unchanged) — a fresh frozen ref, not the
      // stale cached one.
      expect(b!.type).toBe(a!.type);
    });

    it("snapshot inlineContent reflects underlying Y.Text content", () => {
      const doc = seedDoc();
      const cache = createSnapshotCache();
      const snap = getBlockSnapshot(doc, "p1" as BlockId, cache)!;
      expect(snap.inlineContent).not.toBeNull();
      expect(snap.inlineContent!.items.length).toBe(1);
      const item = nth(snap.inlineContent!.items, 0, "inline item");
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
    function seedEmbedWithNestedProperty(nestedProperty: unknown): Y.Doc {
      const doc = seedDoc();
      runTransaction(doc, () => {
        const t = blockText(doc, "p1");
        if (t === null) throw new Error("p1 has no text");
        // A raw (peer-style) embed write bypassing the builders.
        t.insertEmbed(0, { embedType: "image", properties: { nested: nestedProperty } });
      });
      return doc;
    }

    it("throws on snapshot when embed properties contains a nested Y.Map", () => {
      const doc = seedEmbedWithNestedProperty(new Y.Map<unknown>());
      const cache = createSnapshotCache();
      expect(() => getBlockSnapshot(doc, "p1" as BlockId, cache)).toThrow(
        /nested Y types are not allowed/i,
      );
    });

    it("throws on snapshot when embed properties contains a nested Y.Text", () => {
      const doc = seedEmbedWithNestedProperty(new Y.Text());
      const cache = createSnapshotCache();
      expect(() => getBlockSnapshot(doc, "p1" as BlockId, cache)).toThrow(
        /nested Y types are not allowed/i,
      );
    });
  });

  // A11: inline storage guards. The read model rejects malformed inline storage
  // with a clear error instead of silently coercing it into the snapshot: an
  // embed that is not `{ embedType, properties }`, and the legacy run-array shape
  // (a typed LegacyDocumentError — no read path parses legacy storage).
  describe("inline storage guards (A11)", () => {
    it("throws when an embed is missing embedType", () => {
      const doc = seedDoc();
      runTransaction(doc, () => blockText(doc, "p1")?.insertEmbed(0, { properties: {} }));
      expect(() => getBlockSnapshot(doc, "p1" as BlockId, createSnapshotCache())).toThrow(
        /malformed embed/,
      );
    });

    it("accepts a well-formed text + embed inline content", () => {
      const doc = seedDoc();
      runTransaction(doc, () => blockText(doc, "p1")?.insertEmbed(0, { embedType: "image", properties: {} }));
      expect(() => getBlockSnapshot(doc, "p1" as BlockId, createSnapshotCache())).not.toThrow();
    });
  });

  describe("overlay cache (S-A2)", () => {
    it("reads fall through from overlay to base", () => {
      const doc = seedDoc();
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
      const doc = seedDoc();
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
      const doc = seedDoc();
      const base = createSnapshotCache();
      const baseSnap = getBlockSnapshot(doc, "p1" as BlockId, base);
      // Mutate the Y.Doc under "p1" — base snap is now stale.
      retype(doc, "p1", "heading");
      // Overlay invalidates "p1" so it MUST not return the stale base snap.
      const overlay = createOverlayCache(
        base,
        new Set(["p1" as BlockId]),
      );
      const overlaySnap = getBlockSnapshot(doc, "p1" as BlockId, overlay);
      expect(overlaySnap).not.toBeNull();
      expect(overlaySnap).not.toBe(baseSnap);
      expect(overlaySnap?.type).toBe("heading");
      // The base cache itself is untouched (per-Document view stability).
      expect(base.snapshots.block.get("p1" as BlockId)).toBe(baseSnap);
    });

    it("base remains untouched when overlay is read and mutated", () => {
      const doc = seedDoc();
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
      const doc = seedDoc();
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

  });

  // Template bodies read through the same layered SnapshotCache via
  // getTemplateContentSnapshot.
  describe("getTemplateContentSnapshot", () => {
    it("(a) reuses the same snapshot reference when the underlying Y.Map is unchanged", () => {
      const doc = seedDoc();
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

    it("(b) produces a fresh snapshot after invalidation reflecting a Y.Doc mutation (via the production overlay path)", () => {
      const doc = seedDoc();
      const base = createSnapshotCache();
      const a = getTemplateContentSnapshot(doc, "tmplP" as BlockId, base);
      // Mutate the underlying template body Y.Map — `a` is now stale.
      retype(doc, "tmplP", "footer-body");
      // Production handoff: a fresh overlay with the mutated id in its dirty
      // set forces a re-snapshot on the next read.
      const overlay = createOverlayCache(base, new Set(["tmplP" as BlockId]));
      const b = getTemplateContentSnapshot(doc, "tmplP" as BlockId, overlay);
      expect(b).not.toBe(a);
      expect(b!.id).toBe("tmplP");
      expect(b!.type).toBe("footer-body");
    });

    it("(c) template snapshot survives compaction when its id is NOT in dirtyIds", () => {
      const doc = seedDoc();
      // Build a multi-layer chain so compaction is non-trivial: read on a
      // chained overlay to populate a pre-compaction layer.
      const root = createSnapshotCache();
      const overlay = createOverlayCache(root, new Set());
      const first = getTemplateContentSnapshot(doc, "tmplP" as BlockId, overlay);
      expect(first).not.toBeNull();
      // Now compact with an UNRELATED dirty id; "tmplP" must be carried
      // into the compacted root cache and served WITHOUT touching the Y.Doc.
      const getSpy = vi.spyOn(getRegistry(doc), "get");
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
      const doc = seedDoc();
      const root = createSnapshotCache();
      const overlay = createOverlayCache(root, new Set());
      const first = getTemplateContentSnapshot(doc, "tmplP" as BlockId, overlay);
      expect(first).not.toBeNull();
      const getSpy = vi.spyOn(getRegistry(doc), "get");
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

  });
});
