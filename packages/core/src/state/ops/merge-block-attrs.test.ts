import { describe, it, expect } from "vitest";
import { mergeBlockAttrs } from "./merge-block-attrs";
import { getBlock } from "../state";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import type { BlockId } from "../block-id";
import { AttrRegistry } from "../../cascade/attr-registry";

describe("mergeBlockAttrs", () => {
  const fixture = (existingAttrs: Record<string, unknown> = {}) =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          attrs: existingAttrs,
          inlineContent: inlineContent([]),
        }),
      ],
    });

  it("merges incoming attrs into an empty existing bag", () => {
    const state = fixture({});
    const result = mergeBlockAttrs(state, "p" as BlockId, { bold: true });
    expect(getBlock(result.state, "p" as BlockId)?.attrs).toEqual({ bold: true });
  });

  it("preserves existing keys not present in incoming (union)", () => {
    const state = fixture({ bold: true });
    const result = mergeBlockAttrs(state, "p" as BlockId, { italic: true });
    expect(getBlock(result.state, "p" as BlockId)?.attrs).toEqual({
      bold: true,
      italic: true,
    });
  });

  it("overwrites a key when present in both existing and incoming", () => {
    const state = fixture({ bold: true });
    const result = mergeBlockAttrs(state, "p" as BlockId, { bold: false });
    expect(getBlock(result.state, "p" as BlockId)?.attrs).toEqual({ bold: false });
  });

  it("removes a key when incoming value is undefined", () => {
    const state = fixture({ bold: true });
    const result = mergeBlockAttrs(state, "p" as BlockId, { bold: undefined });
    expect(getBlock(result.state, "p" as BlockId)?.attrs).toEqual({});
  });

  it("preserves other keys when removing one via undefined", () => {
    const state = fixture({ bold: true, italic: true });
    const result = mergeBlockAttrs(state, "p" as BlockId, { bold: undefined });
    expect(getBlock(result.state, "p" as BlockId)?.attrs).toEqual({ italic: true });
  });

  it("is a no-op when incoming is empty (state reference identity preserved)", () => {
    const state = fixture({ bold: true });
    const result = mergeBlockAttrs(state, "p" as BlockId, {});
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
    expect(getBlock(result.state, "p" as BlockId)?.attrs).toEqual({ bold: true });
  });

  it("is a no-op when incoming merges to the same bag (state reference identity preserved)", () => {
    const state = fixture({ bold: true });
    const result = mergeBlockAttrs(state, "p" as BlockId, { bold: true });
    // The merged result is structurally equal to existing. The op's
    // attrsEqual short-circuit must skip the Y.Map write entirely so
    // applyOperation returns the input state reference unchanged (T7
    // no-op contract). This is the more interesting case than empty
    // incoming — it pins the structural-equality short-circuit.
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
    expect(getBlock(result.state, "p" as BlockId)?.attrs).toEqual({ bold: true });
  });

  it("returns dirtyIds containing the modified block when attrs changed", () => {
    const state = fixture({});
    const result = mergeBlockAttrs(state, "p" as BlockId, { bold: true });
    expect([...result.dirtyIds]).toEqual(["p"]);
  });

  it("does not modify the original state (immutability of the input handle)", () => {
    const state = fixture({ bold: true });
    mergeBlockAttrs(state, "p" as BlockId, { italic: true });
    expect(getBlock(state, "p" as BlockId)?.attrs).toEqual({ bold: true });
  });

  it("throws when the block does not exist", () => {
    const state = fixture();
    expect(() => mergeBlockAttrs(state, "missing" as BlockId, { bold: true })).toThrow(
      /not found/,
    );
  });
});

describe("mergeBlockAttrs — AttrRegistry custom equality (#263)", () => {
  const commentRegistry = (() => {
    const r = new AttrRegistry();
    r.register({
      attrKey: "comment",
      toStyle: () => ({}),
      equals: (a, b) =>
        (a as { id: string }).id === (b as { id: string }).id,
    });
    return r;
  })();

  const fixtureWithComment = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          attrs: { comment: { id: "c1", timestamp: 1 } },
          inlineContent: inlineContent([]),
        }),
      ],
    });

  it("with registry: same-id comment + different timestamp is a NO-OP (state ref preserved)", () => {
    const state = fixtureWithComment();
    const result = mergeBlockAttrs(
      state,
      "p" as BlockId,
      { comment: { id: "c1", timestamp: 2 } },
      commentRegistry,
    );
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
  });

  it("without registry: same-id + different timestamp mutates (deep compare diverges)", () => {
    const state = fixtureWithComment();
    const result = mergeBlockAttrs(state, "p" as BlockId, {
      comment: { id: "c1", timestamp: 2 },
    });
    expect(result.state).not.toBe(state);
    expect([...result.dirtyIds]).toEqual(["p"]);
  });
});
