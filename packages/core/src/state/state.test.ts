import { describe, it, expect } from "vitest";
import { createState, getBlock, applyOperation, freshState, getBlockFromEither } from "./state";
import { runTransaction, getBlocksMap, getMetaMap } from "./yjs-doc";
import { buildYBlock } from "./y-block";
import type { BlockId } from "./block-id";
import { buildBlock, buildState, inlineContent, text } from "../test-utils/state-builders";
import { insertText } from "./insert-text";
import { applyAttrsToRange } from "./apply-attrs";
import { deleteRange } from "./delete-range";
import { replaceRange } from "./replace-range";
import { createPosition, createSpan } from "./block-position";

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

  it("returns the input state reference unchanged when the transaction is a no-op", () => {
    // Contract: when the closure produces no Y.Doc mutations (dirtyIds is
    // empty), `applyOperation` short-circuits and returns the literal input
    // State reference. Callers can then check `result.state === input.state`
    // as an O(1) "did anything change?" guard.
    const state = createState({ rootId: "root" as BlockId });
    const result = applyOperation(state, () => {
      /* no mutations */
    });
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
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

describe("applyOperation no-op invariant across ops", () => {
  // Per T7 step 7.3: every op that can produce a no-op input MUST return
  // `result.state === input.state` (reference equality) and an empty
  // dirtyIds set. Other ops (setBlockAttrs, setBlockType, insertBlock,
  // splitBlockAtPosition, removeBlock, mergeAdjacentBlocks,
  // clonePastedSubtree) don't have a natural no-op input — they always
  // mutate by construction — so they're not covered here.
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "p",
          lastChildId: "p",
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello world")]),
        }),
      ],
    });

  it("insertText with empty text is a no-op (preserves state identity)", () => {
    const state = fixture();
    const result = insertText(state, createPosition("p" as BlockId, 5), "", {});
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
  });

  it("applyAttrsToRange with empty attrs is a no-op (preserves state identity)", () => {
    const state = fixture();
    const span = createSpan(
      createPosition("p" as BlockId, 0),
      createPosition("p" as BlockId, 5),
    );
    const result = applyAttrsToRange(state, span, {});
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
  });

  it("deleteRange with a collapsed span is a no-op (preserves state identity)", () => {
    const state = fixture();
    const collapsed = createSpan(
      createPosition("p" as BlockId, 3),
      createPosition("p" as BlockId, 3),
    );
    const result = deleteRange(state, collapsed);
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
  });

  it("replaceRange with a collapsed span + empty text is a no-op (preserves state identity)", () => {
    const state = fixture();
    const collapsed = createSpan(
      createPosition("p" as BlockId, 3),
      createPosition("p" as BlockId, 3),
    );
    const result = replaceRange(state, collapsed, "", {});
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
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
