import { describe, it, expect } from "vitest";
import { createState, getBlock, applyOperation, freshState } from "./state";
import { runTransaction, getBlocksMap, getMetaMap } from "./yjs-doc";
import { buildYBlock } from "./y-block";
import type { BlockId } from "./block-id";

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
});
