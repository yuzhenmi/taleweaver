import { describe, it, expect } from "vitest";
import { setBlockAttrs, setBlockAttrsInTx } from "./set-block-attrs";
import { getBlock, applyOperation } from "../state";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import type { BlockId } from "../block-id";
import { AttrRegistry } from "../../cascade/attr-registry";

describe("setBlockAttrs", () => {
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", attrs: { textAlign: "left" }, inlineContent: inlineContent([]) }),
      ],
    });

  it("replaces the block's attrs and returns the updated block", () => {
    const state = fixture();
    const result = setBlockAttrs(state, "p" as BlockId, { textAlign: "right", marginTop: "1em" });
    const updated = getBlock(result.state, "p" as BlockId);
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
    expect(getBlock(state, "p" as BlockId)?.attrs).toEqual({ textAlign: "left" });
  });

  it("throws when the block does not exist", () => {
    const state = fixture();
    expect(() => setBlockAttrs(state, "missing" as BlockId, {})).toThrow(/not found/);
  });

  it("no-op short-circuit: same-value write returns the input state unchanged (S-B1)", () => {
    const state = fixture();
    // The fixture's "p" block already has { textAlign: "left" }.
    const result = setBlockAttrs(state, "p" as BlockId, { textAlign: "left" });
    expect(result.state).toBe(state); // applyOperation no-op identity
    expect(result.dirtyIds.size).toBe(0); // no spurious dirty event
  });

  it("a genuinely different bag still mutates and dirties the block (S-B1)", () => {
    const state = fixture();
    const result = setBlockAttrs(state, "p" as BlockId, { textAlign: "right" });
    expect(result.state).not.toBe(state);
    expect([...result.dirtyIds]).toEqual(["p"]);
  });
});

describe("setBlockAttrsInTx (in-transaction primitive, C1)", () => {
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", attrs: { foo: 1 }, firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", attrs: { textAlign: "left" }, inlineContent: inlineContent([]) }),
      ],
    });

  it("writes a main-tree block's attrs inside an open transaction (round-trip)", () => {
    const state = fixture();
    const result = applyOperation(state, (doc) => {
      setBlockAttrsInTx(doc, "p" as BlockId, { textAlign: "center" }, "test");
    });
    expect(getBlock(result.state, "p" as BlockId)?.attrs).toEqual({ textAlign: "center" });
    expect([...result.dirtyIds]).toEqual(["p"]);
  });

  it("composes multiple attr writes into ONE transaction (single dirty set)", () => {
    const state = fixture();
    const result = applyOperation(state, (doc) => {
      setBlockAttrsInTx(doc, "p" as BlockId, { textAlign: "right" }, "test");
      setBlockAttrsInTx(doc, "doc" as BlockId, { foo: 2 }, "test");
    });
    expect(getBlock(result.state, "p" as BlockId)?.attrs).toEqual({ textAlign: "right" });
    expect(getBlock(result.state, "doc" as BlockId)?.attrs).toEqual({ foo: 2 });
    expect(new Set(result.dirtyIds)).toEqual(new Set(["p", "doc"]));
  });
});

describe("setBlockAttrs — AttrRegistry custom equality (#263)", () => {
  // A `comment` interpreter whose equality ignores `timestamp` — two adjacent
  // comments with the same id but different timestamps are considered EQUAL.
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

  it("with registry: a same-id comment + different timestamp is a NO-OP (state ref preserved)", () => {
    const state = fixtureWithComment();
    const result = setBlockAttrs(
      state,
      "p" as BlockId,
      { comment: { id: "c1", timestamp: 2 } },
      commentRegistry,
    );
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
  });

  it("without registry: same-id + different timestamp mutates (default deep compare diverges)", () => {
    const state = fixtureWithComment();
    const result = setBlockAttrs(state, "p" as BlockId, {
      comment: { id: "c1", timestamp: 2 },
    });
    // Discriminator: without the registry, deepValueEqual sees timestamps differ
    // → not equal → mutation lands → state ref changes.
    expect(result.state).not.toBe(state);
    expect([...result.dirtyIds]).toEqual(["p"]);
  });

  it("with registry: a different-id comment still mutates (registry equality reports false)", () => {
    const state = fixtureWithComment();
    const result = setBlockAttrs(
      state,
      "p" as BlockId,
      { comment: { id: "c2", timestamp: 1 } },
      commentRegistry,
    );
    expect(result.state).not.toBe(state);
    expect([...result.dirtyIds]).toEqual(["p"]);
  });
});
