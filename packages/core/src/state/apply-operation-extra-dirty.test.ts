import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { applyOperation } from "./state";
import { buildState, buildBlock } from "../test-utils/state-builders";
import type { BlockId } from "./index";

function singleBlockState() {
  return buildState({
    rootId: "root",
    blocks: [
      buildBlock({
        id: "root",
        type: "doc",
        firstChildId: "p1",
        lastChildId: "p1",
      }),
      buildBlock({
        id: "p1",
        type: "paragraph",
        parentId: "root",
        inlineContent: { items: [] },
      }),
    ],
  });
}

describe("applyOperation extra-dirty return channel", () => {
  it("unions ids returned by fn into dirtyIds even when the txn touched no blocks", () => {
    const state = singleBlockState();
    const extra = new Set<BlockId>(["p1" as BlockId]);
    const result = applyOperation(state, (doc) => {
      // Mutate a NON-block-tree map (mirrors a listDefs-only write).
      doc.getMap("listDefs").set("L1", new Y.Map());
      return extra;
    });
    expect(result.dirtyIds.has("p1" as BlockId)).toBe(true);
    expect(result.state).not.toBe(state); // did NOT short-circuit
  });

  it("still short-circuits when fn returns no extra ids and touches nothing", () => {
    const state = singleBlockState();
    const result = applyOperation(state, () => {
      /* no-op */
    });
    expect(result.dirtyIds.size).toBe(0);
    expect(result.state).toBe(state);
  });

  it("unions extra ids with block-tree-captured ids", () => {
    const state = singleBlockState();
    const result = applyOperation(state, (doc) => {
      const blocks = doc.getMap("blocks") as Y.Map<Y.Map<unknown>>;
      const p1 = blocks.get("p1") as Y.Map<unknown>;
      p1.set("type", "heading"); // captured as dirty p1 by the txn
      return new Set<BlockId>(["root" as BlockId]); // extra
    });
    expect(result.dirtyIds.has("p1" as BlockId)).toBe(true);
    expect(result.dirtyIds.has("root" as BlockId)).toBe(true);
  });
});
