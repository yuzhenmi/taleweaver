import { describe, it, expect } from "vitest";
import type { BlockId } from "./block-id";
import { getBlock, getEmbedContent } from "./state";
import { buildStateFromBlocks } from "./build-state-from-blocks";
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

  it("returns a state with no embedContents when none are passed", () => {
    const state = buildStateFromBlocks({
      rootId: "doc" as BlockId,
      blocks: [block({ id: "doc", type: "document" })],
    });
    expect(getEmbedContent(state, "anything" as BlockId)).toBeNull();
  });
});
