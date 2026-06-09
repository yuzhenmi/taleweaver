import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { asBlockId, type BlockId } from "../block-id";
import type { Block } from "../block";
import {
  buildStateFromBlocks,
  buildStateWithListDefs,
} from "../build-state-from-blocks";
import { createEmptyDocument } from "../initial-state";
import {
  getBlock,
  getEmbedContent,
  getTemplateContent,
  type State,
} from "../state";
import { getListDefsForState, type ListDef } from "../list-defs";
import { addComment } from "../ops/comment-ops";
import { getComments, buildCommentRangeIndex, type CommentId } from "../comments";
import { createPosition, createSpan } from "../block-position";
import type { InlineItem } from "../inline-content";
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
function buildRichFixture(): State {
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
  // round-tripping is covered by a dedicated test below (buildStateFromBlocks
  // does not seed listDefs; buildStateWithListDefs seeds them on a main-tree-only
  // state — the two dimensions are exercised separately).
  return buildStateFromBlocks({
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

      const state = buildRichFixture();

      // Capture originals from the live state (frozen snapshots) for comparison.
      // requireBlock asserts presence + narrows, so every round-trip comparison
      // below is UNCONDITIONAL (no `if (orig)` guard that could silently skip an
      // assertion — the property is "every block round-trips exactly").
      const origRoot = requireBlock(getBlock(state, rootId));
      const origP1 = requireBlock(getBlock(state, p1));
      const origP2 = requireBlock(getBlock(state, p2));
      const origEmbedRoot = requireBlock(getEmbedContent(state, embedRoot));
      const origEmbedPara = requireBlock(getEmbedContent(state, embedPara));
      const origTmplRoot = requireBlock(getTemplateContent(state, tmplRoot));
      const origTmplPara = requireBlock(getTemplateContent(state, tmplPara));

      const reg = createDefaultSerializerRegistry();
      const bytes = serializeDocument(state, BINARY_FORMAT, reg);
      expect(bytes).toBeInstanceOf(Uint8Array);

      const state2 = deserializeDocument(bytes, BINARY_FORMAT, reg);
      expect(state2.rootId).toBe(state.rootId);

      expectBlockEqual(getBlock(state2, rootId), origRoot);
      expectBlockEqual(getBlock(state2, p1), origP1);
      expectBlockEqual(getBlock(state2, p2), origP2);
      expectBlockEqual(getEmbedContent(state2, embedRoot), origEmbedRoot);
      expectBlockEqual(getEmbedContent(state2, embedPara), origEmbedPara);
      expectBlockEqual(getTemplateContent(state2, tmplRoot), origTmplRoot);
      expectBlockEqual(getTemplateContent(state2, tmplPara), origTmplPara);
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
      const state = buildStateWithListDefs({ rootId, blocks, listDefs });

      const reg = createDefaultSerializerRegistry();
      const bytes = serializeDocument(state, BINARY_FORMAT, reg);
      const state2 = deserializeDocument(bytes, BINARY_FORMAT, reg);

      const origDefs = getListDefsForState(state);
      const newDefs = getListDefsForState(state2);
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
      const base = buildStateFromBlocks({ rootId, blocks });
      const state = addComment(
        base,
        createSpan(createPosition(para, 6), createPosition(para, 11)),
        { id: "cm-1" as CommentId, author: "alice", body: "note", createdAt: 42 },
      ).state;

      const origComments = getComments(state);
      expect(origComments.length).toBe(1);

      const reg = createDefaultSerializerRegistry();
      const bytes = serializeDocument(state, BINARY_FORMAT, reg);
      const state2 = deserializeDocument(bytes, BINARY_FORMAT, reg);

      // The record survives (author/body/createdAt/resolved + empty replies).
      const newComments = getComments(state2);
      expect(newComments.length).toBe(1);
      expect(newComments[0].author).toBe("alice");
      expect(newComments[0].body).toBe("note");
      expect(newComments[0].createdAt).toBe(42);
      expect(newComments[0].resolved).toBe(false);
      expect(newComments[0].replies).toEqual([]);
      // The in-content markers survive: the range resolves live (not orphaned),
      // proving both `comment-start`/`comment-end` embeds round-tripped.
      expect(newComments[0].range.orphaned).toBe(false);
      expect(newComments[0].range).toEqual(origComments[0].range);
      expect(buildCommentRangeIndex(state2).get("cm-1" as CommentId)?.orphaned).toBe(false);
    });

    it("round-trips an empty document (rootId + root block preserved)", () => {
      const state = createEmptyDocument();
      const reg = createDefaultSerializerRegistry();
      const bytes = serializeDocument(state, BINARY_FORMAT, reg);
      const state2 = deserializeDocument(bytes, BINARY_FORMAT, reg);

      expect(state2.rootId).toBe(state.rootId);
      const root = getBlock(state2, state.rootId);
      expect(root).not.toBeNull();
      expect(root?.type).toBe("document");
    });
  });

  describe("registry", () => {
    it("createDefaultSerializerRegistry pre-registers the binary serializer", () => {
      const reg = createDefaultSerializerRegistry();
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
        decode: () => createEmptyDocument(),
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
      const state = createEmptyDocument();
      expect(() => serializeDocument(state, "no-such-format", reg)).toThrow(
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
      const reg = createDefaultSerializerRegistry();
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
      const s = createBinaryDocumentSerializer();
      expect(s.format).toBe(BINARY_FORMAT);
      expect(BINARY_FORMAT).toBe("taleweaver-binary");
    });
  });
});
