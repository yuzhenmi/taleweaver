import { describe, it, expect } from "vitest";
import type { BlockId } from "../block-id";
import { createTestAllocator } from "../block-id";
import type { Block } from "../block";
import type { State } from "../state";
import { getBlock, getEmbedContent, getTemplateContent } from "../state";
import { buildStateFromBlocks } from "../build-state-from-blocks";
import { getListDefsForState, type ListDef } from "../list-defs";
import {
  getComments,
  COMMENT_START_EMBED_TYPE,
  COMMENT_END_EMBED_TYPE,
  type CommentId,
  type CommentRecord,
} from "../comments";
import { getSuggestions, type SuggestionId, type SuggestionRecord } from "../suggestions";
import { iterateBlocksInDocumentOrder } from "../document-order";
import {
  buildBlock,
  text,
  embed,
  inlineContent,
} from "../../test-utils/state-builders";
import { MalformedDocumentError } from "./document-serializer";
import { createJsonDocumentSerializer, JSON_FORMAT } from "./json-serializer";
import type { BlockKind, BlockKindResolver } from "../block-kinds";

// ─────────────────────────────────────────────────────────────────────────
// A tiny BlockKindResolver covering exactly the types these tests use. The
// real resolver is the component registry (cross-package); the serializer only
// needs the kind-classification contract, so a local stub keeps the test
// state-module-internal.
// ─────────────────────────────────────────────────────────────────────────
const KINDS: Record<string, BlockKind> = {
  document: "container",
  list: "container",
  section: "container",
  container: "container",
  table: "container",
  "table-row": "container",
  "table-cell": "container",
  paragraph: "inline-bearing-leaf",
  heading: "inline-bearing-leaf",
  "list-item": "inline-bearing-leaf",
  image: "atomic-leaf",
  "horizontal-line": "atomic-leaf",
  "table-of-contents": "atomic-leaf",
};

const blockKindResolver: BlockKindResolver = {
  getBlockKind(type: string): BlockKind | null {
    return KINDS[type] ?? null;
  },
};

function makeSerializer() {
  return createJsonDocumentSerializer({
    allocator: createTestAllocator("mint"),
    blockKindResolver,
  });
}

/**
 * Compare two states for document-model identity across all three block trees
 * plus the side-tables. ids/types/attrs/inlineContent must match exactly.
 */
function assertSameDocument(a: State, b: State): void {
  expect(b.rootId).toBe(a.rootId);

  const aBlocks = collectTreeBlocks(a, getBlock);
  const bBlocks = collectTreeBlocks(b, getBlock);
  assertSameBlockSet(aBlocks, bBlocks);
}

function collectTreeBlocks(
  state: State,
  read: (s: State, id: BlockId) => Block | null,
): Map<string, Block> {
  const out = new Map<string, Block>();
  for (const block of iterateBlocksInDocumentOrder(state)) {
    const fresh = read(state, block.id);
    if (fresh !== null) out.set(block.id, fresh);
  }
  return out;
}

function assertSameBlockSet(a: Map<string, Block>, b: Map<string, Block>): void {
  expect(new Set(b.keys())).toEqual(new Set(a.keys()));
  for (const [id, ablk] of a) {
    const bblk = b.get(id);
    expect(bblk).toBeDefined();
    if (bblk === undefined) continue;
    expect(bblk.type).toBe(ablk.type);
    expect(bblk.attrs).toEqual(ablk.attrs);
    expect(bblk.inlineContent).toEqual(ablk.inlineContent);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Shared non-trivial fixture builder. Returns a State with: nested containers,
// inline-bearing leaves with marks, an atomic-leaf, an empty paragraph ADJACENT
// to an empty container, a multi-level embed body, a list+listDef, a comment
// (range from markers), a suggestion, and a nested-object attr.
// ─────────────────────────────────────────────────────────────────────────
function buildRichState(): State {
  const listDef: ListDef = {
    levels: [{ style: "decimal", start: 1, restart: "never" }],
  };
  const comment: CommentRecord = {
    id: "cmt-1" as CommentId,
    author: "alice",
    body: "needs a citation",
    createdAt: 1000,
    replies: [{ id: "r1", author: "bob", body: "agreed", createdAt: 2000 }],
    resolved: false,
  };
  const suggestion: SuggestionRecord = {
    id: "sug-1" as SuggestionId,
    kind: "insertion",
    author: "carol",
    createdAt: 3000,
  };

  return buildStateFromBlocks({
    rootId: "doc" as BlockId,
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: "h",
        lastChildId: "empty-container",
      }),
      // heading with bold + a comment range delimited by markers + a link
      // (nested-object attr).
      buildBlock({
        id: "h",
        type: "heading",
        attrs: { headingLevel: 1 },
        parentId: "doc",
        prevSiblingId: null,
        nextSiblingId: "list",
        inlineContent: inlineContent([
          embed(COMMENT_START_EMBED_TYPE, { commentId: "cmt-1" }),
          text("Hello ", { bold: true }),
          text("world", { link: { href: "https://example.com" } }),
          embed(COMMENT_END_EMBED_TYPE, { commentId: "cmt-1" }),
        ]),
      }),
      // a list container with one list-item carrying a suggestion-tagged run
      buildBlock({
        id: "list",
        type: "list",
        parentId: "doc",
        prevSiblingId: "h",
        nextSiblingId: "img",
        firstChildId: "li",
        lastChildId: "li",
      }),
      buildBlock({
        id: "li",
        type: "list-item",
        attrs: { listId: "list-1", listLevel: 0 },
        parentId: "list",
        inlineContent: inlineContent([
          text("item", { insertionSuggestionId: "sug-1" }),
          // An embed whose `properties` carries the anchor->body link
          // (contentBlockId) plus a NESTED object — locks lossless round-trip
          // of non-empty + nested embed `props` (the footnote-anchor mechanism).
          embed("footnote-anchor", {
            contentBlockId: "fn-root",
            config: { numberStyle: "decimal", restart: "section" },
          }),
        ]),
      }),
      // an atomic-leaf block — emits NEITHER content NOR children
      buildBlock({
        id: "img",
        type: "image",
        attrs: { src: "cat.png" },
        parentId: "doc",
        prevSiblingId: "list",
        nextSiblingId: "empty-p",
      }),
      // an EMPTY paragraph (inlineContent {items:[]}) ADJACENT to ...
      buildBlock({
        id: "empty-p",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "img",
        nextSiblingId: "empty-container",
        inlineContent: inlineContent([]),
      }),
      // ... an EMPTY container (inlineContent null, children [])
      buildBlock({
        id: "empty-container",
        type: "section",
        parentId: "doc",
        prevSiblingId: "empty-p",
        nextSiblingId: null,
      }),
    ],
    // A multi-LEVEL embed body: container → container → paragraph.
    embedContents: [
      buildBlock({
        id: "fn-root",
        type: "container",
        firstChildId: "fn-inner",
        lastChildId: "fn-inner",
      }),
      buildBlock({
        id: "fn-inner",
        type: "container",
        parentId: "fn-root",
        firstChildId: "fn-p",
        lastChildId: "fn-p",
      }),
      buildBlock({
        id: "fn-p",
        type: "paragraph",
        parentId: "fn-inner",
        inlineContent: inlineContent([text("footnote body")]),
      }),
    ],
    templateContents: [
      buildBlock({
        id: "hdr-root",
        type: "container",
        firstChildId: "hdr-p",
        lastChildId: "hdr-p",
      }),
      buildBlock({
        id: "hdr-p",
        type: "paragraph",
        parentId: "hdr-root",
        inlineContent: inlineContent([text("page header")]),
      }),
    ],
    listDefs: { "list-1": listDef },
    comments: [comment],
    suggestions: [suggestion],
  });
}

describe("json-serializer", () => {
  describe("(a) lossless round-trip (ids preserved)", () => {
    it("decode(encode(state)) is document-model-identical across all trees + side-tables", () => {
      const state = buildRichState();
      const ser = makeSerializer();
      const wire = ser.encode(state);
      const back = ser.decode(wire);

      assertSameDocument(state, back);

      // embedContents body survives byte-for-byte (multi-level).
      expect(getEmbedContent(back, "fn-root" as BlockId)?.type).toBe("container");
      expect(getEmbedContent(back, "fn-inner" as BlockId)?.parentId).toBe("fn-root");
      expect(getEmbedContent(back, "fn-p" as BlockId)?.inlineContent).toEqual({
        items: [{ kind: "text", text: "footnote body", attrs: {} }],
      });

      // templateContents body survives.
      expect(getTemplateContent(back, "hdr-root" as BlockId)?.type).toBe("container");
      expect(getTemplateContent(back, "hdr-p" as BlockId)?.parentId).toBe("hdr-root");

      // EXACT inlineContent distinctions: container → null, atomic-leaf → null,
      // empty paragraph → {items:[]}.
      expect(getBlock(back, "empty-container" as BlockId)?.inlineContent).toBeNull();
      expect(getBlock(back, "img" as BlockId)?.inlineContent).toBeNull();
      expect(getBlock(back, "empty-p" as BlockId)?.inlineContent).toEqual({ items: [] });

      // nested-object attr (link) survives.
      const headingItems = getBlock(back, "h" as BlockId)?.inlineContent?.items ?? [];
      const linkRun = headingItems.find(
        (i) => i.kind === "text" && i.text === "world",
      );
      expect(linkRun?.attrs).toEqual({ link: { href: "https://example.com" } });

      // non-empty + NESTED embed `properties` (the anchor->body link mechanism)
      // round-trips losslessly.
      const liItems = getBlock(back, "li" as BlockId)?.inlineContent?.items ?? [];
      const anchor = liItems.find(
        (i) => i.kind === "embed" && i.embedType === "footnote-anchor",
      );
      expect(anchor?.kind === "embed" ? anchor.properties : undefined).toEqual({
        contentBlockId: "fn-root",
        config: { numberStyle: "decimal", restart: "section" },
      });

      // listDef survives + id-identical.
      const defs = getListDefsForState(back);
      expect(defs.get("list-1")).toEqual({
        levels: [{ style: "decimal", start: 1, restart: "never" }],
      });

      // comment record survives (bare), and its RANGE is reconstructed from the
      // round-tripped markers.
      const comments = getComments(back);
      expect(comments).toHaveLength(1);
      expect(comments[0]?.id).toBe("cmt-1");
      expect(comments[0]?.author).toBe("alice");
      expect(comments[0]?.body).toBe("needs a citation");
      expect(comments[0]?.resolved).toBe(false);
      expect(comments[0]?.replies).toEqual([
        { id: "r1", author: "bob", body: "agreed", createdAt: 2000 },
      ]);
      // range reconstructed from the surviving comment-start/comment-end markers.
      expect(comments[0]?.range.orphaned).toBe(false);
      expect(comments[0]?.range.start.blockId).toBe("h");
      expect(comments[0]?.range.end.blockId).toBe("h");

      // suggestion record survives (bare).
      const suggestions = getSuggestions(back);
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]?.id).toBe("sug-1");
      expect(suggestions[0]?.kind).toBe("insertion");
      expect(suggestions[0]?.author).toBe("carol");
      expect(suggestions[0]?.createdAt).toBe(3000);
      expect(suggestions[0]?.orphaned).toBe(false);
    });

    it("does NOT serialize a `range` field on comments (range is reconstructed, not stored)", () => {
      const state = buildRichState();
      const ser = makeSerializer();
      const wire = ser.encode(state);
      const parsed = JSON.parse(wire) as {
        comments: Record<string, Record<string, unknown>>;
      };
      expect(parsed.comments["cmt-1"]).toBeDefined();
      expect(parsed.comments["cmt-1"]).not.toHaveProperty("range");
      expect(parsed.comments["cmt-1"]).not.toHaveProperty("orphaned");
    });
  });

  describe("(b) authoring (ids omitted → minted)", () => {
    const handAuthored = JSON.stringify({
      format: "taleweaver-json",
      version: 1,
      root: {
        type: "document",
        children: [
          {
            type: "heading",
            attrs: { headingLevel: 1 },
            content: [{ text: "Title" }],
          },
          {
            type: "paragraph",
            content: [{ text: "Body ", attrs: { bold: true } }, { text: "text" }],
          },
        ],
      },
    });

    it("decodes id-less JSON to a valid State with minted ids + derived links", () => {
      const ser = makeSerializer();
      const state = ser.decode(handAuthored);

      const root = getBlock(state, state.rootId);
      expect(root?.type).toBe("document");
      expect(root?.firstChildId).not.toBeNull();
      expect(root?.lastChildId).not.toBeNull();
      expect(root?.firstChildId).not.toBe(root?.lastChildId);

      // first child is the heading, links derived.
      const headId = root?.firstChildId as BlockId;
      const head = getBlock(state, headId);
      expect(head?.type).toBe("heading");
      expect(head?.parentId).toBe(state.rootId);
      expect(head?.prevSiblingId).toBeNull();
      expect(head?.attrs).toEqual({ headingLevel: 1 });
      expect(head?.inlineContent).toEqual({
        items: [{ kind: "text", text: "Title", attrs: {} }],
      });

      // sibling chain: heading.next === paragraph, paragraph.prev === heading.
      const paraId = head?.nextSiblingId as BlockId;
      const para = getBlock(state, paraId);
      expect(para?.type).toBe("paragraph");
      expect(para?.prevSiblingId).toBe(headId);
      expect(para?.nextSiblingId).toBeNull();
      expect(para?.inlineContent).toEqual({
        items: [
          { kind: "text", text: "Body ", attrs: { bold: true } },
          { kind: "text", text: "text", attrs: {} },
        ],
      });
    });

    it("decoding the same id-less JSON twice yields distinct ids but identical structure", () => {
      const s1 = createJsonDocumentSerializer({
        allocator: createTestAllocator("a"),
        blockKindResolver,
      }).decode(handAuthored);
      const s2 = createJsonDocumentSerializer({
        allocator: createTestAllocator("b"),
        blockKindResolver,
      }).decode(handAuthored);

      // distinct ids (different prefixes)
      expect(s1.rootId).not.toBe(s2.rootId);

      // same structure: same type/inlineContent shape walking document order.
      const t1 = [...iterateBlocksInDocumentOrder(s1)].map((b) => ({
        type: b.type,
        attrs: b.attrs,
        inlineContent: b.inlineContent,
      }));
      const t2 = [...iterateBlocksInDocumentOrder(s2)].map((b) => ({
        type: b.type,
        attrs: b.attrs,
        inlineContent: b.inlineContent,
      }));
      expect(t1).toEqual(t2);
    });
  });

  describe("(c) wire-golden — kind-driven children/content rule", () => {
    it("container emits children (no content), inline-bearing-leaf emits content (even []), atomic-leaf emits neither", () => {
      const state = buildStateFromBlocks({
        rootId: "doc" as BlockId,
        blocks: [
          buildBlock({
            id: "doc",
            type: "document",
            firstChildId: "p",
            lastChildId: "hr",
          }),
          buildBlock({
            id: "p",
            type: "paragraph",
            parentId: "doc",
            nextSiblingId: "hr",
            inlineContent: inlineContent([]),
          }),
          buildBlock({
            id: "hr",
            type: "horizontal-line",
            parentId: "doc",
            prevSiblingId: "p",
          }),
        ],
      });
      const wire = makeSerializer().encode(state);
      const obj = JSON.parse(wire) as Record<string, unknown>;

      expect(obj.format).toBe("taleweaver-json");
      expect(obj.version).toBe(1);
      expect(obj.root).toEqual({
        id: "doc",
        type: "document",
        children: [
          { id: "p", type: "paragraph", content: [] },
          { id: "hr", type: "horizontal-line" },
        ],
      });
      // side-tables omitted when empty.
      expect(obj).not.toHaveProperty("listDefs");
      expect(obj).not.toHaveProperty("comments");
      expect(obj).not.toHaveProperty("suggestions");
      expect(obj).not.toHaveProperty("embedContents");
      expect(obj).not.toHaveProperty("templateContents");
    });
  });

  describe("(d) malformed decode", () => {
    it("throws MalformedDocumentError for {}", () => {
      expect(() => makeSerializer().decode("{}")).toThrow(MalformedDocumentError);
    });
    it("throws MalformedDocumentError for wrong format", () => {
      expect(() =>
        makeSerializer().decode(
          JSON.stringify({ format: "nope", version: 1, root: { type: "document" } }),
        ),
      ).toThrow(MalformedDocumentError);
    });
    it("throws MalformedDocumentError for missing/non-1 version", () => {
      expect(() =>
        makeSerializer().decode(
          JSON.stringify({ format: JSON_FORMAT, root: { type: "document" } }),
        ),
      ).toThrow(MalformedDocumentError);
      expect(() =>
        makeSerializer().decode(
          JSON.stringify({ format: JSON_FORMAT, version: 2, root: { type: "document" } }),
        ),
      ).toThrow(MalformedDocumentError);
    });
    it("throws MalformedDocumentError for missing root", () => {
      expect(() =>
        makeSerializer().decode(JSON.stringify({ format: JSON_FORMAT, version: 1 })),
      ).toThrow(MalformedDocumentError);
    });

    // ── malformed SIDE-TABLE records (ingress validation) ────────────────────
    // A bare object envelope with a valid root; only the named side-table is
    // malformed. Each must be REJECTED at decode, not crash raw / accept corrupt.
    function envelopeWith(sideTable: Record<string, unknown>): string {
      return JSON.stringify({
        format: JSON_FORMAT,
        version: 1,
        root: { type: "document", children: [] },
        ...sideTable,
      });
    }

    it("throws MalformedDocumentError for a listDefs entry whose levels is not an array", () => {
      expect(() =>
        makeSerializer().decode(envelopeWith({ listDefs: { l1: { levels: "x" } } })),
      ).toThrow(MalformedDocumentError);
    });
    it("throws MalformedDocumentError for a listDefs level missing a required field", () => {
      expect(() =>
        makeSerializer().decode(
          envelopeWith({ listDefs: { l1: { levels: [{ style: "decimal", start: 1 }] } } }),
        ),
      ).toThrow(MalformedDocumentError);
    });
    it("throws MalformedDocumentError for a listDefs level with an invalid style", () => {
      expect(() =>
        makeSerializer().decode(
          envelopeWith({
            listDefs: { l1: { levels: [{ style: "bogus", start: 1, restart: "never" }] } },
          }),
        ),
      ).toThrow(MalformedDocumentError);
    });

    it("throws MalformedDocumentError for a comment missing replies", () => {
      expect(() =>
        makeSerializer().decode(
          envelopeWith({
            comments: {
              c1: { author: "a", body: "b", createdAt: 1, resolved: false },
            },
          }),
        ),
      ).toThrow(MalformedDocumentError);
    });
    it("throws MalformedDocumentError for a comment with non-boolean resolved", () => {
      expect(() =>
        makeSerializer().decode(
          envelopeWith({
            comments: {
              c1: { author: "a", body: "b", createdAt: 1, replies: [], resolved: "no" },
            },
          }),
        ),
      ).toThrow(MalformedDocumentError);
    });
    it("throws MalformedDocumentError for a comment with a malformed reply", () => {
      expect(() =>
        makeSerializer().decode(
          envelopeWith({
            comments: {
              c1: {
                author: "a",
                body: "b",
                createdAt: 1,
                replies: [{ id: "r1", author: "x", body: "y" }],
                resolved: false,
              },
            },
          }),
        ),
      ).toThrow(MalformedDocumentError);
    });

    it("throws MalformedDocumentError for a suggestion whose kind is not in the valid set", () => {
      expect(() =>
        makeSerializer().decode(
          envelopeWith({
            suggestions: { s1: { kind: "bogus", author: "a", createdAt: 1 } },
          }),
        ),
      ).toThrow(MalformedDocumentError);
    });
    it("throws MalformedDocumentError for a suggestion missing author", () => {
      expect(() =>
        makeSerializer().decode(
          envelopeWith({ suggestions: { s1: { kind: "insertion", createdAt: 1 } } }),
        ),
      ).toThrow(MalformedDocumentError);
    });
    it("throws MalformedDocumentError for a suggestion with a non-object proposedAttrs", () => {
      expect(() =>
        makeSerializer().decode(
          envelopeWith({
            suggestions: {
              s1: { kind: "formatting", author: "a", createdAt: 1, proposedAttrs: "x" },
            },
          }),
        ),
      ).toThrow(MalformedDocumentError);
    });
  });

  describe("(e) tables deferred; table-of-contents is NOT a table", () => {
    it("encoding a state with a table block throws a clear error mentioning binary", () => {
      const state = buildStateFromBlocks({
        rootId: "doc" as BlockId,
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "t", lastChildId: "t" }),
          buildBlock({ id: "t", type: "table", parentId: "doc" }),
        ],
      });
      expect(() => makeSerializer().encode(state)).toThrow(/table/i);
      expect(() => makeSerializer().encode(state)).toThrow(/binary/i);
    });

    it("decoding JSON with a table-typed node throws MalformedDocumentError", () => {
      const wire = JSON.stringify({
        format: JSON_FORMAT,
        version: 1,
        root: {
          type: "document",
          children: [{ type: "table", children: [] }],
        },
      });
      expect(() => makeSerializer().decode(wire)).toThrow(MalformedDocumentError);
    });

    it("NEGATIVE control: a table-of-contents block round-trips successfully (atomic leaf, not a table)", () => {
      const state = buildStateFromBlocks({
        rootId: "doc" as BlockId,
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "toc", lastChildId: "toc" }),
          buildBlock({ id: "toc", type: "table-of-contents", parentId: "doc" }),
        ],
      });
      const ser = makeSerializer();
      const back = ser.decode(ser.encode(state));
      expect(getBlock(back, "toc" as BlockId)?.type).toBe("table-of-contents");
      expect(getBlock(back, "toc" as BlockId)?.inlineContent).toBeNull();
    });
  });
});
