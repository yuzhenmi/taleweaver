import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { buildYBlock, type YBlockInit } from "./y-block";
import { getBlockSnapshot, createSnapshotCache } from "./snapshot";
import { getBlocksMap, runTransaction, createYDoc } from "./yjs-doc";
import { BLOCK_FIELDS } from "./block-schema";
import type { Block } from "./block";
import type { BlockId } from "./block-id";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/**
 * T16 roundtrip test: every keyof Block (except `id`, which is the outer
 * Y.Map key, not a field on the inner map) must be carried through both
 * write (buildYBlock) and read (buildBlockSnapshot) paths.
 *
 * If a Block field is added but only one path is updated, the roundtrip
 * either throws at read time (missing field) or loses the value silently.
 * The BLOCK_FIELDS catalog gives a compile-time guarantee that both
 * paths reference the same list; this test guarantees the per-kind
 * dispatch on each side handles the field equivalently.
 */
describe("block-schema BLOCK_FIELDS roundtrip", () => {
  it("declares every Block field except `id`", () => {
    const declared = new Set<string>(BLOCK_FIELDS.map((f) => f.key));
    // Sanity: catalog is non-empty and stable.
    expect(declared.size).toBe(BLOCK_FIELDS.length);
    // `id` MUST NOT be in the catalog — it's the outer Y.Map key.
    expect(declared.has("id" satisfies keyof Block)).toBe(false);
  });

  it("roundtrips a leaf paragraph block with rich inlineContent", () => {
    const init: YBlockInit = {
      type: "paragraph",
      attrs: { align: "left", indent: 2 },
      parentId: "section-1" as BlockId,
      prevSiblingId: "p0" as BlockId,
      nextSiblingId: "p2" as BlockId,
      firstChildId: null,
      lastChildId: null,
      inlineContent: {
        items: [
          { kind: "text", text: "hello ", attrs: { bold: true } },
          {
            kind: "embed",
            embedType: "image",
            attrs: {},
            properties: { src: "x.png" },
          },
          { kind: "text", text: " world", attrs: {} },
        ],
      },
    };
    const doc = createYDoc();
    runTransaction(doc, () => {
      getBlocksMap(doc).set("p1", buildYBlock(init));
    });
    const cache = createSnapshotCache();
    const b = getBlockSnapshot(doc, "p1" as BlockId, cache);
    if (b === null) throw new Error("expected snapshot for p1");

    expect(b.id).toBe("p1");
    expect(b.type).toBe(init.type);
    expect(b.attrs).toEqual(init.attrs);
    expect(b.parentId).toBe(init.parentId);
    expect(b.prevSiblingId).toBe(init.prevSiblingId);
    expect(b.nextSiblingId).toBe(init.nextSiblingId);
    expect(b.firstChildId).toBe(init.firstChildId);
    expect(b.lastChildId).toBe(init.lastChildId);
    if (b.inlineContent === null) throw new Error("expected inlineContent");
    expect(b.inlineContent.items.length).toBe(3);
    const first = nth(b.inlineContent.items, 0, "inline item");
    expect(first.kind).toBe("text");
    if (first.kind === "text") {
      expect(first.text).toBe("hello ");
      expect(first.attrs).toEqual({ bold: true });
    }
    const second = nth(b.inlineContent.items, 1, "inline item");
    expect(second.kind).toBe("embed");
    if (second.kind === "embed") {
      expect(second.embedType).toBe("image");
      expect(second.properties).toEqual({ src: "x.png" });
    }
  });

  it("roundtrips a container block with null inlineContent and child pointers", () => {
    const init: YBlockInit = {
      type: "section",
      attrs: {},
      parentId: null,
      prevSiblingId: null,
      nextSiblingId: null,
      firstChildId: "p1" as BlockId,
      lastChildId: "p3" as BlockId,
      inlineContent: null,
    };
    const doc = createYDoc();
    runTransaction(doc, () => {
      getBlocksMap(doc).set("s1", buildYBlock(init));
    });
    const cache = createSnapshotCache();
    const b = getBlockSnapshot(doc, "s1" as BlockId, cache);
    if (b === null) throw new Error("expected snapshot for s1");

    expect(b.id).toBe("s1");
    expect(b.type).toBe("section");
    expect(b.attrs).toEqual({});
    expect(b.parentId).toBeNull();
    expect(b.prevSiblingId).toBeNull();
    expect(b.nextSiblingId).toBeNull();
    expect(b.firstChildId).toBe("p1");
    expect(b.lastChildId).toBe("p3");
    expect(b.inlineContent).toBeNull();
  });

  // Drift sentinel: if a future change adds a Block field and only updates
  // one of the read/write paths, the roundtrip on that field breaks. The
  // sentinel iterates BLOCK_FIELDS to make sure the catalog matches the
  // snapshot shape, so an out-of-sync read path is loud.
  it("every BLOCK_FIELDS entry maps to a defined snapshot field", () => {
    const init: YBlockInit = {
      type: "paragraph",
      attrs: { x: 1 },
      parentId: null,
      prevSiblingId: null,
      nextSiblingId: null,
      firstChildId: null,
      lastChildId: null,
      inlineContent: { items: [] },
    };
    const doc = createYDoc();
    runTransaction(doc, () => {
      getBlocksMap(doc).set("p1", buildYBlock(init));
    });
    const cache = createSnapshotCache();
    const snap = getBlockSnapshot(doc, "p1" as BlockId, cache);
    if (snap === null) throw new Error("expected snapshot for p1");
    const b = snap as unknown as Record<string, unknown>;
    for (const spec of BLOCK_FIELDS) {
      // The snapshot must have the key — `null` is OK, `undefined` is not.
      expect(spec.key in b).toBe(true);
      expect(b[spec.key]).not.toBeUndefined();
    }
  });

  it("Y.Map written by buildYBlock contains every BLOCK_FIELDS key", () => {
    const init: YBlockInit = {
      type: "paragraph",
      attrs: {},
      parentId: null,
      prevSiblingId: null,
      nextSiblingId: null,
      firstChildId: null,
      lastChildId: null,
      inlineContent: null,
    };
    const doc = createYDoc();
    runTransaction(doc, () => {
      getBlocksMap(doc).set("p1", buildYBlock(init));
    });
    const yBlock = getBlocksMap(doc).get("p1") as Y.Map<unknown>;
    for (const spec of BLOCK_FIELDS) {
      expect(yBlock.has(spec.key)).toBe(true);
    }
  });
});
