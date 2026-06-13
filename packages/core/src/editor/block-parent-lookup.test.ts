import { describe, it, expect } from "vitest";
import { buildState, buildBlock } from "../test-utils/state-builders";
import { asBlockId } from "../state/block-id";
import { makeBlockParentLookup } from "./block-parent-lookup";

describe("makeBlockParentLookup", () => {
  it("returns a block's parent id from real State", () => {
    // Root `document` block wrapping one child `paragraph` — the child's
    // parentId is a real link into the materialized Y.Doc-backed State.
    const state = buildState({
      rootId: "root",
      blocks: [
        buildBlock({ id: "root", type: "document", firstChildId: "child", lastChildId: "child" }),
        buildBlock({ id: "child", type: "paragraph", parentId: "root" }),
      ],
    });

    const parentOf = makeBlockParentLookup(state);

    expect(parentOf(asBlockId("child"))).toBe(asBlockId("root"));
  });

  it("returns null for an id not in the document", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
    });

    const parentOf = makeBlockParentLookup(state);

    expect(parentOf(asBlockId("does-not-exist"))).toBeNull();
  });

  it("returns null for the root block (parentId === null)", () => {
    const state = buildState({
      rootId: "root",
      blocks: [buildBlock({ id: "root", type: "document" })],
    });

    const parentOf = makeBlockParentLookup(state);

    expect(parentOf(asBlockId("root"))).toBeNull();
  });
});
