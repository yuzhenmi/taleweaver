import { describe, it, expect } from "vitest";
import { setListType } from "./set-list-type";
import { getListDef } from "../list-defs";
import { STATE_INTERNAL } from "../state-internal";
import { buildState, buildBlock } from "../../test-utils/state-builders";
import type { BlockId } from "../index";

function twoItemList() {
  return buildState({
    rootId: "root",
    blocks: [
      buildBlock({ id: "root", type: "doc", firstChildId: "i1", lastChildId: "i2" }),
      buildBlock({ id: "i1", type: "list-item", parentId: "root", nextSiblingId: "i2", attrs: { listId: "L1", listLevel: 0 }, inlineContent: { items: [] } }),
      buildBlock({ id: "i2", type: "list-item", parentId: "root", prevSiblingId: "i1", attrs: { listId: "L1", listLevel: 0 }, inlineContent: { items: [] } }),
    ],
  });
}

describe("setListType", () => {
  it("marks all items of the list dirty and does not short-circuit", () => {
    const state = twoItemList();
    const result = setListType(state, "L1", "unordered");
    expect(result.dirtyIds.has("i1" as BlockId)).toBe(true);
    expect(result.dirtyIds.has("i2" as BlockId)).toBe(true);
    expect(result.state).not.toBe(state);
  });

  it("writes a bullet-style ListDef for unordered and a numbered ListDef for ordered", () => {
    const unordered = setListType(twoItemList(), "L1", "unordered");
    const ud = getListDef(unordered.state[STATE_INTERNAL].doc, "L1");
    expect(ud?.levels[0]?.style).toBe("disc");

    const ordered = setListType(twoItemList(), "L1", "ordered");
    const od = getListDef(ordered.state[STATE_INTERNAL].doc, "L1");
    expect(od?.levels[0]?.style).toBe("decimal");
  });

  it("only dirties items of the MATCHING listId", () => {
    const state = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "doc", firstChildId: "i1", lastChildId: "i2" }),
        buildBlock({ id: "i1", type: "list-item", parentId: "root", nextSiblingId: "i2", attrs: { listId: "L1", listLevel: 0 }, inlineContent: { items: [] } }),
        buildBlock({ id: "i2", type: "list-item", parentId: "root", prevSiblingId: "i1", attrs: { listId: "L2", listLevel: 0 }, inlineContent: { items: [] } }),
      ],
    });
    const result = setListType(state, "L1", "ordered");
    expect(result.dirtyIds.has("i1" as BlockId)).toBe(true);
    expect(result.dirtyIds.has("i2" as BlockId)).toBe(false);
  });
});
