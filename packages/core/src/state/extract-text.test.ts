import { describe, it, expect } from "vitest";
import { extractText, builtinEmbedSerializer, type EmbedSerializer } from "./extract-text";
import { buildBlock, buildState, text, embed, inlineContent } from "../test-utils/state-builders";
import { createPosition, createSpan } from "./block-position";
import type { BlockId } from "./block-id";
import {
  BLOCK_JOIN_SUGGESTION_EMBED_TYPE,
  BLOCK_SPLIT_SUGGESTION_EMBED_TYPE,
} from "./suggestions";

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

    it("builtin serializer maps a page-field embed to \"\" (value is layout-dependent, not known here)", () => {
      // A page-field's value depends on pagination (the page it lands on / the total
      // count), which layout-independent text extraction cannot know — so it serializes
      // to "" (1 Position offset, 0 chars), like a comment marker. Without this case it
      // would fall through to U+FFFC and pollute extractText / getWordCount.
      const state = buildState({
        rootId: "doc",
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
          buildBlock({
            id: "p", type: "paragraph", parentId: "doc",
            inlineContent: inlineContent([
              text("a"),
              embed("page-field", { fieldKind: "page-number", numberStyle: "decimal" }),
              text("b"),
            ]),
          }),
        ],
      });
      const span = createSpan(createPosition("p" as BlockId, 0), createPosition("p" as BlockId, 3));
      expect(extractText(state, span, builtinEmbedSerializer)).toBe("ab");
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

describe("extractText — 5c-structural block-boundary merge projection", () => {
  // Two paragraphs whose boundary carries a break-suggestion embed at the END of
  // the FIRST block. In the view where that embed is resolved AWAY the blocks MERGE,
  // so the inter-block "\n" is suppressed (the text concatenates exactly as the real
  // mergeAdjacentBlocksInTx would: no separator, no space).
  function twoBlocks(boundaryEmbedType: string): ReturnType<typeof buildState> {
    return buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({
          id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2",
          inlineContent: inlineContent([text("Hello"), embed(boundaryEmbedType, { suggestionId: "s1" })]),
        }),
        buildBlock({
          id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1",
          inlineContent: inlineContent([text("World")]),
        }),
      ],
    });
  }
  // p1 length = "Hello"(5) + embed(1) = 6; p2 = "World"(5).
  const wholeSpan = createSpan(createPosition("p1" as BlockId, 0), createPosition("p2" as BlockId, 5));

  it("accepted JOIN (final view): merges — the inter-block \\n is suppressed", () => {
    const state = twoBlocks(BLOCK_JOIN_SUGGESTION_EMBED_TYPE);
    // final: the join embed is resolved away → blocks merge → "HelloWorld".
    expect(extractText(state, wholeSpan, builtinEmbedSerializer, "final")).toBe("HelloWorld");
    // original: the join is KEPT (deletion rejected) → blocks stay split.
    expect(extractText(state, wholeSpan, builtinEmbedSerializer, "original")).toBe("Hello\nWorld");
    // suggesting: literal — always split.
    expect(extractText(state, wholeSpan, builtinEmbedSerializer, "suggesting")).toBe("Hello\nWorld");
  });

  it("rejected SPLIT (original view): merges — the inter-block \\n is suppressed", () => {
    const state = twoBlocks(BLOCK_SPLIT_SUGGESTION_EMBED_TYPE);
    // original: the split embed is resolved away → blocks merge → "HelloWorld".
    expect(extractText(state, wholeSpan, builtinEmbedSerializer, "original")).toBe("HelloWorld");
    // final: the split is KEPT (insertion accepted) → blocks stay split.
    expect(extractText(state, wholeSpan, builtinEmbedSerializer, "final")).toBe("Hello\nWorld");
    // suggesting: literal — always split.
    expect(extractText(state, wholeSpan, builtinEmbedSerializer, "suggesting")).toBe("Hello\nWorld");
  });

  it("a plain (non-break) inter-block boundary keeps the \\n in every view", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("Hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([text("World")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p2" as BlockId, 5));
    for (const view of ["suggesting", "final", "original"] as const) {
      expect(extractText(state, span, builtinEmbedSerializer, view)).toBe("Hello\nWorld");
    }
  });
});
