import { describe, it, expect } from "vitest";
import { insertCrossReference, CROSS_REFERENCE_EMBED_TYPE } from "./insert-cross-reference";
import { BOOKMARK_START_EMBED_TYPE, BOOKMARK_END_EMBED_TYPE } from "../bookmarks";
import { getBlock, getEmbedContent } from "../document";
import { createPosition } from "../block-position";
import { buildBlock, buildDocument, inlineContent } from "../../test-utils/document-builders";
import type { BlockId } from "../block-id";
import type { Document } from "../document";
import type { EmbedItem } from "../inline-content";

/** doc → [paragraph "Hello", heading "Title"]. The heading is the reference target. */
function docWithTarget(): Document {
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "h" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "h",
        inlineContent: inlineContent([{ kind: "text", text: "Hello", attrs: {} }]),
      }),
      buildBlock({
        id: "h",
        type: "heading",
        parentId: "doc",
        prevSiblingId: "p",
        attrs: { level: 1 },
        inlineContent: inlineContent([{ kind: "text", text: "Title", attrs: {} }]),
      }),
    ],
  });
}

function itemsOf(document: Document, blockId: string) {
  return getBlock(document, blockId as BlockId)?.inlineContent?.items ?? [];
}

describe("insertCrossReference", () => {
  it("splices a cross-reference embed at the caret offset, carrying {bookmarkId, refMode}, and bookmarks the target (Word's _Ref)", () => {
    const document = docWithTarget();
    const result = insertCrossReference(document, createPosition("p" as BlockId, 5), "h" as BlockId, "text");

    expect(result.document).not.toBe(document);
    // The host gets the field; the target gets its bookmark markers (same transaction).
    expect([...result.dirtyIds].sort()).toEqual(["h", "p"]);
    const bid = (itemsOf(result.document, "p")[1] as EmbedItem).properties.bookmarkId;
    expect(typeof bid).toBe("string");
    expect(itemsOf(result.document, "h")).toEqual([
      { kind: "embed", embedType: BOOKMARK_START_EMBED_TYPE, attrs: {}, properties: { bookmarkId: bid } },
      { kind: "text", text: "Title", attrs: {} },
      { kind: "embed", embedType: BOOKMARK_END_EMBED_TYPE, attrs: {}, properties: { bookmarkId: bid } },
    ]);
    // A second field to the same paragraph REUSES the exact bookmark (Word reuses _Ref).
    const again = insertCrossReference(result.document, createPosition("p" as BlockId, 0), "h" as BlockId, "number");
    expect([...again.dirtyIds]).toEqual(["p"]);
    expect((itemsOf(again.document, "p")[0] as EmbedItem).properties).toEqual({ bookmarkId: bid, refMode: "number" });

    const items = itemsOf(result.document, "p");
    expect(items.length).toBe(2);
    expect(items[0]).toMatchObject({ kind: "text", text: "Hello" });
    const embed = items[1] as EmbedItem;
    expect(embed.kind).toBe("embed");
    expect(embed.embedType).toBe(CROSS_REFERENCE_EMBED_TYPE);
    // The pointer lives in `properties.bookmarkId` (NOT `contentBlockId`) so the embed
    // cascade scanners ignore it — a reference owns no body.
    expect(embed.properties).toEqual({ bookmarkId: bid, refMode: "text" });
    expect("contentBlockId" in embed.properties).toBe(false);
  });

  it("reuses an exact bookmark over the target only when it is its id's LIVE pair", () => {
    // p holds the id's first start, so the live pair of "X" runs p → h: h's exact markers are not it.
    const marked = (embedType: string) => ({ kind: "embed" as const, embedType, attrs: {}, properties: { bookmarkId: "X" } });
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "h" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "h",
          inlineContent: inlineContent([marked(BOOKMARK_START_EMBED_TYPE), { kind: "text", text: "Hello", attrs: {} }]),
        }),
        buildBlock({
          id: "h",
          type: "heading",
          parentId: "doc",
          prevSiblingId: "p",
          attrs: { level: 1 },
          inlineContent: inlineContent([marked(BOOKMARK_START_EMBED_TYPE), { kind: "text", text: "Title", attrs: {} }, marked(BOOKMARK_END_EMBED_TYPE)]),
        }),
      ],
    });
    const result = insertCrossReference(document, createPosition("p" as BlockId, 6), "h" as BlockId, "text");
    const bid = (itemsOf(result.document, "p")[2] as EmbedItem).properties.bookmarkId;
    expect(bid).not.toBe("X");
    expect(itemsOf(result.document, "h").map((i) => (i.kind === "embed" ? i.properties.bookmarkId : i.text))).toEqual([bid, "X", "Title", "X", bid]);
    // h's leading / trailing "X" markers but the live pair ends mid-text: not exact either.
    const short = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "h" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "h", inlineContent: inlineContent([{ kind: "text", text: "Hello", attrs: {} }]) }),
        buildBlock({
          id: "h",
          type: "heading",
          parentId: "doc",
          prevSiblingId: "p",
          attrs: { level: 1 },
          inlineContent: inlineContent([
            marked(BOOKMARK_START_EMBED_TYPE),
            { kind: "text", text: "Ti", attrs: {} },
            marked(BOOKMARK_END_EMBED_TYPE),
            { kind: "text", text: "tle", attrs: {} },
            marked(BOOKMARK_END_EMBED_TYPE),
          ]),
        }),
      ],
    });
    const again = insertCrossReference(short, createPosition("p" as BlockId, 5), "h" as BlockId, "text");
    expect((itemsOf(again.document, "p")[1] as EmbedItem).properties.bookmarkId).not.toBe("X");
  });

  it("inserts at offset 0 (before the text run)", () => {
    const document = docWithTarget();
    const result = insertCrossReference(document, createPosition("p" as BlockId, 0), "h" as BlockId, "number");
    const items = itemsOf(result.document, "p");
    expect((items[0] as EmbedItem).embedType).toBe(CROSS_REFERENCE_EMBED_TYPE);
    expect((items[0] as EmbedItem).properties).toEqual({ bookmarkId: expect.any(String), refMode: "number" });
    expect(items[1]).toMatchObject({ kind: "text", text: "Hello" });
  });

  it("splices mid-text (offset 2 splits the run into He | ref | llo)", () => {
    const document = docWithTarget();
    const result = insertCrossReference(document, createPosition("p" as BlockId, 2), "h" as BlockId, "text");
    const items = itemsOf(result.document, "p");
    expect(items.length).toBe(3);
    expect(items[0]).toMatchObject({ kind: "text", text: "He" });
    expect((items[1] as EmbedItem).embedType).toBe(CROSS_REFERENCE_EMBED_TYPE);
    expect(items[2]).toMatchObject({ kind: "text", text: "llo" });
  });

  it("creates NO embed-content body (a reference is a pointer, not an owner)", () => {
    const document = docWithTarget();
    const result = insertCrossReference(document, createPosition("p" as BlockId, 5), "h" as BlockId, "text");
    // The target "h" stays a MAIN-tree block — no body was created in embedContents for it.
    // (The op also runs assertNoOrphanedEmbedContent / assertNoSharedEmbedContent inside
    // applyOperation; not throwing confirms the bookmarkId-keyed embed is ignored by them.)
    expect(getEmbedContent(result.document, "h" as BlockId)).toBeNull();
    expect(getEmbedContent(result.document, "p" as BlockId)).toBeNull();
  });

  it("throws when the position's block does not resolve", () => {
    const document = docWithTarget();
    expect(() => insertCrossReference(document, createPosition("nope" as BlockId, 0), "h" as BlockId, "text")).toThrow();
  });

  it("throws when the host is not a leaf (no inlineContent)", () => {
    const document = docWithTarget();
    expect(() => insertCrossReference(document, createPosition("doc" as BlockId, 0), "h" as BlockId, "text")).toThrow();
  });

  it("throws when the offset is out of range", () => {
    const document = docWithTarget();
    expect(() => insertCrossReference(document, createPosition("p" as BlockId, 99), "h" as BlockId, "text")).toThrow();
  });

  it('stores numberStyle for "page" mode (layout-dependent page-number reference)', () => {
    const document = docWithTarget();
    const result = insertCrossReference(
      document,
      createPosition("p" as BlockId, 5),
      "h" as BlockId,
      "page",
      "lower-roman",
    );
    const items = itemsOf(result.document, "p");
    const embed = items[1] as EmbedItem;
    expect(embed.embedType).toBe(CROSS_REFERENCE_EMBED_TYPE);
    expect(embed.properties).toEqual({ bookmarkId: expect.any(String), refMode: "page", numberStyle: "lower-roman" });
  });

  it('defaults numberStyle to "decimal" for "page" mode when omitted', () => {
    const document = docWithTarget();
    const result = insertCrossReference(document, createPosition("p" as BlockId, 5), "h" as BlockId, "page");
    const embed = itemsOf(result.document, "p")[1] as EmbedItem;
    expect(embed.properties).toEqual({ bookmarkId: expect.any(String), refMode: "page", numberStyle: "decimal" });
  });

  it('does NOT add numberStyle for "number" / "text" modes (properties byte-identical to before)', () => {
    const document = docWithTarget();
    const numberEmbed = itemsOf(
      insertCrossReference(document, createPosition("p" as BlockId, 5), "h" as BlockId, "number").document,
      "p",
    )[1] as EmbedItem;
    expect(numberEmbed.properties).toEqual({ bookmarkId: expect.any(String), refMode: "number" });
    expect("numberStyle" in numberEmbed.properties).toBe(false);

    const textEmbed = itemsOf(
      insertCrossReference(document, createPosition("p" as BlockId, 5), "h" as BlockId, "text").document,
      "p",
    )[1] as EmbedItem;
    expect(textEmbed.properties).toEqual({ bookmarkId: expect.any(String), refMode: "text" });
    expect("numberStyle" in textEmbed.properties).toBe(false);
  });
});
