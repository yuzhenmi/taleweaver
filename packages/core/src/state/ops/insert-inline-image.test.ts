/**
 * #529 T6: `insertInlineImage` — an `inline-image` inline embed.
 *
 * Mirrors `insert-page-field.test.ts`: a data-property embed with NO owned body,
 * spliced into the cursor leaf's inline content in one `applyOperation` (one undo
 * unit). One Position offset / one IFC token (#407). Unlike a footnote anchor it
 * OWNS NOTHING — no `contentBlockId`.
 */
import { describe, it, expect } from "vitest";
import { insertInlineImage, type InlineImageProperties } from "./insert-inline-image";
import { getBlock } from "../state";
import { createPosition } from "../block-position";
import { inlineContentLength, INLINE_IMAGE_EMBED_TYPE } from "../inline-content";
import { buildBlock, buildState, inlineContent, text } from "../../test-utils/state-builders";
import type { BlockId } from "../block-id";
import type { State } from "../state";
import type { EmbedItem } from "../inline-content";

const IMG: InlineImageProperties = {
  src: "data:image/png;base64,AAAA",
  width: 120,
  height: 80,
  alt: "a cat",
};

/** doc → [paragraph `content`]. */
function docWithParagraph(content: string): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text(content)]) }),
    ],
  });
}

function itemsOf(state: State, blockId: string) {
  return getBlock(state, blockId as BlockId)?.inlineContent?.items ?? [];
}

describe("insertInlineImage", () => {
  it("splices the image as one embed item mid-paragraph, text intact on both sides, owns nothing", () => {
    const state = docWithParagraph("abcdef"); // 6 chars
    const before = getBlock(state, "p" as BlockId);
    if (before === null || before.inlineContent === null) throw new Error("seed failed");
    const lenBefore = inlineContentLength(before.inlineContent);

    const result = insertInlineImage(state, createPosition("p" as BlockId, 3), IMG);
    expect(result.state).not.toBe(state);
    // ONLY the host leaf is dirty (an inline image is a data atom, owns no body).
    expect([...result.dirtyIds]).toEqual(["p"]);

    const after = getBlock(result.state, "p" as BlockId);
    if (after === null || after.inlineContent === null) throw new Error("missing block");
    // one offset added (the embed) — #407 one-token-one-offset
    expect(inlineContentLength(after.inlineContent)).toBe(lenBefore + 1);

    // [text "abc", inline-image embed, text "def"] — NOT merged across the embed.
    const items = itemsOf(result.state, "p");
    expect(items.length).toBe(3);
    expect(items[0]).toMatchObject({ kind: "text", text: "abc" });
    expect(items[2]).toMatchObject({ kind: "text", text: "def" });

    const embed = items[1] as EmbedItem;
    expect(embed.kind).toBe("embed");
    expect(embed.embedType).toBe(INLINE_IMAGE_EMBED_TYPE);
    // properties round-trip exactly.
    expect(embed.properties).toEqual({
      src: "data:image/png;base64,AAAA",
      width: 120,
      height: 80,
      alt: "a cat",
    });
    // "owns nothing" invariant — no embedContents body pointer.
    expect("contentBlockId" in embed.properties).toBe(false);
  });

  it("inserts at offset 0 (before the text run)", () => {
    const state = docWithParagraph("abc");
    const result = insertInlineImage(state, createPosition("p" as BlockId, 0), IMG);
    const items = itemsOf(result.state, "p");
    expect((items[0] as EmbedItem).embedType).toBe(INLINE_IMAGE_EMBED_TYPE);
    expect(items[1]).toMatchObject({ kind: "text", text: "abc" });
  });

  it("throws when the offset is negative", () => {
    const state = docWithParagraph("abc");
    expect(() => insertInlineImage(state, createPosition("p" as BlockId, -1), IMG)).toThrow();
  });

  it("throws when the offset is greater than the content length", () => {
    const state = docWithParagraph("abc");
    expect(() => insertInlineImage(state, createPosition("p" as BlockId, 99), IMG)).toThrow();
  });

  it("throws when the block is not found", () => {
    const state = docWithParagraph("abc");
    expect(() => insertInlineImage(state, createPosition("nope" as BlockId, 0), IMG)).toThrow();
  });

  it("throws when the host is not a leaf (no inlineContent)", () => {
    const state = docWithParagraph("abc");
    // "doc" is a container block — it has no inlineContent.
    expect(() => insertInlineImage(state, createPosition("doc" as BlockId, 0), IMG)).toThrow();
  });
});
