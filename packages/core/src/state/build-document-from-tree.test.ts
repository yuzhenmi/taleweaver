import { registryWith, testContainer, TEST_RESOLVER } from "../test-utils/state-builders";
import { describe, it, expect } from "vitest";
import { createTestAllocator, type BlockId } from "./block-id";
import { getBlock } from "./state";
import type { Document } from "./state";
import type { Block } from "./block";
import { getListDefsForState, type ListDef } from "./list-defs";
import {
  buildDocumentFromTree,
  type ContainerBlockNode,
} from "./build-document-from-tree";

/** Read a block that must exist (narrows `Block | null` to `Block` without `!`). */
function requireBlock(state: Document, id: BlockId): Block {
  const block = getBlock(state, id);
  if (block === null) {
    throw new Error(`expected block ${id} to exist`);
  }
  return block;
}

/** Read a child-link id that must be set (narrows `BlockId | null` without `!`). */
/** The final section: the root's child, holding a section-less document's top-level blocks. */
function topOf(state: Document): Block {
  return requireBlock(state, requireId(requireBlock(state, state.rootId).lastChildId));
}

function requireId(id: BlockId | null): BlockId {
  if (id === null) {
    throw new Error("expected a non-null block id");
  }
  return id;
}

describe("buildDocumentFromTree", () => {
  it("lowers a document with a single paragraph leaf, deriving links", () => {
    const root: ContainerBlockNode = {
      type: "document",
      children: [
        {
          type: "paragraph",
          inlineContent: {
            items: [{ kind: "text", text: "hello", attrs: {} }],
          },
        },
      ],
    };
    const state = buildDocumentFromTree(root, {}, createTestAllocator(), TEST_RESOLVER);

    const rootBlock = requireBlock(state, state.rootId);
    expect(rootBlock.type).toBe("document");
    expect(rootBlock.parentId).toBeNull();
    expect(rootBlock.prevSiblingId).toBeNull();
    expect(rootBlock.nextSiblingId).toBeNull();
    expect(rootBlock.inlineContent).toBeNull();
    // The root's only child is its final section, which holds the paragraph.
    expect(rootBlock.firstChildId).toBe(rootBlock.lastChildId);
    const doc = topOf(state);
    expect(doc.type).toBe("section");
    expect(doc.parentId).toBe(state.rootId);
    expect(doc.firstChildId).not.toBeNull();
    expect(doc.firstChildId).toBe(doc.lastChildId);

    const para = requireBlock(state, requireId(doc.firstChildId));
    expect(para.type).toBe("paragraph");
    expect(para.parentId).toBe(doc.id);
    expect(para.prevSiblingId).toBeNull();
    expect(para.nextSiblingId).toBeNull();
    expect(para.firstChildId).toBeNull();
    expect(para.lastChildId).toBeNull();
    expect(para.inlineContent).toEqual({
      items: [{ kind: "text", text: "hello", attrs: {} }],
    });
  });

  it("derives sibling links across multiple children", () => {
    const root: ContainerBlockNode = {
      type: "document",
      children: [
        { type: "paragraph", inlineContent: { items: [] } },
        { type: "paragraph", inlineContent: { items: [] } },
        { type: "paragraph", inlineContent: { items: [] } },
      ],
    };
    const state = buildDocumentFromTree(root, {}, createTestAllocator(), TEST_RESOLVER);

    const doc = topOf(state);
    const p1Id = requireId(doc.firstChildId);
    const p1 = requireBlock(state, p1Id);
    const p2Id = requireId(p1.nextSiblingId);
    const p2 = requireBlock(state, p2Id);
    const p3Id = requireId(p2.nextSiblingId);
    const p3 = requireBlock(state, p3Id);

    expect(p1.prevSiblingId).toBeNull();
    expect(p1.nextSiblingId).toBe(p2Id);
    expect(p2.prevSiblingId).toBe(p1Id);
    expect(p2.nextSiblingId).toBe(p3Id);
    expect(p3.prevSiblingId).toBe(p2Id);
    expect(p3.nextSiblingId).toBeNull();

    expect(doc.firstChildId).toBe(p1Id);
    expect(doc.lastChildId).toBe(p3Id);
  });

  it("derives links through a nested container (2 levels)", () => {
    const root: ContainerBlockNode = {
      type: "document",
      children: [
        {
          type: "section",
          children: [{ type: "paragraph", inlineContent: { items: [] } }],
        },
      ],
    };
    const state = buildDocumentFromTree(root, {}, createTestAllocator(), TEST_RESOLVER);

    const doc = requireBlock(state, state.rootId);
    const sectionId = requireId(doc.firstChildId);
    const section = requireBlock(state, sectionId);
    expect(section.type).toBe("section");
    expect(section.parentId).toBe(state.rootId);
    expect(section.inlineContent).toBeNull();

    const paraId = requireId(section.firstChildId);
    const para = requireBlock(state, paraId);
    expect(para.type).toBe("paragraph");
    expect(para.parentId).toBe(sectionId);
    expect(section.firstChildId).toBe(paraId);
    expect(section.lastChildId).toBe(paraId);
    // The section is the document's sole child: both ends point to it, and it
    // terminates the sibling chain on both sides.
    expect(doc.firstChildId).toBe(sectionId);
    expect(doc.lastChildId).toBe(sectionId);
    expect(section.prevSiblingId).toBeNull();
    expect(section.nextSiblingId).toBeNull();
  });

  it("an empty container holds ONE empty paragraph (firstChild === lastChild)", () => {
    const root: ContainerBlockNode = {
      type: "document",
      // (An empty SECTION is not in the read model; a childless
      // generic container is.)
      children: [{ type: "blockquote", children: [] }],
    };
    const state = buildDocumentFromTree(root, {}, createTestAllocator(), registryWith(testContainer("blockquote")));

    const doc = topOf(state);
    const section = requireBlock(state, requireId(doc.firstChildId));
    // Rev 11: the creator writes the childless flow's one ¶ (a real, empty paragraph).
    const implicit = requireBlock(state, requireId(section.firstChildId));
    expect(section.lastChildId).toBe(section.firstChildId);
    expect(implicit.type).toBe("paragraph");
    expect(implicit.parentId).toBe(section.id);
    expect(implicit.inlineContent?.items).toEqual([]);
  });

  it("mints distinct ids from the allocator in deterministic order", () => {
    const root: ContainerBlockNode = {
      type: "document",
      children: [
        { type: "paragraph", inlineContent: { items: [] } },
        { type: "paragraph", inlineContent: { items: [] } },
      ],
    };
    const state = buildDocumentFromTree(root, {}, createTestAllocator("blk"), TEST_RESOLVER);

    const doc = topOf(state);
    const firstChildId = requireId(doc.firstChildId);
    const lastChildId = requireId(doc.lastChildId);
    const allIds = [state.rootId, firstChildId, lastChildId];
    expect(new Set(allIds).size).toBe(allIds.length);
    // Root id is minted first; child ids are pre-minted before recursion.
    expect(state.rootId).toBe("blk-0");
    expect(firstChildId).toBe("blk-1");
    expect(lastChildId).toBe("blk-2");
  });

  it("preserves a node's attrs, defaulting to {} when absent", () => {
    const root: ContainerBlockNode = {
      type: "document",
      children: [
        {
          type: "heading",
          attrs: { level: 2 },
          inlineContent: { items: [] },
        },
        { type: "paragraph", inlineContent: { items: [] } },
      ],
    };
    const state = buildDocumentFromTree(root, {}, createTestAllocator(), TEST_RESOLVER);

    const doc = topOf(state);
    const heading = requireBlock(state, requireId(doc.firstChildId));
    expect(heading.attrs).toEqual({ level: 2 });
    const para = requireBlock(state, requireId(doc.lastChildId));
    expect(para.attrs).toEqual({});
  });

  it("seeds listDefs and links a list-item leaf to its listId", () => {
    const def: ListDef = {
      levels: [{ style: "decimal", start: 1, restart: "always" }],
    };
    const root: ContainerBlockNode = {
      type: "document",
      children: [
        {
          type: "list-item",
          attrs: { listId: "list-1", listLevel: 0 },
          inlineContent: { items: [{ kind: "text", text: "one", attrs: {} }] },
        },
      ],
    };
    const state = buildDocumentFromTree(
      root,
      { "list-1": def },
      createTestAllocator(), TEST_RESOLVER
    );

    expect(getListDefsForState(state).get("list-1")).toEqual(def);

    const doc = topOf(state);
    const item = requireBlock(state, requireId(doc.firstChildId));
    expect(item.type).toBe("list-item");
    expect(item.attrs).toEqual({ listId: "list-1", listLevel: 0 });
  });

  it("preserves inlineContent items + attrs on leaves", () => {
    const items = [
      { kind: "text" as const, text: "bold ", attrs: { bold: true } },
      { kind: "text" as const, text: "plain", attrs: {} },
    ];
    const root: ContainerBlockNode = {
      type: "document",
      children: [{ type: "paragraph", inlineContent: { items } }],
    };
    const state = buildDocumentFromTree(root, {}, createTestAllocator(), TEST_RESOLVER);

    const doc = topOf(state);
    const para = requireBlock(state, requireId(doc.firstChildId));
    expect(para.inlineContent).toEqual({ items });
  });
});
