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

  // --- Shape-invariance (T11) ---

  it("allows same-kind change: paragraph -> heading (both inline-bearing-leaf)", () => {
    const state = fixture();
    const result = setBlockType(state, "p" as BlockId, "heading");
    expect(getBlock(result.state, "p" as BlockId)?.type).toBe("heading");
  });

  it("allows same-kind change: list -> table (both container)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "list", lastChildId: "list" }),
        buildBlock({ id: "list", type: "list", parentId: "doc" }),
      ],
    });
    const result = setBlockType(state, "list" as BlockId, "table");
    expect(getBlock(result.state, "list" as BlockId)?.type).toBe("table");
  });

  it("allows same-kind change: image -> horizontal-line (both atomic-leaf)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "img", lastChildId: "img" }),
        buildBlock({ id: "img", type: "image", parentId: "doc" }),
      ],
    });
    const result = setBlockType(state, "img" as BlockId, "horizontal-line");
    expect(getBlock(result.state, "img" as BlockId)?.type).toBe("horizontal-line");
  });

  it("refuses cross-kind change: paragraph -> list (inline-bearing-leaf -> container)", () => {
    const state = fixture();
    expect(() => setBlockType(state, "p" as BlockId, "list")).toThrow(
      /cross-kind change refused.*inline-bearing-leaf.*container/,
    );
  });

  it("refuses cross-kind change: image -> list (atomic-leaf -> container)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "img", lastChildId: "img" }),
        buildBlock({ id: "img", type: "image", parentId: "doc" }),
      ],
    });
    expect(() => setBlockType(state, "img" as BlockId, "list")).toThrow(
      /cross-kind change refused.*atomic-leaf.*container/,
    );
  });

  it("refuses cross-kind change: list -> paragraph (container -> inline-bearing-leaf)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "list", lastChildId: "list" }),
        buildBlock({ id: "list", type: "list", parentId: "doc" }),
      ],
    });
    expect(() => setBlockType(state, "list" as BlockId, "paragraph")).toThrow(
      /cross-kind change refused.*container.*inline-bearing-leaf/,
    );
  });
});
