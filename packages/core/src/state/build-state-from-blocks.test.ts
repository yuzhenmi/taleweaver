import { describe, it, expect } from "vitest";
import type { BlockId } from "./block-id";
import { getBlock, getEmbedContent, getTemplateContent } from "./state";
import { buildStateFromBlocks } from "./build-state-from-blocks";
import { STATE_INTERNAL } from "./state-internal";
import { getTemplateContentsMap } from "./yjs-doc";
import type { Block } from "./block";
import { getListDef, type ListDef } from "./list-defs";
import { getComments, type CommentId, type CommentRecord } from "./comments";
import { getSuggestions, type SuggestionId, type SuggestionRecord } from "./suggestions";

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

describe("buildStateFromBlocks", () => {
  it("materializes main-tree blocks into the Y.Doc blocks map", () => {
    const state = buildStateFromBlocks({
      rootId: "doc" as BlockId,
      blocks: [
        block({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        block({ id: "p", type: "paragraph", parentId: "doc" }),
      ],
    });
    expect(state.rootId).toBe("doc");
    const doc = getBlock(state, "doc" as BlockId);
    const p = getBlock(state, "p" as BlockId);
    expect(doc?.type).toBe("document");
    expect(p?.type).toBe("paragraph");
    expect(p?.parentId).toBe("doc");
  });

  it("materializes embed-content blocks into the embedContents map", () => {
    const state = buildStateFromBlocks({
      rootId: "doc" as BlockId,
      blocks: [block({ id: "doc", type: "document" })],
      embedContents: [block({ id: "fn-1", type: "paragraph" })],
    });
    const fn = getEmbedContent(state, "fn-1" as BlockId);
    expect(fn?.type).toBe("paragraph");
    // It must NOT have leaked into the main blocks map.
    expect(getBlock(state, "fn-1" as BlockId)).toBeNull();
  });

  it("materializes template-content blocks into the templateContents map", () => {
    const state = buildStateFromBlocks({
      rootId: "doc" as BlockId,
      blocks: [block({ id: "doc", type: "document" })],
      templateContents: [block({ id: "tmpl-1", type: "paragraph" })],
    });
    // No getTemplateContent accessor exists yet (lands in T4); read the body
    // back through the raw template map.
    const doc = state[STATE_INTERNAL].doc;
    const yBody = getTemplateContentsMap(doc).get("tmpl-1" as BlockId);
    expect(yBody?.get("type")).toBe("paragraph");
    // It must NOT have leaked into the main blocks map or the embedContents map.
    expect(getBlock(state, "tmpl-1" as BlockId)).toBeNull();
    expect(getEmbedContent(state, "tmpl-1" as BlockId)).toBeNull();
  });

  it("returns a state with no embedContents when none are passed", () => {
    const state = buildStateFromBlocks({
      rootId: "doc" as BlockId,
      blocks: [block({ id: "doc", type: "document" })],
    });
    expect(getEmbedContent(state, "anything" as BlockId)).toBeNull();
  });

  it("returns a state with no templateContents when none are passed", () => {
    const state = buildStateFromBlocks({
      rootId: "doc" as BlockId,
      blocks: [block({ id: "doc", type: "document" })],
    });
    expect(getTemplateContentsMap(state[STATE_INTERNAL].doc).size).toBe(0);
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

    const state = buildStateFromBlocks({
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
    expect(getBlock(state, "p" as BlockId)?.type).toBe("paragraph");

    // embedContent body survives — both root and child.
    expect(getEmbedContent(state, "fn-root" as BlockId)?.type).toBe("container");
    expect(getEmbedContent(state, "fn-p" as BlockId)?.parentId).toBe("fn-root");

    // templateContent body survives — both root and child.
    expect(getTemplateContent(state, "tmpl-root" as BlockId)?.type).toBe("container");
    expect(getTemplateContent(state, "tmpl-p" as BlockId)?.parentId).toBe("tmpl-root");

    // listDef present + id-identical.
    expect(getListDef(state[STATE_INTERNAL].doc, "list-1")).toEqual(listDef);

    // Comment present + id-identical (incl. its reply).
    const comments = getComments(state);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.id).toBe("comment-1");
    expect(comments[0]?.author).toBe("alice");
    expect(comments[0]?.body).toBe("needs a citation");
    expect(comments[0]?.resolved).toBe(false);
    expect(comments[0]?.replies).toEqual([
      { id: "r1", author: "bob", body: "agreed", createdAt: 2000 },
    ]);

    // Suggestion present + id-identical.
    const suggestions = getSuggestions(state);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.id).toBe("sugg-1");
    expect(suggestions[0]?.kind).toBe("insertion");
    expect(suggestions[0]?.author).toBe("carol");
    expect(suggestions[0]?.createdAt).toBe(3000);
  });
});
