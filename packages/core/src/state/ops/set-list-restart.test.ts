import { describe, it, expect } from "vitest";
import { setListRestart } from "./set-list-restart";
import { getBlock } from "../index";
import { buildState, buildBlock } from "../../test-utils/state-builders";
import type { BlockId } from "../index";

function oneItem() {
  return buildState({
    rootId: "root",
    blocks: [
      buildBlock({ id: "root", type: "doc", firstChildId: "i1", lastChildId: "i1" }),
      buildBlock({ id: "i1", type: "list-item", parentId: "root", attrs: { listId: "L1", listLevel: 0 }, inlineContent: { items: [] } }),
    ],
  });
}

describe("setListRestart", () => {
  it("sets listCounterOverride on the item and marks it dirty", () => {
    const result = setListRestart(oneItem(), "i1" as BlockId, 1);
    expect(getBlock(result.state, "i1" as BlockId)?.attrs.listCounterOverride).toBe(1);
    expect(result.dirtyIds.has("i1" as BlockId)).toBe(true);
  });

  it("clears the override when given undefined (continue numbering)", () => {
    const set = setListRestart(oneItem(), "i1" as BlockId, 1).state;
    const cleared = setListRestart(set, "i1" as BlockId, undefined);
    expect(getBlock(cleared.state, "i1" as BlockId)?.attrs.listCounterOverride).toBeUndefined();
  });
});
