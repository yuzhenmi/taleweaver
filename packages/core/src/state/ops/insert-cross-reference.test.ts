import { describe, it, expect } from "vitest";
import { insertCrossReference, CROSS_REFERENCE_EMBED_TYPE } from "./insert-cross-reference";
import { getBlock, getEmbedContent } from "../state";
import { createPosition } from "../block-position";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import type { BlockId } from "../block-id";
import type { State } from "../state";
import type { EmbedItem } from "../inline-content";

/** doc → [paragraph "Hello", heading "Title"]. The heading is the reference target. */
function docWithTarget(): State {
  return buildState({
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

function itemsOf(state: State, blockId: string) {
  return getBlock(state, blockId as BlockId)?.inlineContent?.items ?? [];
}

describe("insertCrossReference", () => {
  it("splices a cross-reference embed at the caret offset, carrying {targetId, refMode}", () => {
    const state = docWithTarget();
    const result = insertCrossReference(state, createPosition("p" as BlockId, 5), "h" as BlockId, "text");

    expect(result.state).not.toBe(state);
    // ONLY the host leaf is dirty — the target is untouched (a reference is a pointer).
    expect([...result.dirtyIds]).toEqual(["p"]);

    const items = itemsOf(result.state, "p");
    expect(items.length).toBe(2);
    expect(items[0]).toMatchObject({ kind: "text", text: "Hello" });
    const embed = items[1] as EmbedItem;
    expect(embed.kind).toBe("embed");
    expect(embed.embedType).toBe(CROSS_REFERENCE_EMBED_TYPE);
    // The pointer lives in `properties.targetId` (NOT `contentBlockId`) so the embed
    // cascade scanners ignore it — a reference owns no body.
    expect(embed.properties).toEqual({ targetId: "h", refMode: "text" });
    expect("contentBlockId" in embed.properties).toBe(false);
  });

  it("inserts at offset 0 (before the text run)", () => {
    const state = docWithTarget();
    const result = insertCrossReference(state, createPosition("p" as BlockId, 0), "h" as BlockId, "number");
    const items = itemsOf(result.state, "p");
    expect((items[0] as EmbedItem).embedType).toBe(CROSS_REFERENCE_EMBED_TYPE);
    expect((items[0] as EmbedItem).properties).toEqual({ targetId: "h", refMode: "number" });
    expect(items[1]).toMatchObject({ kind: "text", text: "Hello" });
  });

  it("splices mid-text (offset 2 splits the run into He | ref | llo)", () => {
    const state = docWithTarget();
    const result = insertCrossReference(state, createPosition("p" as BlockId, 2), "h" as BlockId, "text");
    const items = itemsOf(result.state, "p");
    expect(items.length).toBe(3);
    expect(items[0]).toMatchObject({ kind: "text", text: "He" });
    expect((items[1] as EmbedItem).embedType).toBe(CROSS_REFERENCE_EMBED_TYPE);
    expect(items[2]).toMatchObject({ kind: "text", text: "llo" });
  });

  it("creates NO embed-content body (a reference is a pointer, not an owner)", () => {
    const state = docWithTarget();
    const result = insertCrossReference(state, createPosition("p" as BlockId, 5), "h" as BlockId, "text");
    // The target "h" stays a MAIN-tree block — no body was created in embedContents for it.
    // (The op also runs assertNoOrphanedEmbedContent / assertNoSharedEmbedContent inside
    // applyOperation; not throwing confirms the targetId-keyed embed is ignored by them.)
    expect(getEmbedContent(result.state, "h" as BlockId)).toBeNull();
    expect(getEmbedContent(result.state, "p" as BlockId)).toBeNull();
  });

  it("throws when the position's block does not resolve", () => {
    const state = docWithTarget();
    expect(() => insertCrossReference(state, createPosition("nope" as BlockId, 0), "h" as BlockId, "text")).toThrow();
  });

  it("throws when the host is not a leaf (no inlineContent)", () => {
    const state = docWithTarget();
    expect(() => insertCrossReference(state, createPosition("doc" as BlockId, 0), "h" as BlockId, "text")).toThrow();
  });

  it("throws when the offset is out of range", () => {
    const state = docWithTarget();
    expect(() => insertCrossReference(state, createPosition("p" as BlockId, 99), "h" as BlockId, "text")).toThrow();
  });

  it('stores numberStyle for "page" mode (layout-dependent page-number reference)', () => {
    const state = docWithTarget();
    const result = insertCrossReference(
      state,
      createPosition("p" as BlockId, 5),
      "h" as BlockId,
      "page",
      "lower-roman",
    );
    const items = itemsOf(result.state, "p");
    const embed = items[1] as EmbedItem;
    expect(embed.embedType).toBe(CROSS_REFERENCE_EMBED_TYPE);
    expect(embed.properties).toEqual({ targetId: "h", refMode: "page", numberStyle: "lower-roman" });
  });

  it('defaults numberStyle to "decimal" for "page" mode when omitted', () => {
    const state = docWithTarget();
    const result = insertCrossReference(state, createPosition("p" as BlockId, 5), "h" as BlockId, "page");
    const embed = itemsOf(result.state, "p")[1] as EmbedItem;
    expect(embed.properties).toEqual({ targetId: "h", refMode: "page", numberStyle: "decimal" });
  });

  it('does NOT add numberStyle for "number" / "text" modes (properties byte-identical to before)', () => {
    const state = docWithTarget();
    const numberEmbed = itemsOf(
      insertCrossReference(state, createPosition("p" as BlockId, 5), "h" as BlockId, "number").state,
      "p",
    )[1] as EmbedItem;
    expect(numberEmbed.properties).toEqual({ targetId: "h", refMode: "number" });
    expect("numberStyle" in numberEmbed.properties).toBe(false);

    const textEmbed = itemsOf(
      insertCrossReference(state, createPosition("p" as BlockId, 5), "h" as BlockId, "text").state,
      "p",
    )[1] as EmbedItem;
    expect(textEmbed.properties).toEqual({ targetId: "h", refMode: "text" });
    expect("numberStyle" in textEmbed.properties).toBe(false);
  });
});
