import { TEST_RESOLVER } from "../../test-utils/document-builders";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { asBlockId, createTestAllocator, type BlockId } from "../block-id";
import type { Block } from "../block";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}
import {
  buildDocumentFromBlocks,
  buildDocumentWithListDefs,
} from "../build-document-from-blocks";
import { createEmptyDocument } from "../create-empty-document";
import {
  getBlock,
  getEmbedContent,
  getTemplateContent,
  type Document,
} from "../document";
import { getListDefsForDocument, type ListDef } from "../list-defs";
import { addComment } from "../ops/comment-ops";
import { getComments, buildCommentRangeIndex, type CommentId } from "../comments";
import {
  writeSuggestionRecordInTx,
  readSuggestionRecord,
  INSERTION_SUGGESTION_ATTR,
  type SuggestionId,
  type SuggestionRecord,
} from "../suggestions";
import { applyOperation } from "../document";
import { splitWithSuggestion } from "../ops/split-block";
import { DOCUMENT_INTERNAL } from "../document-internal";
import { createPosition, createSpan } from "../block-position";
import type { InlineItem } from "../inline-content";
import { INLINE_IMAGE_EMBED_TYPE } from "../inline-content";
import type { DocumentSerializer } from "./document-serializer";
import {
  MalformedDocumentError,
  UnknownSerializerFormatError,
} from "./document-serializer";
import {
  createDefaultSerializerRegistry,
  createSerializerRegistry,
} from "./serializer-registry";
import {
  deserializeDocument,
  serializeDocument,
} from "./serialize-document";
import { BINARY_FORMAT, createBinaryDocumentSerializer } from "./binary-serializer";

const ID = (s: string): BlockId => asBlockId(s);

/**
 * Build a NON-TRIVIAL fixture exercising all three trees + a listDef:
 *   - main tree: a `document` root → two `paragraph` leaves with mixed inline
 *     content (styled text + an inline embed carrying embedType + properties);
 *   - one `embedContents` body (a footnote-like container + paragraph child);
 *   - one `templateContents` body (a header-like container + paragraph child);
 *   - one listDef.
 */
function buildRichFixture(): Document {
  const rootId = ID("root");
  const p1 = ID("p1");
  const p2 = ID("p2");

  const styledItems: InlineItem[] = [
    { kind: "text", text: "Hello ", attrs: { bold: true } },
    { kind: "text", text: "world", attrs: { italic: true, color: "#f00" } },
    {
      kind: "embed",
      embedType: "image",
      attrs: { link: "https://example.com" },
      properties: { src: "img.png", width: 42, alt: "an image" },
    },
    // #529: an inline-image embed (image that flows IN LINE with text). The
    // `embedType` is an open string discriminant, so survival is purely a
    // serializer concern: embedType + properties must round-trip intact.
    {
      kind: "embed",
      embedType: INLINE_IMAGE_EMBED_TYPE,
      attrs: {},
      properties: { src: "x.png", width: 40, height: 30, alt: "a" },
    },
  ];
  const plainItems: InlineItem[] = [
    { kind: "text", text: "second paragraph", attrs: {} },
  ];

  const blocks: Block[] = [
    {
      id: rootId,
      type: "document",
      attrs: { lang: "en" },
      parentId: null,
      prevSiblingId: null,
      nextSiblingId: null,
      firstChildId: p1,
      lastChildId: p2,
      inlineContent: null,
    },
    {
      id: p1,
      type: "paragraph",
      attrs: { textAlign: "center" },
      parentId: rootId,
      prevSiblingId: null,
      nextSiblingId: p2,
      firstChildId: null,
      lastChildId: null,
      inlineContent: { items: styledItems },
    },
    {
      id: p2,
      type: "paragraph",
      attrs: {},
      parentId: rootId,
      prevSiblingId: p1,
      nextSiblingId: null,
      firstChildId: null,
      lastChildId: null,
      inlineContent: { items: plainItems },
    },
  ];

  const embedRoot = ID("embed-root");
  const embedPara = ID("embed-para");
  const embedContents: Block[] = [
    {
      id: embedRoot,
      type: "footnote-body",
      attrs: {},
      parentId: null,
      prevSiblingId: null,
      nextSiblingId: null,
      firstChildId: embedPara,
      lastChildId: embedPara,
      inlineContent: null,
    },
    {
      id: embedPara,
      type: "paragraph",
      attrs: {},
      parentId: embedRoot,
      prevSiblingId: null,
      nextSiblingId: null,
      firstChildId: null,
      lastChildId: null,
      inlineContent: { items: [{ kind: "text", text: "footnote text", attrs: {} }] },
    },
  ];

  const tmplRoot = ID("tmpl-root");
  const tmplPara = ID("tmpl-para");
  const templateContents: Block[] = [
    {
      id: tmplRoot,
      type: "template-body",
      attrs: { region: "header" },
      parentId: null,
      prevSiblingId: null,
      nextSiblingId: null,
      firstChildId: tmplPara,
      lastChildId: tmplPara,
      inlineContent: null,
    },
    {
      id: tmplPara,
      type: "paragraph",
      attrs: {},
      parentId: tmplRoot,
      prevSiblingId: null,
      nextSiblingId: null,
      firstChildId: null,
      lastChildId: null,
      inlineContent: { items: [{ kind: "text", text: "header text", attrs: {} }] },
    },
  ];

  // The three-tree fixture (main + embedContents + templateContents). listDefs
  // round-tripping is covered by a dedicated test below (buildDocumentFromBlocks
  // does not seed listDefs; buildDocumentWithListDefs seeds them on a main-tree-only
  // state — the two dimensions are exercised separately).
  return buildDocumentFromBlocks({ resolver: TEST_RESOLVER,
    rootId,
    blocks,
    embedContents,
    templateContents,
  });
}

/** Assert a snapshot read is present and narrow it to a non-null Block. */
function requireBlock(actual: Block | null): Block {
  expect(actual).not.toBeNull();
  if (actual === null) throw new Error("expected a non-null block");
  return actual;
}

/** Deep-compare two blocks across the serialized fields. */
function expectBlockEqual(actual: Block | null, expected: Block): void {
  expect(actual).not.toBeNull();
  if (actual === null) return;
  expect(actual.type).toBe(expected.type);
  expect(actual.attrs).toEqual(expected.attrs);
  expect(actual.parentId).toBe(expected.parentId);
  expect(actual.prevSiblingId).toBe(expected.prevSiblingId);
  expect(actual.nextSiblingId).toBe(expected.nextSiblingId);
  expect(actual.firstChildId).toBe(expected.firstChildId);
  expect(actual.lastChildId).toBe(expected.lastChildId);
  expect(actual.inlineContent).toEqual(expected.inlineContent);
}

describe("serialize-document", () => {
  describe("round-trip (binary, lossless)", () => {
    it("round-trips a non-trivial three-tree document (main + embedContents + templateContents)", () => {
      const rootId = ID("root");
      const p1 = ID("p1");
      const p2 = ID("p2");
      const embedRoot = ID("embed-root");
      const embedPara = ID("embed-para");
      const tmplRoot = ID("tmpl-root");
      const tmplPara = ID("tmpl-para");

      const document = buildRichFixture();

      // Capture originals from the live state (frozen snapshots) for comparison.
      // requireBlock asserts presence + narrows, so every round-trip comparison
      // below is UNCONDITIONAL (no `if (orig)` guard that could silently skip an
      // assertion — the property is "every block round-trips exactly").
      const origRoot = requireBlock(getBlock(document, rootId));
      const origP1 = requireBlock(getBlock(document, p1));
      const origP2 = requireBlock(getBlock(document, p2));
      const origEmbedRoot = requireBlock(getEmbedContent(document, embedRoot));
      const origEmbedPara = requireBlock(getEmbedContent(document, embedPara));
      const origTmplRoot = requireBlock(getTemplateContent(document, tmplRoot));
      const origTmplPara = requireBlock(getTemplateContent(document, tmplPara));

      const reg = createDefaultSerializerRegistry({ blockKindResolver: TEST_RESOLVER });
      const bytes = serializeDocument(document, BINARY_FORMAT, reg);
      expect(bytes).toBeInstanceOf(Uint8Array);

      const document2 = deserializeDocument(bytes, BINARY_FORMAT, reg);
      expect(document2.rootId).toBe(document.rootId);

      expectBlockEqual(getBlock(document2, rootId), origRoot);
      expectBlockEqual(getBlock(document2, p1), origP1);
      expectBlockEqual(getBlock(document2, p2), origP2);

      // #529: the inline-image embed survives binary round-trip — embedType +
      // properties intact. (expectBlockEqual above already deep-compares
      // inlineContent; this pins the inline-image case explicitly.)
      const p1After = requireBlock(getBlock(document2, p1));
      const inlineImage = p1After.inlineContent?.items.find(
        (item): item is Extract<InlineItem, { kind: "embed" }> =>
          item.kind === "embed" && item.embedType === INLINE_IMAGE_EMBED_TYPE,
      );
      expect(inlineImage).toBeDefined();
      expect(inlineImage?.properties).toEqual({
        src: "x.png",
        width: 40,
        height: 30,
        alt: "a",
      });
      expectBlockEqual(getEmbedContent(document2, embedRoot), origEmbedRoot);
      expectBlockEqual(getEmbedContent(document2, embedPara), origEmbedPara);
      expectBlockEqual(getTemplateContent(document2, tmplRoot), origTmplRoot);
      expectBlockEqual(getTemplateContent(document2, tmplPara), origTmplPara);
    });

    it("round-trips listDefs losslessly", () => {
      const rootId = ID("ld-root");
      const para = ID("ld-para");
      const blocks: Block[] = [
        {
          id: rootId,
          type: "document",
          attrs: {},
          parentId: null,
          prevSiblingId: null,
          nextSiblingId: null,
          firstChildId: para,
          lastChildId: para,
          inlineContent: null,
        },
        {
          id: para,
          type: "list-item",
          attrs: { listId: "list-1", listLevel: 0 },
          parentId: rootId,
          prevSiblingId: null,
          nextSiblingId: null,
          firstChildId: null,
          lastChildId: null,
          inlineContent: { items: [{ kind: "text", text: "item", attrs: {} }] },
        },
      ];
      const listDefs: Record<string, ListDef> = {
        "list-1": {
          levels: [
            { style: "decimal", start: 1, restart: "always" },
            { style: "lower-alpha", start: 2, restart: "never" },
          ],
        },
      };
      const document = buildDocumentWithListDefs({ resolver: TEST_RESOLVER, rootId, blocks, listDefs });

      const reg = createDefaultSerializerRegistry({ blockKindResolver: TEST_RESOLVER });
      const bytes = serializeDocument(document, BINARY_FORMAT, reg);
      const document2 = deserializeDocument(bytes, BINARY_FORMAT, reg);

      const origDefs = getListDefsForDocument(document);
      const newDefs = getListDefsForDocument(document2);
      expect([...newDefs.entries()]).toEqual([...origDefs.entries()]);
      expect(newDefs.get("list-1")).toEqual(listDefs["list-1"]);
    });

    it("round-trips a comment losslessly (thread record + in-content markers)", () => {
      // A doc with a paragraph + a comment over part of its text. The binary
      // serializer captures the WHOLE Y.Doc, so both the `comments` map record
      // AND the in-content `comment-start`/`comment-end` marker embeds must
      // survive encode→decode with no new serializer code.
      const rootId = ID("c-root");
      const para = ID("c-para");
      const blocks: Block[] = [
        {
          id: rootId,
          type: "document",
          attrs: {},
          parentId: null,
          prevSiblingId: null,
          nextSiblingId: null,
          firstChildId: para,
          lastChildId: para,
          inlineContent: null,
        },
        {
          id: para,
          type: "paragraph",
          attrs: {},
          parentId: rootId,
          prevSiblingId: null,
          nextSiblingId: null,
          firstChildId: null,
          lastChildId: null,
          inlineContent: { items: [{ kind: "text", text: "hello world", attrs: {} }] },
        },
      ];
      const base = buildDocumentFromBlocks({ resolver: TEST_RESOLVER, rootId, blocks });
      const document = addComment(
        base,
        createSpan(createPosition(para, 6), createPosition(para, 11)),
        { id: "cm-1" as CommentId, author: "alice", body: "note", createdAt: 42 },
      ).document;

      const origComments = getComments(document);
      expect(origComments.length).toBe(1);

      const reg = createDefaultSerializerRegistry({ blockKindResolver: TEST_RESOLVER });
      const bytes = serializeDocument(document, BINARY_FORMAT, reg);
      const document2 = deserializeDocument(bytes, BINARY_FORMAT, reg);

      // The record survives (author/body/createdAt/resolved + empty replies).
      const newComments = getComments(document2);
      expect(newComments.length).toBe(1);
      expect(nth(newComments, 0, "comment").author).toBe("alice");
      expect(nth(newComments, 0, "comment").body).toBe("note");
      expect(nth(newComments, 0, "comment").createdAt).toBe(42);
      expect(nth(newComments, 0, "comment").resolved).toBe(false);
      expect(nth(newComments, 0, "comment").replies).toEqual([]);
      // The in-content markers survive: the range resolves live (not orphaned),
      // proving both `comment-start`/`comment-end` embeds round-tripped.
      expect(nth(newComments, 0, "comment").range.orphaned).toBe(false);
      expect(nth(newComments, 0, "comment").range).toEqual(nth(origComments, 0, "comment").range);
      expect(buildCommentRangeIndex(document2).get("cm-1" as CommentId)?.orphaned).toBe(false);
    });

    it("round-trips a suggestion losslessly (record + tagged TextItem + break tag)", () => {
      // A doc carrying change-tracking suggestions: `SuggestionRecord`s in the
      // 6th `suggestions` side-table, a TextItem tagged with
      // `insertionSuggestionId`, AND a paragraph-split boundary TAG on a block's
      // registry entry. The binary serializer captures the WHOLE Y.Doc, so all
      // survive encode→decode with no new serializer code.
      const rootId = ID("s-root");
      const para = ID("s-para");
      const record: SuggestionRecord = {
        id: "sg-1" as SuggestionId,
        kind: "insertion",
        author: "alice",
        createdAt: 99,
      };
      const blocks: Block[] = [
        {
          id: rootId,
          type: "document",
          attrs: {},
          parentId: null,
          prevSiblingId: null,
          nextSiblingId: null,
          firstChildId: para,
          lastChildId: para,
          inlineContent: null,
        },
        {
          id: para,
          type: "paragraph",
          attrs: {},
          parentId: rootId,
          prevSiblingId: null,
          nextSiblingId: null,
          firstChildId: null,
          lastChildId: null,
          inlineContent: {
            items: [
              { kind: "text", text: "kept ", attrs: {} },
              {
                kind: "text",
                text: "added",
                attrs: { [INSERTION_SUGGESTION_ATTR]: record.id },
              },
              { kind: "text", text: " tail", attrs: {} },
            ],
          },
        },
      ];
      const base = buildDocumentFromBlocks({ resolver: TEST_RESOLVER, rootId, blocks });
      // Side-table-only write surfaces state.rootId (the comments/listDefs
      // precedent) so applyOperation advances state.
      const withRecord = applyOperation(base, (doc) => {
        writeSuggestionRecordInTx(doc, record);
        return new Set<BlockId>([base.rootId]);
      }).document;
      const splitRecord: SuggestionRecord = { id: "sg-2" as SuggestionId, kind: "insertion", author: "bob", createdAt: 100 };
      const split = splitWithSuggestion(withRecord, createPosition(para, 10), createTestAllocator("t"), splitRecord);
      const document = split.document;

      const reg = createDefaultSerializerRegistry({ blockKindResolver: TEST_RESOLVER });
      const bytes = serializeDocument(document, BINARY_FORMAT, reg);
      const document2 = deserializeDocument(bytes, BINARY_FORMAT, reg);

      // The side-table record survives.
      const doc2 = document2[DOCUMENT_INTERNAL].doc;
      expect(readSuggestionRecord(doc2, record.id)).toEqual(record);
      expect(readSuggestionRecord(doc2, splitRecord.id)).toEqual(splitRecord);

      // The tagged TextItem survives (the whole paragraph round-trips, incl. the
      // suggestion attr), and the split's tail keeps its boundary tag.
      const origPara = requireBlock(getBlock(document, para));
      expectBlockEqual(getBlock(document2, para), origPara);
      expectBlockEqual(getBlock(document2, split.newBlockId), requireBlock(getBlock(document, split.newBlockId)));
      expect(getBlock(document2, split.newBlockId)?.breakSuggestion).toEqual({ insertionId: splitRecord.id });
    });

    it("round-trips an empty document (rootId + root block preserved)", () => {
      const document = createEmptyDocument({ resolver: TEST_RESOLVER });
      const reg = createDefaultSerializerRegistry({ blockKindResolver: TEST_RESOLVER });
      const bytes = serializeDocument(document, BINARY_FORMAT, reg);
      const document2 = deserializeDocument(bytes, BINARY_FORMAT, reg);

      expect(document2.rootId).toBe(document.rootId);
      const root = getBlock(document2, document.rootId);
      expect(root).not.toBeNull();
      expect(root?.type).toBe("document");
    });
  });

  describe("registry", () => {
    it("createDefaultSerializerRegistry pre-registers the binary serializer", () => {
      const reg = createDefaultSerializerRegistry({ blockKindResolver: TEST_RESOLVER });
      expect(reg.has(BINARY_FORMAT)).toBe(true);
      expect(reg.get(BINARY_FORMAT)?.format).toBe(BINARY_FORMAT);
    });

    it("createSerializerRegistry starts empty", () => {
      const reg = createSerializerRegistry();
      expect(reg.has(BINARY_FORMAT)).toBe(false);
      expect(reg.get(BINARY_FORMAT)).toBeUndefined();
    });

    it("register/get/has store by serializer.format", () => {
      const reg = createSerializerRegistry();
      const fake: DocumentSerializer = {
        format: "fake-format",
        encode: () => "fake",
        decode: () => createEmptyDocument({ resolver: TEST_RESOLVER }),
      };
      expect(reg.has("fake-format")).toBe(false);
      reg.register(fake);
      expect(reg.has("fake-format")).toBe(true);
      expect(reg.get("fake-format")).toBe(fake);
    });
  });

  describe("error paths", () => {
    it("serializeDocument throws UnknownSerializerFormatError for an unregistered format", () => {
      const reg = createSerializerRegistry();
      const document = createEmptyDocument({ resolver: TEST_RESOLVER });
      expect(() => serializeDocument(document, "no-such-format", reg)).toThrow(
        UnknownSerializerFormatError,
      );
    });

    it("deserializeDocument throws UnknownSerializerFormatError for an unregistered format", () => {
      const reg = createSerializerRegistry();
      expect(() =>
        deserializeDocument(new Uint8Array(), "no-such-format", reg),
      ).toThrow(UnknownSerializerFormatError);
    });

    it("binary decode throws MalformedDocumentError when the decoded doc has no rootId", () => {
      const reg = createDefaultSerializerRegistry({ blockKindResolver: TEST_RESOLVER });
      // A bare Y.Doc has no meta.rootId seeded. Its update applies cleanly but
      // carries no rootId — the specific MalformedDocument path the code owns.
      const empty = new Y.Doc();
      const update = Y.encodeStateAsUpdate(empty);
      expect(() => deserializeDocument(update, BINARY_FORMAT, reg)).toThrow(
        MalformedDocumentError,
      );
    });
  });

  describe("binary serializer factory", () => {
    it("exposes the stable BINARY_FORMAT id", () => {
      const s = createBinaryDocumentSerializer({ blockKindResolver: TEST_RESOLVER });
      expect(s.format).toBe(BINARY_FORMAT);
      expect(BINARY_FORMAT).toBe("taleweaver-binary");
    });
  });
});
