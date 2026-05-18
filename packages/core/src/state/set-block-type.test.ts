import { describe, it, expect } from "vitest";
import { setBlockType } from "./set-block-type";
import { getBlock } from "./state";
import { buildBlock, buildState, inlineContent } from "../test-utils/state-builders";
import type { BlockId } from "./block-id";

describe("setBlockType", () => {
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });

  it("replaces the block's type and preserves all other fields", () => {
    const state = fixture();
    const result = setBlockType(state, "p" as BlockId, "heading");
    const updated = getBlock(result.state, "p" as BlockId);
    expect(updated?.type).toBe("heading");
    expect(updated?.id).toBe("p");
    expect(updated?.parentId).toBe("doc");
    expect(updated?.inlineContent).toEqual({ items: [] });
  });

  it("returns dirtyIds containing only the modified block", () => {
    const state = fixture();
    const result = setBlockType(state, "p" as BlockId, "heading");
    expect([...result.dirtyIds]).toEqual(["p"]);
  });

  it("throws when the block does not exist", () => {
    const state = fixture();
    expect(() => setBlockType(state, "missing" as BlockId, "heading")).toThrow(/not found/);
  });
});
