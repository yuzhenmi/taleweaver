import { describe, it, expect } from "vitest";
import { deleteTableWithReplacement } from "./delete-table";
import { getBlock } from "../state";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import { createTestAllocator } from "../block-id";
import type { BlockId } from "../block-id";
import type { State } from "../state";
import type { Block } from "../block";

/** A minimal 1×1 table tree (table > row > cell > paragraph) under `parentId`. */
function tableBlocks(parentId: string, opts?: { prev?: string; next?: string }): Block[] {
  return [
    buildBlock({ id: "table", type: "table", parentId, prevSiblingId: opts?.prev ?? null, nextSiblingId: opts?.next ?? null, firstChildId: "row", lastChildId: "row" }),
    buildBlock({ id: "row", type: "table-row", parentId: "table", firstChildId: "cell", lastChildId: "cell" }),
    buildBlock({ id: "cell", type: "table-cell", parentId: "row", firstChildId: "cp", lastChildId: "cp" }),
    buildBlock({ id: "cp", type: "paragraph", parentId: "cell", inlineContent: inlineContent([]) }),
  ];
}

describe("deleteTableWithReplacement", () => {
  it("sole child → removes the table AND leaves a fresh empty paragraph (body never empty)", () => {
    const state: State = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
        ...tableBlocks("doc"),
      ],
    });
    const { state: next, newParagraphId, dirtyIds } = deleteTableWithReplacement(
      state, "table" as BlockId, createTestAllocator("n"),
    );
    expect(newParagraphId).not.toBeNull();
    if (newParagraphId === null) throw new Error("expected a replacement paragraph");
    // dirtyIds covers every mutated block: the removed subtree (table/row/cell/cp),
    // the freshly-inserted paragraph, and the parent whose first/lastChildId changed.
    for (const id of ["table", "row", "cell", "cp", "doc"]) {
      expect(dirtyIds.has(id as BlockId)).toBe(true);
    }
    expect(dirtyIds.has(newParagraphId)).toBe(true);
    // table subtree gone
    for (const id of ["table", "row", "cell", "cp"]) {
      expect(getBlock(next, id as BlockId)).toBeNull();
    }
    // replacement paragraph is the doc's sole child
    const doc = getBlock(next, "doc" as BlockId);
    expect(doc?.firstChildId).toBe(newParagraphId);
    expect(doc?.lastChildId).toBe(newParagraphId);
    const para = getBlock(next, newParagraphId);
    expect(para?.type).toBe("paragraph");
    expect(para?.parentId).toBe("doc");
    expect(para?.prevSiblingId).toBeNull();
    expect(para?.nextSiblingId).toBeNull();
    expect(para?.inlineContent).toEqual({ items: [] });
  });

  it("table with a following sibling → plain removal, no replacement", () => {
    const state: State = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "p" }),
        ...tableBlocks("doc", { next: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "table", inlineContent: inlineContent([]) }),
      ],
    });
    const { state: next, newParagraphId, dirtyIds } = deleteTableWithReplacement(
      state, "table" as BlockId, createTestAllocator("n"),
    );
    expect(newParagraphId).toBeNull();
    // dirtyIds covers the removed subtree, the rewired sibling, and the parent.
    expect(dirtyIds.has("table" as BlockId)).toBe(true);
    expect(dirtyIds.has("p" as BlockId)).toBe(true);
    expect(dirtyIds.has("doc" as BlockId)).toBe(true);
    expect(getBlock(next, "table" as BlockId)).toBeNull();
    const doc = getBlock(next, "doc" as BlockId);
    expect(doc?.firstChildId).toBe("p");
    expect(doc?.lastChildId).toBe("p");
    expect(getBlock(next, "p" as BlockId)?.prevSiblingId).toBeNull();
  });

  it("table with a preceding sibling → plain removal; sibling becomes last child", () => {
    const state: State = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "table" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "table", inlineContent: inlineContent([]) }),
        ...tableBlocks("doc", { prev: "p" }),
      ],
    });
    const { state: next, newParagraphId, dirtyIds } = deleteTableWithReplacement(
      state, "table" as BlockId, createTestAllocator("n"),
    );
    expect(newParagraphId).toBeNull();
    // dirtyIds covers the removed subtree, the rewired sibling, and the parent.
    expect(dirtyIds.has("table" as BlockId)).toBe(true);
    expect(dirtyIds.has("p" as BlockId)).toBe(true);
    expect(dirtyIds.has("doc" as BlockId)).toBe(true);
    const doc = getBlock(next, "doc" as BlockId);
    expect(doc?.firstChildId).toBe("p");
    expect(doc?.lastChildId).toBe("p");
    expect(getBlock(next, "p" as BlockId)?.nextSiblingId).toBeNull();
  });
});
