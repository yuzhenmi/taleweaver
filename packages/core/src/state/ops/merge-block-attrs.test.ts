import { describe, it, expect } from "vitest";
import { mergeBlockAttrs } from "./merge-block-attrs";
import { getBlock } from "../document";
import { buildBlock, buildDocument, inlineContent, withTestAttrs } from "../../test-utils/document-builders";
import type { BlockId } from "../block-id";
import { AttrRegistry } from "../../cascade/attr-registry";

describe("mergeBlockAttrs", () => {
  const fixture = (existingAttrs: Record<string, unknown> = {}) =>
    buildDocument({
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
    const document = fixture({});
    const result = mergeBlockAttrs(document, "p" as BlockId, { bold: true });
    expect(getBlock(result.document, "p" as BlockId)?.attrs).toEqual({ bold: true });
  });

  it("preserves existing keys not present in incoming (union)", () => {
    const document = fixture({ bold: true });
    const result = mergeBlockAttrs(document, "p" as BlockId, { italic: true });
    expect(getBlock(result.document, "p" as BlockId)?.attrs).toEqual({
      bold: true,
      italic: true,
    });
  });

  it("overwrites a key when present in both existing and incoming", () => {
    const document = fixture({ bold: true });
    const result = mergeBlockAttrs(document, "p" as BlockId, { bold: false });
    expect(getBlock(result.document, "p" as BlockId)?.attrs).toEqual({ bold: false });
  });

  it("removes a key when incoming value is undefined", () => {
    const document = fixture({ bold: true });
    const result = mergeBlockAttrs(document, "p" as BlockId, { bold: undefined });
    expect(getBlock(result.document, "p" as BlockId)?.attrs).toEqual({});
  });

  it("preserves other keys when removing one via undefined", () => {
    const document = fixture({ bold: true, italic: true });
    const result = mergeBlockAttrs(document, "p" as BlockId, { bold: undefined });
    expect(getBlock(result.document, "p" as BlockId)?.attrs).toEqual({ italic: true });
  });

  it("is a no-op when incoming is empty (state reference identity preserved)", () => {
    const document = fixture({ bold: true });
    const result = mergeBlockAttrs(document, "p" as BlockId, {});
    expect(result.document).toBe(document);
    expect(result.dirtyIds.size).toBe(0);
    expect(getBlock(result.document, "p" as BlockId)?.attrs).toEqual({ bold: true });
  });

  it("is a no-op when incoming merges to the same bag (state reference identity preserved)", () => {
    const document = fixture({ bold: true });
    const result = mergeBlockAttrs(document, "p" as BlockId, { bold: true });
    // The merged result is structurally equal to existing. The op's
    // attrsEqual short-circuit must skip the Y.Map write entirely so
    // applyOperation returns the input state reference unchanged (the identity-no-op contract;
    // no-op contract). This is the more interesting case than empty
    // incoming — it pins the structural-equality short-circuit.
    expect(result.document).toBe(document);
    expect(result.dirtyIds.size).toBe(0);
    expect(getBlock(result.document, "p" as BlockId)?.attrs).toEqual({ bold: true });
  });

  it("returns dirtyIds containing the modified block when attrs changed", () => {
    const document = fixture({});
    const result = mergeBlockAttrs(document, "p" as BlockId, { bold: true });
    expect([...result.dirtyIds]).toEqual(["p"]);
  });

  it("does not modify the original state (immutability of the input handle)", () => {
    const document = fixture({ bold: true });
    mergeBlockAttrs(document, "p" as BlockId, { italic: true });
    expect(getBlock(document, "p" as BlockId)?.attrs).toEqual({ bold: true });
  });

  it("throws when the block does not exist", () => {
    const document = fixture();
    expect(() => mergeBlockAttrs(document, "missing" as BlockId, { bold: true })).toThrow(
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
    buildDocument({
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
    const document = withTestAttrs(fixtureWithComment(), commentRegistry);
    const result = mergeBlockAttrs(
      document,
      "p" as BlockId,
      { comment: { id: "c1", timestamp: 2 } },
    );
    expect(result.document).toBe(document);
    expect(result.dirtyIds.size).toBe(0);
  });

  it("without registry: same-id + different timestamp mutates (deep compare diverges)", () => {
    const document = fixtureWithComment();
    const result = mergeBlockAttrs(document, "p" as BlockId, {
      comment: { id: "c1", timestamp: 2 },
    });
    expect(result.document).not.toBe(document);
    expect([...result.dirtyIds]).toEqual(["p"]);
  });
});
