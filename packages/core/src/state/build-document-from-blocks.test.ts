import { TEST_RESOLVER } from "../test-utils/document-builders";
import { describe, it, expect } from "vitest";
import type { BlockId } from "./block-id";
import { getBlock, getEmbedContent, getTemplateContent } from "./document";
import { buildDocumentFromBlocks } from "./build-document-from-blocks";
import { DOCUMENT_INTERNAL } from "./document-internal";
import { getRegistry } from "./registry";
import type { Block } from "./block";
import { getListDef, type ListDef } from "./list-defs";
import { getComments, type CommentId, type CommentRecord } from "./comments";
import { readSuggestionRecord, type SuggestionId, type SuggestionRecord } from "./suggestions";

function block(args: {
  id: string;
  type: string;
  parentId?: string | null;
  prevSiblingId?: string | null;
  nextSiblingId?: string | null;
  firstChildId?: string | null;
  lastChildId?: string | null;
}): Block {
  return Object.freeze({
    id: args.id as BlockId,
    type: args.type,
    attrs: Object.freeze({}),
    parentId: (args.parentId ?? null) as BlockId | null,
    prevSiblingId: (args.prevSiblingId ?? null) as BlockId | null,
    nextSiblingId: (args.nextSiblingId ?? null) as BlockId | null,
    firstChildId: (args.firstChildId ?? null) as BlockId | null,
    lastChildId: (args.lastChildId ?? null) as BlockId | null,
    inlineContent: args.type === "document" ? null : Object.freeze({ items: Object.freeze([]) }),
  }) as Block;
}

describe("buildDocumentFromBlocks", () => {
  it("materializes main-tree blocks into the Y.Doc blocks map", () => {
    const document = buildDocumentFromBlocks({ resolver: TEST_RESOLVER,
      rootId: "doc" as BlockId,
      blocks: [
        block({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        block({ id: "p", type: "paragraph", parentId: "doc" }),
      ],
    });
    expect(document.rootId).toBe("doc");
    const doc = getBlock(document, "doc" as BlockId);
    const p = getBlock(document, "p" as BlockId);
    expect(doc?.type).toBe("document");
    expect(p?.type).toBe("paragraph");
    // The root's child is its final section, the parent of the top-level blocks.
    expect(p?.parentId).toBe(doc?.firstChildId);
    expect(getBlock(document, doc?.lastChildId ?? ("" as BlockId))?.type).toBe("section");
  });

  it("materializes embed-content blocks into the embedContents map", () => {
    const document = buildDocumentFromBlocks({ resolver: TEST_RESOLVER,
      rootId: "doc" as BlockId,
      blocks: [block({ id: "doc", type: "document" })],
      embedContents: [block({ id: "fn-1", type: "paragraph" })],
    });
    const fn = getEmbedContent(document, "fn-1" as BlockId);
    expect(fn?.type).toBe("paragraph");
    // It must NOT have leaked into the main blocks map.
    expect(getBlock(document, "fn-1" as BlockId)).toBeNull();
  });

  it("materializes template-content blocks into the templateContents map", () => {
    const document = buildDocumentFromBlocks({ resolver: TEST_RESOLVER,
      rootId: "doc" as BlockId,
      blocks: [block({ id: "doc", type: "document" })],
      templateContents: [block({ id: "tmpl-1", type: "paragraph" })],
    });
    expect(getTemplateContent(document, "tmpl-1" as BlockId)?.type).toBe("paragraph");
    expect(getRegistry(document[DOCUMENT_INTERNAL].doc).get("tmpl-1")?.get("tree")).toBe("templateContent");
    // It must NOT have leaked into the main blocks map or the embedContents map.
    expect(getBlock(document, "tmpl-1" as BlockId)).toBeNull();
    expect(getEmbedContent(document, "tmpl-1" as BlockId)).toBeNull();
  });

  it("returns a state with no embedContents when none are passed", () => {
    const document = buildDocumentFromBlocks({ resolver: TEST_RESOLVER,
      rootId: "doc" as BlockId,
      blocks: [block({ id: "doc", type: "document" })],
    });
    expect(getEmbedContent(document, "anything" as BlockId)).toBeNull();
  });

  it("returns a state with no templateContents when none are passed", () => {
    const document = buildDocumentFromBlocks({ resolver: TEST_RESOLVER,
      rootId: "doc" as BlockId,
      blocks: [block({ id: "doc", type: "document" })],
    });
    expect([...getRegistry(document[DOCUMENT_INTERNAL].doc).values()].filter((e) => e.get("tree") === "templateContent")).toHaveLength(0);
  });

  it("materializes listDefs, comments, and suggestions alongside all three block trees (whole-doc, id-preserving)", () => {
    const listDef: ListDef = {
      levels: [{ style: "decimal", start: 1, restart: "never" }],
    };
    const comment: CommentRecord = {
      id: "comment-1" as CommentId,
      author: "alice",
      body: "needs a citation",
      createdAt: 1000,
      replies: [{ id: "r1", author: "bob", body: "agreed", createdAt: 2000 }],
      resolved: false,
    };
    const suggestion: SuggestionRecord = {
      id: "sugg-1" as SuggestionId,
      kind: "insertion",
      author: "carol",
      createdAt: 3000,
    };

    const document = buildDocumentFromBlocks({ resolver: TEST_RESOLVER,
      rootId: "doc" as BlockId,
      blocks: [
        block({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        block({ id: "p", type: "paragraph", parentId: "doc" }),
      ],
      // An embedContent body: a container root with one child.
      embedContents: [
        block({ id: "fn-root", type: "container", firstChildId: "fn-p", lastChildId: "fn-p" }),
        block({ id: "fn-p", type: "paragraph", parentId: "fn-root" }),
      ],
      // A templateContent body: a container root with one child.
      templateContents: [
        block({ id: "tmpl-root", type: "container", firstChildId: "tmpl-p", lastChildId: "tmpl-p" }),
        block({ id: "tmpl-p", type: "paragraph", parentId: "tmpl-root" }),
      ],
      listDefs: { "list-1": listDef },
      comments: [comment],
      suggestions: [suggestion],
    });

    // Main tree present.
    expect(getBlock(document, "p" as BlockId)?.type).toBe("paragraph");

    // embedContent body survives — both root and child.
    expect(getEmbedContent(document, "fn-root" as BlockId)?.type).toBe("container");
    expect(getEmbedContent(document, "fn-p" as BlockId)?.parentId).toBe("fn-root");

    // templateContent body survives — both root and child.
    expect(getTemplateContent(document, "tmpl-root" as BlockId)?.type).toBe("container");
    expect(getTemplateContent(document, "tmpl-p" as BlockId)?.parentId).toBe("tmpl-root");

    // listDef present + id-identical.
    expect(getListDef(document[DOCUMENT_INTERNAL].doc, "list-1")).toEqual(listDef);

    // Comment present + id-identical (incl. its reply).
    const comments = getComments(document);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.id).toBe("comment-1");
    expect(comments[0]?.author).toBe("alice");
    expect(comments[0]?.body).toBe("needs a citation");
    expect(comments[0]?.resolved).toBe(false);
    expect(comments[0]?.replies).toEqual([
      { id: "r1", author: "bob", body: "agreed", createdAt: 2000 },
    ]);

    // Suggestion present + id-identical.
    // (It tags no content, so `getSuggestions` does not surface it: read the record.)
    const sugg = readSuggestionRecord(document[DOCUMENT_INTERNAL].doc, "sugg-1" as SuggestionId);
    expect(sugg?.id).toBe("sugg-1");
    expect(sugg?.kind).toBe("insertion");
    expect(sugg?.author).toBe("carol");
    expect(sugg?.createdAt).toBe(3000);
  });
});
