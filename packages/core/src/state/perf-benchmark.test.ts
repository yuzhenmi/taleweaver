import { describe, it, expect } from "vitest";
import { createState, getBlock } from "./state";
import { getBlocksMap, runTransaction } from "./yjs-doc";
import { buildYBlock } from "./y-block";
import { setBlockAttrs } from "./set-block-attrs";
import type { BlockId } from "./block-id";

describe("perf benchmark (smoke)", () => {
  it("setBlockAttrs on a 10k-block document completes under 50ms", () => {
    const state = createState({ rootId: "root" as BlockId });
    runTransaction(state.doc, () => {
      const yBlocks = getBlocksMap(state.doc);
      yBlocks.set(
        "root",
        buildYBlock({
          type: "document",
          attrs: {},
          parentId: null,
          prevSiblingId: null,
          nextSiblingId: null,
          firstChildId: "p-0" as BlockId,
          lastChildId: `p-${9999}` as BlockId,
          inlineContent: null,
        }),
      );
      for (let i = 0; i < 10000; i++) {
        const id = `p-${i}` as BlockId;
        yBlocks.set(
          id,
          buildYBlock({
            type: "paragraph",
            attrs: {},
            parentId: "root" as BlockId,
            prevSiblingId: i > 0 ? (`p-${i - 1}` as BlockId) : null,
            nextSiblingId: i < 9999 ? (`p-${i + 1}` as BlockId) : null,
            firstChildId: null,
            lastChildId: null,
            inlineContent: { items: [] },
          }),
        );
      }
    });

    const t0 = performance.now();
    const result = setBlockAttrs(state, "p-5000" as BlockId, { bold: true });
    const elapsed = performance.now() - t0;
    expect(result.dirtyIds.has("p-5000" as BlockId)).toBe(true);
    expect(elapsed).toBeLessThan(50); // 50ms — generous; tighter in P14.
  });

  it("getBlock on cached snapshot is sub-millisecond", () => {
    const state = createState({ rootId: "root" as BlockId });
    runTransaction(state.doc, () => {
      getBlocksMap(state.doc).set(
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
    });
    // Prime the cache.
    getBlock(state, "root" as BlockId);
    // Time 10k cache-hits.
    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) {
      getBlock(state, "root" as BlockId);
    }
    const elapsed = performance.now() - t0;
    expect(elapsed / 10000).toBeLessThan(0.01); // <10us per cache hit.
  });
});
