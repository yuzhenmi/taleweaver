import { describe, it, expect } from "vitest";
import {
  createState,
  getBlock,
  applyOperation,
  freshState,
  getBlockFromEither,
  getEmbedContentIds,
} from "./state";
import { createEmptyDocument } from "./initial-state";
import { runTransaction, getBlocksMap, getMetaMap } from "./yjs-doc";
import { buildYBlock } from "./y-block";
import type { BlockId } from "./block-id";
import { buildBlock, buildState, inlineContent, text } from "../test-utils/state-builders";
import { insertText } from "./insert-text";
import { applyAttrsToRange } from "./apply-attrs";
import { deleteRange } from "./delete-range";
import { replaceRange } from "./replace-range";
import { createPosition, createSpan } from "./block-position";
import { STATE_INTERNAL } from "./state-internal";

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
    runTransaction(state[STATE_INTERNAL].doc, () => {
      const blocks = getBlocksMap(state[STATE_INTERNAL].doc);
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
    expect(getMetaMap(state[STATE_INTERNAL].doc).get("rootId")).toBe("root-99");
  });
});

describe("applyOperation", () => {
  it("runs fn in a transaction and returns OperationResult with dirtyIds", () => {
    const state = createState({ rootId: "root" as BlockId });
    const result = applyOperation(state, () => {
      const blocks = getBlocksMap(state[STATE_INTERNAL].doc);
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
      const blocks = getBlocksMap(state[STATE_INTERNAL].doc);
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
      const blocks = getBlocksMap(state[STATE_INTERNAL].doc);
      const yBlock = blocks.get("p1")!;
      yBlock.set("type", "heading");
    });
    expect(getBlock(result.state, "p1" as BlockId)?.type).toBe("heading");
  });

  it("freshState returns a State referencing the same Y.Doc with a clean cache", () => {
    const state = createState({ rootId: "root" as BlockId });
    const next = freshState(state);
    expect(next[STATE_INTERNAL].doc).toBe(state[STATE_INTERNAL].doc);
    expect(next.rootId).toBe(state.rootId);
    expect(next[STATE_INTERNAL].snapshotCache).not.toBe(state[STATE_INTERNAL].snapshotCache);
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

  it("applyOperation creates an empty overlay layer instead of carrying forward N cached entries (S-A2)", () => {
    // The carry-forward path before S-A2 copied every non-dirty entry
    // from the input cache into a fresh map — O(N_cached) per mutation.
    // With overlay caching, the new cache starts empty and lazily falls
    // through to the input cache (its base), so this allocation cost is
    // O(dirtyIds.size) regardless of how many blocks the input cache
    // had warmed up.
    const NUM_BLOCKS = 100;
    const state = createState({ rootId: "root" as BlockId });
    applyOperation(state, () => {
      const blocks = getBlocksMap(state[STATE_INTERNAL].doc);
      for (let i = 0; i < NUM_BLOCKS; i++) {
        blocks.set(`b${i}`, buildYBlock({
          type: "paragraph",
          attrs: {},
          parentId: null,
          prevSiblingId: null,
          nextSiblingId: null,
          firstChildId: null,
          lastChildId: null,
          inlineContent: { items: [] },
        }));
      }
    });
    // freshState the cache so all ids are uncached, then warm.
    const warm = freshState(state);
    for (let i = 0; i < NUM_BLOCKS; i++) {
      getBlock(warm, `b${i}` as BlockId);
    }
    expect(warm[STATE_INTERNAL].snapshotCache.blocks.size).toBe(NUM_BLOCKS);

    // Mutate a single block.
    const tiny = applyOperation(warm, () => {
      const yBlock = getBlocksMap(warm[STATE_INTERNAL].doc).get("b0")!;
      yBlock.set("type", "heading");
    });
    expect(tiny.dirtyIds.size).toBe(1);

    const newCache = tiny.state[STATE_INTERNAL].snapshotCache;
    // The new overlay starts empty — no entries carried forward.
    expect(newCache.blocks.size).toBe(0);
    expect(newCache.embedContents.size).toBe(0);
    // The dirty block is invalidated on this layer so reads don't fall
    // through to the stale base entry.
    expect(newCache.invalidatedBlocks.has("b0" as BlockId)).toBe(true);
    // Base reference points to the warmed cache.
    expect(newCache.base).toBe(warm[STATE_INTERNAL].snapshotCache);

    // Reads still resolve correctly.
    expect(getBlock(tiny.state, "b0" as BlockId)?.type).toBe("heading");
    expect(getBlock(tiny.state, "b1" as BlockId)?.type).toBe("paragraph");
  });

  it("survives a 15K-deep cache chain without stack overflow (S-A2 iterative read)", () => {
    // Each non-no-op applyOperation pushes a new layer onto the cache
    // chain. A long editing session can produce tens of thousands of
    // layers; a cold read on a deeply-buried block would blow V8's
    // ~10K-frame stack if the chain walk were recursive. The walk is
    // iterative; this test asserts the chain can grow well past the
    // stack limit without throwing.
    const DEPTH = 15_000;
    let state = createState({ rootId: "root" as BlockId });
    state = applyOperation(state, () => {
      const blocks = getBlocksMap(state[STATE_INTERNAL].doc);
      blocks.set("cold", buildYBlock({
        type: "paragraph",
        attrs: {},
        parentId: null,
        prevSiblingId: null,
        nextSiblingId: null,
        firstChildId: null,
        lastChildId: null,
        inlineContent: { items: [] },
      }));
    }).state;
    // Now build the chain: each iteration mutates a DIFFERENT id, so
    // "cold" stays uncached on every new layer (never promoted, never
    // invalidated above the root).
    for (let i = 0; i < DEPTH; i++) {
      const idx = i;
      state = applyOperation(state, () => {
        const blocks = getBlocksMap(state[STATE_INTERNAL].doc);
        blocks.set(`other-${idx}`, buildYBlock({
          type: "paragraph",
          attrs: {},
          parentId: null,
          prevSiblingId: null,
          nextSiblingId: null,
          firstChildId: null,
          lastChildId: null,
          inlineContent: { items: [] },
        }));
      }).state;
    }
    // First read of "cold" from the topmost layer must walk past
    // DEPTH+1 layers without blowing the stack.
    const snap = getBlock(state, "cold" as BlockId);
    expect(snap).not.toBeNull();
    expect(snap?.type).toBe("paragraph");
  }, 30_000);

  it("preserves snapshot reference identity for unchanged blocks across applyOperation", () => {
    const state = createState({ rootId: "root" as BlockId });
    applyOperation(state, () => {
      const blocks = getBlocksMap(state[STATE_INTERNAL].doc);
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
      const yP1 = getBlocksMap(state[STATE_INTERNAL].doc).get("p1")!;
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

describe("getEmbedContentIds", () => {
  it("yields all embed-content block ids", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      embedContents: [
        buildBlock({
          id: "fn-1",
          type: "paragraph",
          inlineContent: inlineContent([text("first")]),
        }),
        buildBlock({
          id: "fn-2",
          type: "paragraph",
          inlineContent: inlineContent([text("second")]),
        }),
      ],
    });
    const ids = Array.from(getEmbedContentIds(state));
    // Order matches Y.Map insertion order; both ids must be present.
    expect(ids.sort()).toEqual(["fn-1", "fn-2"]);
  });

  it("yields nothing when no embed contents exist", () => {
    const state = createEmptyDocument();
    expect(Array.from(getEmbedContentIds(state))).toEqual([]);
  });
});
