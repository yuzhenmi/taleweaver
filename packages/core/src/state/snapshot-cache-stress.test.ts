import { describe, it, expect } from "vitest";
import { createState, getBlock, applyOperation } from "./state";
import { getBlocksMap } from "./yjs-doc";
import { buildYBlock } from "./y-block";
import type { BlockId } from "./block-id";
import { setBlockAttrs } from "./ops/set-block-attrs";
import { STATE_INTERNAL } from "./state-internal";

describe("snapshot cache (stress)", () => {
  it("reuses cached snapshots for unchanged blocks after a single-block mutation", () => {
    const state = createState({ rootId: "root" as BlockId });
    // Seed 100 sibling blocks under root.
    let prevId: BlockId | null = null;
    applyOperation(state, () => {
      const yBlocks = getBlocksMap(state[STATE_INTERNAL].doc);
      yBlocks.set(
        "root",
        buildYBlock({
          type: "document",
          attrs: {},
          parentId: null,
          prevSiblingId: null,
          nextSiblingId: null,
          firstChildId: "p-0" as BlockId,
          lastChildId: "p-99" as BlockId,
          inlineContent: null,
        }),
      );
      for (let i = 0; i < 100; i++) {
        const id = `p-${i}` as BlockId;
        yBlocks.set(
          id,
          buildYBlock({
            type: "paragraph",
            attrs: {},
            parentId: "root" as BlockId,
            prevSiblingId: prevId,
            nextSiblingId: i < 99 ? (`p-${i + 1}` as BlockId) : null,
            firstChildId: null,
            lastChildId: null,
            inlineContent: { items: [] },
          }),
        );
        prevId = id;
      }
    });

    // Materialize all 100 snapshots into the cache.
    const before: Array<ReturnType<typeof getBlock>> = [];
    for (let i = 0; i < 100; i++) {
      before.push(getBlock(state, `p-${i}` as BlockId));
    }

    // Mutate just one block.
    const result = setBlockAttrs(state, "p-42" as BlockId, { bold: true });

    // For the new state, "p-42" should be a fresh snapshot.
    expect(getBlock(result.state, "p-42" as BlockId)?.attrs.bold).toBe(true);

    // For unchanged blocks, the carry-forward cache in applyOperation guarantees
    // identity reuse — the new state returns the same snapshot object as the old.
    for (let i = 0; i < 100; i++) {
      if (i === 42) continue;
      const a = before[i];
      const b = getBlock(result.state, `p-${i}` as BlockId);
      expect(b).toBe(a);
    }
  });
});
