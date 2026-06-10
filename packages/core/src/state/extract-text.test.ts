import { describe, it, expect } from "vitest";
import { extractText, builtinEmbedSerializer, type EmbedSerializer } from "./extract-text";
import { buildBlock, buildState, text, embed, inlineContent } from "../test-utils/state-builders";
import { createPosition, createSpan } from "./block-position";
import type { BlockId } from "./block-id";

describe("extractText", () => {
  it("extracts text from a single text item, full range", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5));
    expect(extractText(state, span)).toBe("hello");
  });

  it("extracts a partial range within a single text item", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 1), createPosition("p" as BlockId, 4));
    expect(extractText(state, span)).toBe("ell");
  });

  it("concatenates multiple text items in the same block", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([text("hello"), text(" "), text("world")]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 11));
    expect(extractText(state, span)).toBe("hello world");
  });

  it("represents embed items as a single Object Replacement Character (U+FFFC)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p", type: "paragraph", parentId: "doc",
          inlineContent: inlineContent([text("a"), embed("image"), text("b")]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3));
    expect(extractText(state, span)).toBe("a￼b");
  });

  it("joins multi-block spans with newlines", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p2" as BlockId, 5));
    expect(extractText(state, span)).toBe("hello\nworld");
  });

  it("returns empty string for a collapsed span", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hello")]) }),
      ],
    });
    const pos = createPosition("p" as BlockId, 2);
    const span = createSpan(pos, pos);
    expect(extractText(state, span)).toBe("");
  });

  it("emits a trailing newline when a multi-block span ends at offset 0 of the focus block", () => {
    // This locks in the Word/Google Docs convention for "select to start
    // of next paragraph" — the trailing \n represents the paragraph break.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("world")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p2" as BlockId, 0));
    expect(extractText(state, span)).toBe("hello\n");
  });

  describe("embed serializer (T17)", () => {
    it("default serializer maps a hard-break embed to U+FFFC (preserves legacy contract)", () => {
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
          buildBlock({
            id: "p", type: "paragraph", parentId: "doc",
            inlineContent: inlineContent([text("a"), embed("hard-break"), text("b")]),
          }),
        ],
      });
      const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3));
      expect(extractText(state, span)).toBe("a￼b");
    });

    it("builtin serializer maps a hard-break embed to \\n", () => {
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
          buildBlock({
            id: "p", type: "paragraph", parentId: "doc",
            inlineContent: inlineContent([text("a"), embed("hard-break"), text("b")]),
          }),
        ],
      });
      const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3));
      expect(extractText(state, span, builtinEmbedSerializer)).toBe("a\nb");
    });

    it("builtin serializer maps a tab embed to \\t", () => {
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
          buildBlock({
            id: "p", type: "paragraph", parentId: "doc",
            inlineContent: inlineContent([text("a"), embed("tab"), text("b")]),
          }),
        ],
      });
      const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3));
      expect(extractText(state, span, builtinEmbedSerializer)).toBe("a\tb");
    });

    it("builtin serializer falls back to U+FFFC for unknown embed types", () => {
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
          buildBlock({
            id: "p", type: "paragraph", parentId: "doc",
            inlineContent: inlineContent([text("a"), embed("image"), text("b")]),
          }),
        ],
      });
      const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3));
      expect(extractText(state, span, builtinEmbedSerializer)).toBe("a￼b");
    });

    it("caller-provided custom serializer is used in place of default and builtin", () => {
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
          buildBlock({
            id: "p", type: "paragraph", parentId: "doc",
            inlineContent: inlineContent([
              text("a"),
              embed("hard-break"),
              embed("tab"),
              embed("image"),
              text("b"),
            ]),
          }),
        ],
      });
      const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 5));
      const custom: EmbedSerializer = (item) => `<${item.embedType}>`;
      expect(extractText(state, span, custom)).toBe("a<hard-break><tab><image>b");
    });
  });
});

describe("extractText — SuggestionView projection (slice 5c-ii)", () => {
  // doc > p( "keep" + <ins>"INS"</ins> + <del>"DEL"</del> + "tail" ) — offsets
  // 0..4 keep, 4..7 ins, 7..10 del, 10..14 tail (literal length 14).
  function build(): ReturnType<typeof buildState> {
    return buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("keep"),
            text("INS", { insertionSuggestionId: "s-ins" }),
            text("DEL", { deletionSuggestionId: "s-del" }),
            text("tail"),
          ]),
        }),
      ],
    });
  }
  const fullSpan = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 14));

  it('"suggesting" (default) extracts the literal text — both insertion and deletion shown', () => {
    const state = build();
    expect(extractText(state, fullSpan)).toBe("keepINSDELtail");
    expect(extractText(state, fullSpan, builtinEmbedSerializer, "suggesting")).toBe("keepINSDELtail");
  });

  it('"final" (accept all) keeps the insertion, drops the deletion text', () => {
    const state = build();
    expect(extractText(state, fullSpan, builtinEmbedSerializer, "final")).toBe("keepINStail");
  });

  it('"original" (reject all) drops the insertion, keeps the deletion text', () => {
    const state = build();
    expect(extractText(state, fullSpan, builtinEmbedSerializer, "original")).toBe("keepDELtail");
  });

  it("filters a break embed by view even under the default (U+FFFC) serializer", () => {
    // doc > p( "a" + <block-join>embed</block-join> + "b" ) — the join embed is
    // visible (→ U+FFFC) in "suggesting" but dropped in "final" (accept-all
    // deletes the join), exercising itemVisibleInView's EMBED branch through
    // extractText independently of builtinEmbedSerializer's ""-mapping.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("a"),
            embed("block-join-suggestion", { suggestionId: "s" }),
            text("b"),
          ]),
        }),
      ],
    });
    const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3));
    // Default serializer maps the embed to U+FFFC under the literal view…
    expect(extractText(state, span)).toBe("a￼b");
    // …but "final" drops the join embed entirely (no U+FFFC), offsets intact.
    expect(extractText(state, span, undefined, "final")).toBe("ab");
  });

  it("a filtered-out run does not shift the offsets of later runs (span is literal-domain)", () => {
    // Sub-span starting INSIDE the deletion run (offset 8) through tail: the
    // deletion's literal offsets are still consumed, so "final" yields just the
    // post-deletion tail (the deletion run contributes nothing).
    const state = build();
    const sub = createSpan(createPosition("p" as BlockId, 8), createPosition("p" as BlockId, 14));
    expect(extractText(state, sub, builtinEmbedSerializer, "final")).toBe("tail");
    // "suggesting" includes the "EL" tail of the deletion run + "tail".
    expect(extractText(state, sub, builtinEmbedSerializer, "suggesting")).toBe("ELtail");
  });
});
