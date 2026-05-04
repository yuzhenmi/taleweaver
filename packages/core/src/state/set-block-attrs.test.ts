import { describe, it, expect } from "vitest";
import { setBlockAttrs } from "./set-block-attrs";
import { buildBlock, buildState } from "../test-utils/state-builders";
import { createInlineContent } from "./inline-content";
import type { BlockId } from "./block-id";

describe("setBlockAttrs", () => {
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", attrs: { textAlign: "left" }, inlineContent: createInlineContent([]) }),
      ],
    });

  it("replaces the block's attrs and returns the updated block", () => {
    const state = fixture();
    const result = setBlockAttrs(state, "p" as BlockId, { textAlign: "right", marginTop: "1em" });
    const updated = result.state.blocks.get("p" as BlockId);
    expect(updated?.attrs).toEqual({ textAlign: "right", marginTop: "1em" });
    // Block-shape invariants preserved:
    expect(updated?.id).toBe("p");
    expect(updated?.type).toBe("paragraph");
    expect(updated?.parentId).toBe("doc");
  });

  it("returns dirtyIds containing only the modified block", () => {
    const state = fixture();
    const result = setBlockAttrs(state, "p" as BlockId, { textAlign: "right" });
    expect([...result.dirtyIds]).toEqual(["p"]);
  });

  it("does not modify the original state (immutability)", () => {
    const state = fixture();
    setBlockAttrs(state, "p" as BlockId, { textAlign: "right" });
    expect(state.blocks.get("p" as BlockId)?.attrs).toEqual({ textAlign: "left" });
  });

  it("throws when the block does not exist", () => {
    const state = fixture();
    expect(() => setBlockAttrs(state, "missing" as BlockId, {})).toThrow(/not found/);
  });
});
