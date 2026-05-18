import { describe, it, expect } from "vitest";
import { createState, getBlock, applyOperation, freshState, getBlockFromEither } from "./state";
import { runTransaction, getBlocksMap, getMetaMap } from "./yjs-doc";
import { buildYBlock } from "./y-block";
import type { BlockId } from "./block-id";
import { buildBlock, buildState, inlineContent, text } from "../test-utils/state-builders";

describe("state", () => {
  it("createState produces a State with a Y.Doc-backed root", () => {
    const state = createState({ rootId: "root" as BlockId });
    expect(state.rootId).toBe("root");
  });

  it("getBlock returns null for unknown ids", () => {
    const state = createState({ rootId: "root" as BlockId });
    expect(getBlock(state, "missing" as BlockId)).toBeNull();
  });

  it("getBlock returns a frozen Block snapshot for known ids", () => {
    const state = createState({ rootId: "root" as BlockId });
    runTransaction(state.doc, () => {
      const blocks = getBlocksMap(state.doc);
      blocks.set("root", buildYBlock({
        type: "document",
        attrs: {},
        parentId: null,
        prevSiblingId: null,
        nextSiblingId: null,
        firstChildId: null,
        lastChildId: null,
        inlineContent: null,
      }));
    });
    const snap = getBlock(state, "root" as BlockId);
    expect(snap).not.toBeNull();
    expect(snap!.type).toBe("document");
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it("rootId is read from meta map", () => {
    const state = createState({ rootId: "root-99" as BlockId });
    expect(getMetaMap(state.doc).get("rootId")).toBe("root-99");
  });
});

describe("applyOperation", () => {
  it("runs fn in a transaction and returns OperationResult with dirtyIds", () => {
    const state = createState({ rootId: "root" as BlockId });
    const result = applyOperation(state, () => {
      const blocks = getBlocksMap(state.doc);
      blocks.set("p1", buildYBlock({
        type: "paragraph",
        attrs: {},
        parentId: "root" as BlockId,
        prevSiblingId: null,
        nextSiblingId: null,
        firstChildId: null,
        lastChildId: null,
        inlineContent: { items: [] },
      }));
    });
    expect(result.dirtyIds.has("p1" as BlockId)).toBe(true);
    expect(getBlock(result.state, "p1" as BlockId)).not.toBeNull();
  });

  it("produces a State with a fresh SnapshotCache (snapshots reflect post-mutation state)", () => {
    const state = createState({ rootId: "root" as BlockId });
    applyOperation(state, () => {
      const blocks = getBlocksMap(state.doc);
      blocks.set("p1", buildYBlock({
        type: "paragraph",
        attrs: {},
        parentId: null,
        prevSiblingId: null,
        nextSiblingId: null,
        firstChildId: null,
        lastChildId: null,
        inlineContent: { items: [] },
      }));
    });
    const result = applyOperation(state, () => {
      const blocks = getBlocksMap(state.doc);
      const yBlock = blocks.get("p1")!;
      yBlock.set("type", "heading");
    });
    expect(getBlock(result.state, "p1" as BlockId)?.type).toBe("heading");
  });

  it("freshState returns a State referencing the same Y.Doc with a clean cache", () => {
    const state = createState({ rootId: "root" as BlockId });
    const next = freshState(state);
    expect(next.doc).toBe(state.doc);
    expect(next.rootId).toBe(state.rootId);
    expect(next.snapshotCache).not.toBe(state.snapshotCache);
  });

  it("preserves snapshot reference identity for unchanged blocks across applyOperation", () => {
    const state = createState({ rootId: "root" as BlockId });
    applyOperation(state, () => {
      const blocks = getBlocksMap(state.doc);
      blocks.set("root", buildYBlock({
        type: "document",
        attrs: {},
        parentId: null,
        prevSiblingId: null,
        nextSiblingId: null,
        firstChildId: "p1" as BlockId,
        lastChildId: "p1" as BlockId,
        inlineContent: null,
      }));
      blocks.set("p1", buildYBlock({
        type: "paragraph",
        attrs: {},
        parentId: "root" as BlockId,
        prevSiblingId: null,
        nextSiblingId: null,
        firstChildId: null,
        lastChildId: null,
        inlineContent: { items: [] },
      }));
    });
    // Materialize snapshots into the cache.
    const rootBefore = getBlock(state, "root" as BlockId);
    const p1Before = getBlock(state, "p1" as BlockId);
    // Run an op that only touches p1.
    const result = applyOperation(state, () => {
      const yP1 = getBlocksMap(state.doc).get("p1")!;
      yP1.set("type", "heading");
    });
    // root is unchanged → identity preserved.
    expect(getBlock(result.state, "root" as BlockId)).toBe(rootBefore);
    // p1 was dirtied → fresh snapshot.
    expect(getBlock(result.state, "p1" as BlockId)).not.toBe(p1Before);
    expect(result.dirtyIds.has("p1" as BlockId)).toBe(true);
  });
});

describe("getBlockFromEither", () => {
  it("returns blocks from the main tree", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
    });
    const block = getBlockFromEither(state, "root" as BlockId);
    expect(block?.type).toBe("document");
  });

  it("returns blocks from the embedContents map", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      embedContents: [
        buildBlock({
          id: "fn-body-1",
          type: "fn-body",
          inlineContent: inlineContent([text("note")]),
        }),
      ],
    });
    const body = getBlockFromEither(state, "fn-body-1" as BlockId);
    expect(body?.type).toBe("fn-body");
  });

  it("returns null when the id is in neither map", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
    });
    expect(getBlockFromEither(state, "missing" as BlockId)).toBeNull();
  });

  it("prefers the main tree if an id collision somehow exists (defensive)", () => {
    // Allocator should prevent this, but if it ever happens we return the main-tree block.
    const state = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "document" }),
        buildBlock({ id: "dup-id", type: "paragraph", parentId: "root" }),
      ],
      embedContents: [
        buildBlock({ id: "dup-id", type: "fn-body" }),
      ],
    });
    const block = getBlockFromEither(state, "dup-id" as BlockId);
    expect(block?.type).toBe("paragraph");
  });
});
