import { describe, it, expect } from "vitest";
import type { BlockId } from "./block-id";
import { getBlock, getEmbedContent } from "./state";
import { buildStateFromBlocks } from "./build-state-from-blocks";
import { STATE_INTERNAL } from "./state-internal";
import { getTemplateContentsMap } from "./yjs-doc";
import type { Block } from "./block";

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
});
