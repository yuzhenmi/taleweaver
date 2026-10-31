import { describe, it, expect } from "vitest";
import { setBlockType } from "./set-block-type";
import { getBlock } from "../document";
import type { BlockKind, BlockKindResolver } from "../block-kinds";
import { registryWith, testContainer, testLeaf, TEST_RESOLVER, buildBlock, buildDocument, inlineContent, finalSectionOf } from "../../test-utils/document-builders";
import type { BlockId } from "../block-id";

// Hand-rolled BlockKindResolver covering the built-in taxonomy. Document
// tests deliberately avoid importing the component module — state ops
// depend only on the narrow `BlockKindResolver` shape, and that's all
// the test contract needs to exercise.
const TYPE_KINDS: Record<string, BlockKind> = {
  document: "container",
  table: "container",
  "table-row": "container",
  "table-cell": "container",
  blockquote: "container",
  aside: "container",
  paragraph: "inline-bearing-leaf",
  heading: "inline-bearing-leaf",
  "list-item": "inline-bearing-leaf",
  image: "atomic-leaf",
  "horizontal-line": "atomic-leaf",
};
const resolver: BlockKindResolver = {
  getBlockKind: (t) => TYPE_KINDS[t] ?? null,
  getStorageShape: (t) => TEST_RESOLVER.getStorageShape(t),
};

describe("setBlockType", () => {
  const fixture = () =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });

  it("replaces the block's type and preserves all other fields", () => {
    const document = fixture();
    const result = setBlockType(document, "p" as BlockId, "heading", resolver);
    const updated = getBlock(result.document, "p" as BlockId);
    expect(updated?.type).toBe("heading");
    expect(updated?.id).toBe("p");
    expect(updated?.parentId).toBe(finalSectionOf(result.document));
    expect(updated?.inlineContent).toEqual({ items: [] });
  });

  it("returns dirtyIds containing only the modified block", () => {
    const document = fixture();
    const result = setBlockType(document, "p" as BlockId, "heading", resolver);
    expect([...result.dirtyIds]).toEqual(["p"]);
  });

  // --- Same-type no-op short-circuit (#267) ---

  it("same-type call returns the literal input state and empty dirtyIds (no-op)", () => {
    const document = fixture();
    const result = setBlockType(document, "p" as BlockId, "paragraph", resolver);
    expect(result.document).toBe(document);
    expect(result.dirtyIds.size).toBe(0);
  });

  it("genuine cross-type change still mutates (new state ref + dirty id)", () => {
    const document = fixture();
    const result = setBlockType(document, "p" as BlockId, "heading", resolver);
    expect(result.document).not.toBe(document);
    expect(result.dirtyIds.has("p" as BlockId)).toBe(true);
    expect(getBlock(result.document, "p" as BlockId)?.type).toBe("heading");
  });

  it("same-type call on an UNREGISTERED type still throws (short-circuit must not swallow the guard)", () => {
    const document = buildDocument({
      resolver: registryWith(testLeaf("no-such-type", "inline-bearing")), // the STATE knows it; the op resolver does not
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "x", lastChildId: "x" }),
        buildBlock({ id: "x", type: "no-such-type", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    // type === block.type ("no-such-type") but the type is unregistered;
    // the existence + registration guards run BEFORE the no-op short-circuit,
    // so this must still throw rather than silently short-circuit.
    expect(() => setBlockType(document, "x" as BlockId, "no-such-type", resolver)).toThrow(
      /existing block's type "no-such-type" is not registered/,
    );
  });

  it("throws when the block does not exist", () => {
    const document = fixture();
    expect(() => setBlockType(document, "missing" as BlockId, "heading", resolver)).toThrow(/not found/);
  });

  it("throws when the new type is not registered with the resolver", () => {
    const document = fixture();
    expect(() => setBlockType(document, "p" as BlockId, "unregistered-type", resolver)).toThrow(
      /new type "unregistered-type" is not registered/,
    );
  });

  it("throws when the existing block's type is not registered with the resolver", () => {
    const document = buildDocument({
      resolver: registryWith(testLeaf("no-such-type", "inline-bearing")), // the STATE knows it; the op resolver does not
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "x", lastChildId: "x" }),
        buildBlock({ id: "x", type: "no-such-type", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    expect(() => setBlockType(document, "x" as BlockId, "paragraph", resolver)).toThrow(
      /existing block's type "no-such-type" is not registered/,
    );
  });

  // --- Shape-invariance (T11) ---

  it("allows same-kind change: paragraph -> heading (both inline-bearing-leaf)", () => {
    const document = fixture();
    const result = setBlockType(document, "p" as BlockId, "heading", resolver);
    expect(getBlock(result.document, "p" as BlockId)?.type).toBe("heading");
  });

  it("allows same-kind change: paragraph -> list-item (both inline-bearing-leaf)", () => {
    const document = fixture();
    const result = setBlockType(document, "p" as BlockId, "list-item", resolver);
    expect(getBlock(result.document, "p" as BlockId)?.type).toBe("list-item");
  });

  it("allows same-kind change: list-item -> paragraph (both inline-bearing-leaf)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "li", lastChildId: "li" }),
        buildBlock({ id: "li", type: "list-item", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    const result = setBlockType(document, "li" as BlockId, "paragraph", resolver);
    expect(getBlock(result.document, "li" as BlockId)?.type).toBe("paragraph");
  });

  it("allows same-kind, same-storage-shape change: blockquote -> aside (both plain containers)", () => {
    TEST_RESOLVER.register(testContainer("blockquote"));
    TEST_RESOLVER.register(testContainer("aside"));
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "bq", lastChildId: "bq" }),
        buildBlock({ id: "bq", type: "blockquote", parentId: "doc" }),
      ],
    });
    const result = setBlockType(document, "bq" as BlockId, "aside", resolver);
    expect(getBlock(result.document, "bq" as BlockId)?.type).toBe("aside");
  });

  it("refuses a same-kind change across storage shapes: table -> table-row", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "tbl", lastChildId: "tbl" }),
        buildBlock({ id: "tbl", type: "table", parentId: "doc" }),
      ],
    });
    expect(() => setBlockType(document, "tbl" as BlockId, "table-row", resolver)).toThrow(/cross-storage-shape/);
  });

  it("allows same-kind change: image -> horizontal-line (both atomic-leaf)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "img", lastChildId: "img" }),
        buildBlock({ id: "img", type: "image", parentId: "doc" }),
      ],
    });
    const result = setBlockType(document, "img" as BlockId, "horizontal-line", resolver);
    expect(getBlock(result.document, "img" as BlockId)?.type).toBe("horizontal-line");
  });

  it("refuses cross-kind change: paragraph -> table (inline-bearing-leaf -> container)", () => {
    const document = fixture();
    expect(() => setBlockType(document, "p" as BlockId, "table", resolver)).toThrow(
      /cross-kind change refused.*inline-bearing-leaf.*container/,
    );
  });

  it("refuses cross-kind change: image -> table (atomic-leaf -> container)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "img", lastChildId: "img" }),
        buildBlock({ id: "img", type: "image", parentId: "doc" }),
      ],
    });
    expect(() => setBlockType(document, "img" as BlockId, "table", resolver)).toThrow(
      /cross-kind change refused.*atomic-leaf.*container/,
    );
  });

  it("refuses cross-kind change: table -> paragraph (container -> inline-bearing-leaf)", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "tbl", lastChildId: "tbl" }),
        buildBlock({ id: "tbl", type: "table", parentId: "doc" }),
      ],
    });
    expect(() => setBlockType(document, "tbl" as BlockId, "paragraph", resolver)).toThrow(
      /cross-kind change refused.*container.*inline-bearing-leaf/,
    );
  });
});

describe("setBlockType — BlockKindResolver interface", () => {
  it("accepts a minimal in-test resolver implementing BlockKindResolver", () => {
    // A test-only resolver: maps type strings to kinds via a Map. Document
    // ops only need the BlockKindResolver shape — they don't depend on
    // the full ComponentRegistry.
    const testResolver = {
      getBlockKind: (t: string) => {
        if (t === "paragraph" || t === "heading") return "inline-bearing-leaf" as const;
        return null;
      },
      getStorageShape: (t: string) => TEST_RESOLVER.getStorageShape(t),
    };
    const document = buildDocument({
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
    const result = setBlockType(document, "p" as BlockId, "heading", testResolver);
    expect(getBlock(result.document, "p" as BlockId)?.type).toBe("heading");
  });
});
