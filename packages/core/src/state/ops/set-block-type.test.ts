import { describe, it, expect } from "vitest";
import { setBlockType } from "./set-block-type";
import { getBlock } from "../state";
import type { BlockKind, BlockKindResolver } from "../block-kinds";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import type { BlockId } from "../block-id";

// Hand-rolled BlockKindResolver covering the built-in taxonomy. State
// tests deliberately avoid importing the component module — state ops
// depend only on the narrow `BlockKindResolver` shape, and that's all
// the test contract needs to exercise.
const TYPE_KINDS: Record<string, BlockKind> = {
  document: "container",
  table: "container",
  "table-row": "container",
  "table-cell": "container",
  paragraph: "inline-bearing-leaf",
  heading: "inline-bearing-leaf",
  "list-item": "inline-bearing-leaf",
  image: "atomic-leaf",
  "horizontal-line": "atomic-leaf",
};
const resolver: BlockKindResolver = {
  getBlockKind: (t) => TYPE_KINDS[t] ?? null,
};

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
    const result = setBlockType(state, "p" as BlockId, "heading", resolver);
    const updated = getBlock(result.state, "p" as BlockId);
    expect(updated?.type).toBe("heading");
    expect(updated?.id).toBe("p");
    expect(updated?.parentId).toBe("doc");
    expect(updated?.inlineContent).toEqual({ items: [] });
  });

  it("returns dirtyIds containing only the modified block", () => {
    const state = fixture();
    const result = setBlockType(state, "p" as BlockId, "heading", resolver);
    expect([...result.dirtyIds]).toEqual(["p"]);
  });

  // --- Same-type no-op short-circuit (#267) ---

  it("same-type call returns the literal input state and empty dirtyIds (no-op)", () => {
    const state = fixture();
    const result = setBlockType(state, "p" as BlockId, "paragraph", resolver);
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
  });

  it("genuine cross-type change still mutates (new state ref + dirty id)", () => {
    const state = fixture();
    const result = setBlockType(state, "p" as BlockId, "heading", resolver);
    expect(result.state).not.toBe(state);
    expect(result.dirtyIds.has("p" as BlockId)).toBe(true);
    expect(getBlock(result.state, "p" as BlockId)?.type).toBe("heading");
  });

  it("same-type call on an UNREGISTERED type still throws (short-circuit must not swallow the guard)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "x", lastChildId: "x" }),
        buildBlock({ id: "x", type: "no-such-type", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    // type === block.type ("no-such-type") but the type is unregistered;
    // the existence + registration guards run BEFORE the no-op short-circuit,
    // so this must still throw rather than silently short-circuit.
    expect(() => setBlockType(state, "x" as BlockId, "no-such-type", resolver)).toThrow(
      /existing block's type "no-such-type" is not registered/,
    );
  });

  it("throws when the block does not exist", () => {
    const state = fixture();
    expect(() => setBlockType(state, "missing" as BlockId, "heading", resolver)).toThrow(/not found/);
  });

  it("throws when the new type is not registered with the resolver", () => {
    const state = fixture();
    expect(() => setBlockType(state, "p" as BlockId, "unregistered-type", resolver)).toThrow(
      /new type "unregistered-type" is not registered/,
    );
  });

  it("throws when the existing block's type is not registered with the resolver", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "x", lastChildId: "x" }),
        buildBlock({ id: "x", type: "no-such-type", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    expect(() => setBlockType(state, "x" as BlockId, "paragraph", resolver)).toThrow(
      /existing block's type "no-such-type" is not registered/,
    );
  });

  // --- Shape-invariance (T11) ---

  it("allows same-kind change: paragraph -> heading (both inline-bearing-leaf)", () => {
    const state = fixture();
    const result = setBlockType(state, "p" as BlockId, "heading", resolver);
    expect(getBlock(result.state, "p" as BlockId)?.type).toBe("heading");
  });

  it("allows same-kind change: paragraph -> list-item (both inline-bearing-leaf)", () => {
    const state = fixture();
    const result = setBlockType(state, "p" as BlockId, "list-item", resolver);
    expect(getBlock(result.state, "p" as BlockId)?.type).toBe("list-item");
  });

  it("allows same-kind change: list-item -> paragraph (both inline-bearing-leaf)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li", lastChildId: "li" }),
        buildBlock({ id: "li", type: "list-item", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    const result = setBlockType(state, "li" as BlockId, "paragraph", resolver);
    expect(getBlock(result.state, "li" as BlockId)?.type).toBe("paragraph");
  });

  it("allows same-kind change: table -> table-row (both container)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "tbl", lastChildId: "tbl" }),
        buildBlock({ id: "tbl", type: "table", parentId: "doc" }),
      ],
    });
    const result = setBlockType(state, "tbl" as BlockId, "table-row", resolver);
    expect(getBlock(result.state, "tbl" as BlockId)?.type).toBe("table-row");
  });

  it("allows same-kind change: image -> horizontal-line (both atomic-leaf)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "img", lastChildId: "img" }),
        buildBlock({ id: "img", type: "image", parentId: "doc" }),
      ],
    });
    const result = setBlockType(state, "img" as BlockId, "horizontal-line", resolver);
    expect(getBlock(result.state, "img" as BlockId)?.type).toBe("horizontal-line");
  });

  it("refuses cross-kind change: paragraph -> table (inline-bearing-leaf -> container)", () => {
    const state = fixture();
    expect(() => setBlockType(state, "p" as BlockId, "table", resolver)).toThrow(
      /cross-kind change refused.*inline-bearing-leaf.*container/,
    );
  });

  it("refuses cross-kind change: image -> table (atomic-leaf -> container)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "img", lastChildId: "img" }),
        buildBlock({ id: "img", type: "image", parentId: "doc" }),
      ],
    });
    expect(() => setBlockType(state, "img" as BlockId, "table", resolver)).toThrow(
      /cross-kind change refused.*atomic-leaf.*container/,
    );
  });

  it("refuses cross-kind change: table -> paragraph (container -> inline-bearing-leaf)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "tbl", lastChildId: "tbl" }),
        buildBlock({ id: "tbl", type: "table", parentId: "doc" }),
      ],
    });
    expect(() => setBlockType(state, "tbl" as BlockId, "paragraph", resolver)).toThrow(
      /cross-kind change refused.*container.*inline-bearing-leaf/,
    );
  });
});

describe("setBlockType — BlockKindResolver interface", () => {
  it("accepts a minimal in-test resolver implementing BlockKindResolver", () => {
    // A test-only resolver: maps type strings to kinds via a Map. State
    // ops only need the BlockKindResolver shape — they don't depend on
    // the full ComponentRegistry.
    const testResolver = {
      getBlockKind: (t: string) => {
        if (t === "paragraph" || t === "heading") return "inline-bearing-leaf" as const;
        return null;
      },
    };
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    // "document" isn't in the test resolver — but since we're operating
    // on the "p" block (type "paragraph"), the document type is never
    // consulted. The cross-kind check needs only the existing block's
    // type and the new type.
    const result = setBlockType(state, "p" as BlockId, "heading", testResolver);
    expect(getBlock(result.state, "p" as BlockId)?.type).toBe("heading");
  });
});
