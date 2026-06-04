import { describe, it, expect } from "vitest";
import {
  createState,
  getBlock,
  applyOperation,
  freshState,
  freshStateFromDoc,
  getEmbedContent,
  getEmbedContentIds,
  getTemplateContent,
  getTemplateContentIds,
  resolveBlock,
  blockCount,
} from "./state";
import { createEmptyDocument } from "./initial-state";
import { chainDepth } from "./snapshot";
import { runTransaction, getBlocksMap, getMetaMap, allTreeBlockCount } from "./yjs-doc";
import { buildYBlock } from "./y-block";
import type { BlockId } from "./block-id";
import type { State } from "./state";
import { buildBlock, buildState, inlineContent, text } from "../test-utils/state-builders";
import { insertText } from "./ops/insert-text";
import { applyAttrsToRange } from "./ops/apply-attrs";
import { deleteRange } from "./ops/delete-range";
import { replaceRange } from "./ops/replace-range";
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
      // Standalone block (parentId null) — this test exercises only
      // applyOperation's dirty-id capture, so a valid minimal tree keeps the
      // dev-mode assertChainIntegrity happy without needing a parent.
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

  it("freshStateFromDoc returns a State referencing the same Y.Doc with a clean cache", () => {
    const state = createState({ rootId: "root" as BlockId });
    const next = freshStateFromDoc(state);
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
    //
    // Runs with NODE_ENV=production so the dev-mode
    // `assertNoOrphanedEmbedContent` invariant (#363) — which reads every
    // block via `getBlock` after each `applyOperation` and would warm the
    // fresh overlay — stays off the path. The empty-overlay property tested
    // here is the production hot-path contract; dev-mode cache warming from
    // invariant assertions is a separate, accepted tradeoff.
    const origNodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
      .process?.env?.NODE_ENV;
    const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
    if (proc?.env !== undefined) proc.env.NODE_ENV = "production";
    try {
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
      // freshStateFromDoc the cache so all ids are uncached, then warm.
      const warm = freshStateFromDoc(state);
      for (let i = 0; i < NUM_BLOCKS; i++) {
        getBlock(warm, `b${i}` as BlockId);
      }
      expect(warm[STATE_INTERNAL].snapshotCache.snapshots.block.size).toBe(NUM_BLOCKS);

      // Mutate a single block.
      const tiny = applyOperation(warm, () => {
        const yBlock = getBlocksMap(warm[STATE_INTERNAL].doc).get("b0")!;
        yBlock.set("type", "heading");
      });
      expect(tiny.dirtyIds.size).toBe(1);

      const newCache = tiny.state[STATE_INTERNAL].snapshotCache;
      // The new overlay starts empty — no entries carried forward, in ANY
      // tree (the overlay-starts-empty property is what the whole carry-forward
      // correctness argument rests on, so assert all three sub-maps).
      expect(newCache.snapshots.block.size).toBe(0);
      expect(newCache.snapshots.embedContent.size).toBe(0);
      expect(newCache.snapshots.templateContent.size).toBe(0);
      // The dirty block is invalidated on this layer so reads don't fall
      // through to the stale base entry.
      expect(newCache.invalidated.has("b0" as BlockId)).toBe(true);
      // Base reference points to the warmed cache.
      expect(newCache.base).toBe(warm[STATE_INTERNAL].snapshotCache);

      // Reads still resolve correctly.
      expect(getBlock(tiny.state, "b0" as BlockId)?.type).toBe("heading");
      expect(getBlock(tiny.state, "b1" as BlockId)?.type).toBe("paragraph");
    } finally {
      if (proc?.env !== undefined) {
        if (origNodeEnv === undefined) delete proc.env.NODE_ENV;
        else proc.env.NODE_ENV = origNodeEnv;
      }
    }
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
    // #428: generous timeout — this is a heavy stress test (15K-deep chain) that
    // asserts correctness (no stack overflow), not wall-clock. It runs ~30s in
    // isolation but can balloon under full-suite parallel CPU contention; 120s
    // absorbs that so the suite stays deterministically green.
  }, 120_000);

  it("freshState compacts deep chains so undo/redo runs stay bounded (#273)", () => {
    // Each undo/redo mints a freshState(state, dirtyIds). Before #273 that
    // ONLY ever built an overlay layer — never compacted — so a long
    // undo/redo run grew the chain without bound. Now freshState compacts at
    // the same depth threshold applyOperation uses.
    let state = createState({ rootId: "root" as BlockId });
    state = applyOperation(state, () => {
      getBlocksMap(state[STATE_INTERNAL].doc).set(
        "root",
        buildYBlock({
          type: "document",
          attrs: {},
          parentId: null,
          prevSiblingId: null,
          nextSiblingId: null,
          firstChildId: null,
          lastChildId: null,
          inlineContent: null,
        }),
      );
    }).state;

    // 200 freshState calls would chain 200-deep without compaction.
    for (let i = 0; i < 200; i++) {
      state = freshState(state, new Set(["root" as BlockId]));
    }

    // Bounded near the compaction threshold (≤ 64), not ~201.
    expect(chainDepth(state[STATE_INTERNAL].snapshotCache)).toBeLessThanOrEqual(64);
    // ...and reads still resolve correctly after compaction + invalidation.
    expect(getBlock(state, "root" as BlockId)?.type).toBe("document");
  });

  it("freshState builds an overlay (no compaction) for a shallow chain", () => {
    let state = createState({ rootId: "root" as BlockId });
    state = applyOperation(state, () => {
      getBlocksMap(state[STATE_INTERNAL].doc).set(
        "root",
        buildYBlock({
          type: "document",
          attrs: {},
          parentId: null,
          prevSiblingId: null,
          nextSiblingId: null,
          firstChildId: null,
          lastChildId: null,
          inlineContent: null,
        }),
      );
    }).state;
    const before = chainDepth(state[STATE_INTERNAL].snapshotCache);
    const next = freshState(state, new Set(["root" as BlockId]));
    // Shallow chain → overlay path: one layer deeper, base preserved.
    expect(next[STATE_INTERNAL].snapshotCache.base).not.toBeNull();
    expect(chainDepth(next[STATE_INTERNAL].snapshotCache)).toBe(before + 1);
  });

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

describe("getEmbedContentIds", () => {
  // #313: a multi-level embed body has a ROOT (parentId === null) plus
  // CHILD blocks (parentId pointing at the root) registered in the SAME
  // embedContents Y.Map. The accessor must yield ONLY the root — the
  // children are reached via the root's child chain during render. If it
  // yielded the children too, the render loop would emit each child as a
  // spurious standalone top-level RenderOutput.embedContents entry.
  it("yields ONLY the root id of a multi-level embed body (not its children)", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      embedContents: [
        buildBlock({
          id: "emb-root",
          type: "body-container",
          firstChildId: "c1",
          lastChildId: "c2",
        }),
        buildBlock({
          id: "c1",
          type: "paragraph",
          parentId: "emb-root",
          nextSiblingId: "c2",
          inlineContent: inlineContent([text("first")]),
        }),
        buildBlock({
          id: "c2",
          type: "paragraph",
          parentId: "emb-root",
          prevSiblingId: "c1",
          inlineContent: inlineContent([text("second")]),
        }),
      ],
    });
    expect(Array.from(getEmbedContentIds(state))).toEqual(["emb-root"]);
  });

  it("yields a single-level leaf body root (parentId === null, no children)", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      embedContents: [
        buildBlock({
          id: "fn-leaf",
          type: "paragraph",
          inlineContent: inlineContent([text("leaf")]),
        }),
      ],
    });
    expect(Array.from(getEmbedContentIds(state))).toEqual(["fn-leaf"]);
  });

  it("yields both roots when two sibling-root bodies exist (both parentId null)", () => {
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
    expect(ids.sort()).toEqual(["fn-1", "fn-2"]);
  });

  it("yields nothing when no embed contents exist", () => {
    const state = createEmptyDocument();
    expect(Array.from(getEmbedContentIds(state))).toEqual([]);
  });
});

describe("getTemplateContent", () => {
  it("returns the body block from the templateContents map", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      templateContents: [
        buildBlock({
          id: "hdr-body-1",
          type: "header-body",
          inlineContent: inlineContent([text("page header")]),
        }),
      ],
    });
    const body = getTemplateContent(state, "hdr-body-1" as BlockId);
    expect(body?.type).toBe("header-body");
  });

  it("returns null for unknown ids", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
    });
    expect(getTemplateContent(state, "unknown" as BlockId)).toBeNull();
  });
});

describe("getTemplateContentIds", () => {
  // #313: same root-only contract as getEmbedContentIds, over the
  // templateContents (header/footer body) Y.Map.
  it("yields ONLY the root id of a multi-level template body (not its children)", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      templateContents: [
        buildBlock({
          id: "tpl-root",
          type: "header-body",
          firstChildId: "h1",
          lastChildId: "h2",
        }),
        buildBlock({
          id: "h1",
          type: "paragraph",
          parentId: "tpl-root",
          nextSiblingId: "h2",
          inlineContent: inlineContent([text("first")]),
        }),
        buildBlock({
          id: "h2",
          type: "paragraph",
          parentId: "tpl-root",
          prevSiblingId: "h1",
          inlineContent: inlineContent([text("second")]),
        }),
      ],
    });
    expect(Array.from(getTemplateContentIds(state))).toEqual(["tpl-root"]);
  });

  it("yields a single-level leaf body root (parentId === null, no children)", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      templateContents: [
        buildBlock({
          id: "tpl-leaf",
          type: "header-body",
          inlineContent: inlineContent([text("leaf")]),
        }),
      ],
    });
    expect(Array.from(getTemplateContentIds(state))).toEqual(["tpl-leaf"]);
  });

  it("yields both roots when two sibling-root bodies exist (both parentId null)", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      templateContents: [
        buildBlock({
          id: "tpl-1",
          type: "paragraph",
          inlineContent: inlineContent([text("first")]),
        }),
        buildBlock({
          id: "tpl-2",
          type: "paragraph",
          inlineContent: inlineContent([text("second")]),
        }),
      ],
    });
    const ids = Array.from(getTemplateContentIds(state));
    expect(ids.sort()).toEqual(["tpl-1", "tpl-2"]);
  });

  it("yields nothing when no template contents exist", () => {
    const state = createEmptyDocument();
    expect(Array.from(getTemplateContentIds(state))).toEqual([]);
  });
});

describe("resolveBlock", () => {
  function threeTreeState(): State {
    return buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "document" }),
        buildBlock({
          id: "body-1",
          type: "paragraph",
          parentId: "root",
          inlineContent: inlineContent([text("body")]),
        }),
      ],
      embedContents: [
        buildBlock({
          id: "embed-1",
          type: "fn-body",
          inlineContent: inlineContent([text("footnote")]),
        }),
      ],
      templateContents: [
        buildBlock({
          id: "tpl-1",
          type: "header-body",
          inlineContent: inlineContent([text("header")]),
        }),
      ],
    });
  }

  it("resolves a main-tree block with kind 'block'", () => {
    const state = threeTreeState();
    const resolved = resolveBlock(state, "body-1" as BlockId);
    expect(resolved?.kind).toBe("block");
    expect(resolved?.block).toBe(getBlock(state, "body-1" as BlockId));
    expect(resolved?.block.type).toBe("paragraph");
  });

  it("resolves an embed-content block with kind 'embedContent'", () => {
    const state = threeTreeState();
    const resolved = resolveBlock(state, "embed-1" as BlockId);
    expect(resolved?.kind).toBe("embedContent");
    expect(resolved?.block).toBe(getEmbedContent(state, "embed-1" as BlockId));
    expect(resolved?.block.type).toBe("fn-body");
  });

  it("resolves a template-content block with kind 'templateContent'", () => {
    const state = threeTreeState();
    const resolved = resolveBlock(state, "tpl-1" as BlockId);
    expect(resolved?.kind).toBe("templateContent");
    expect(resolved?.block).toBe(
      getTemplateContent(state, "tpl-1" as BlockId),
    );
    expect(resolved?.block.type).toBe("header-body");
  });

  it("returns null when the id is in no tree", () => {
    const state = threeTreeState();
    expect(resolveBlock(state, "unknown" as BlockId)).toBeNull();
  });

  it("prefers the main tree over embed/template on id collision (defensive)", () => {
    const state = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "document" }),
        buildBlock({ id: "dup", type: "paragraph", parentId: "root" }),
      ],
      embedContents: [buildBlock({ id: "dup", type: "fn-body" })],
      templateContents: [buildBlock({ id: "dup", type: "header-body" })],
    });
    const resolved = resolveBlock(state, "dup" as BlockId);
    expect(resolved?.kind).toBe("block");
    expect(resolved?.block.type).toBe("paragraph");
  });
});

describe("blockCount", () => {
  it("counts the blocks of an empty document", () => {
    // createEmptyDocument seeds a `document` container + one `paragraph` child.
    const state = createEmptyDocument();
    expect(blockCount(state)).toBe(2);
  });

  it("sums blocks across ALL THREE trees, not just the main map", () => {
    // This is the property that makes blockCount a safe cycle-detection bound
    // for traversals that legitimately walk WITHIN an embed/template body: a
    // main-map-only count would under-bound such a walk. 2 main + 1 embed +
    // 1 template = 4.
    const state = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "root" }),
      ],
      embedContents: [buildBlock({ id: "fn", type: "fn-body" })],
      templateContents: [buildBlock({ id: "hdr", type: "header-body" })],
    });
    expect(blockCount(state)).toBe(4);
  });

  it("delegates to allTreeBlockCount (same value, Y.Doc hidden behind Layer 1)", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
      embedContents: [buildBlock({ id: "fn", type: "fn-body" })],
    });
    expect(blockCount(state)).toBe(allTreeBlockCount(state[STATE_INTERNAL].doc));
  });
});
