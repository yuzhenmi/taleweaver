/**
 * F-0: `insertPageField` — a page-field (page-number / page-count) inline embed.
 *
 * Mirrors `insert-cross-reference.test.ts`: a pointer-property embed with NO
 * owned body, spliced into the cursor leaf's inline content in one
 * `applyOperation` (one undo unit). One Position offset / one IFC token (#407).
 */
import { describe, it, expect } from "vitest";
import { insertPageField, PAGE_FIELD_EMBED_TYPE } from "./insert-page-field";
import { getBlock } from "../document";
import { createPosition } from "../block-position";
import { inlineContentLength } from "../inline-content";
import { buildBlock, buildDocument, inlineContent, text } from "../../test-utils/document-builders";
import type { BlockId } from "../block-id";
import type { Document } from "../document";
import type { EmbedItem } from "../inline-content";

/** doc → [paragraph `content`]. */
function docWithParagraph(content: string): Document {
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text(content)]) }),
    ],
  });
}

function itemsOf(document: Document, blockId: string) {
  return getBlock(document, blockId as BlockId)?.inlineContent?.items ?? [];
}

describe("insertPageField", () => {
  it("splices a page-number field as one embed item occupying one offset", () => {
    const document = docWithParagraph("abcdef"); // 6 chars
    const before = getBlock(document, "p" as BlockId);
    if (before === null || before.inlineContent === null) throw new Error("seed failed");
    const lenBefore = inlineContentLength(before.inlineContent);

    const result = insertPageField(document, createPosition("p" as BlockId, 3), "page-number");
    expect(result.document).not.toBe(document);
    // ONLY the host leaf is dirty (a page-field is a pointer, owns no body).
    expect([...result.dirtyIds]).toEqual(["p"]);

    const after = getBlock(result.document, "p" as BlockId);
    if (after === null || after.inlineContent === null) throw new Error("missing block");
    // one offset added (the embed) — #407 one-token-one-offset
    expect(inlineContentLength(after.inlineContent)).toBe(lenBefore + 1);

    const embed = itemsOf(result.document, "p").find(
      (it) => it.kind === "embed" && it.embedType === PAGE_FIELD_EMBED_TYPE,
    ) as EmbedItem | undefined;
    if (embed === undefined) throw new Error("no embed");
    expect(embed.properties).toEqual({ fieldKind: "page-number", numberStyle: "decimal" }); // default style
    expect("contentBlockId" in embed.properties).toBe(false); // no owned body
  });

  it("inserts at offset 0 (before the text run)", () => {
    const document = docWithParagraph("abc");
    const result = insertPageField(document, createPosition("p" as BlockId, 0), "page-count");
    const items = itemsOf(result.document, "p");
    expect((items[0] as EmbedItem).embedType).toBe(PAGE_FIELD_EMBED_TYPE);
    expect(items[1]).toMatchObject({ kind: "text", text: "abc" });
  });

  it("defaults numberStyle to decimal and accepts an explicit style", () => {
    const document = docWithParagraph("x");
    const result = insertPageField(document, createPosition("p" as BlockId, 0), "page-count", "lower-roman");
    const embed = itemsOf(result.document, "p").find(
      (it) => it.kind === "embed" && it.embedType === PAGE_FIELD_EMBED_TYPE,
    ) as EmbedItem | undefined;
    if (embed === undefined) throw new Error("no embed");
    expect(embed.properties).toEqual({ fieldKind: "page-count", numberStyle: "lower-roman" });
  });

  it("throws when the offset is out of range", () => {
    const document = docWithParagraph("abc");
    expect(() => insertPageField(document, createPosition("p" as BlockId, 99), "page-number")).toThrow();
  });

  it("throws when the block is not found", () => {
    const document = docWithParagraph("abc");
    expect(() => insertPageField(document, createPosition("nope" as BlockId, 0), "page-number")).toThrow();
  });

  it("throws when the host is not a leaf (no inlineContent)", () => {
    const document = docWithParagraph("abc");
    // "doc" is a container block — it has no inlineContent.
    expect(() => insertPageField(document, createPosition("doc" as BlockId, 0), "page-number")).toThrow();
  });
});
