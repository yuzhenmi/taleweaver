import { describe, it, expect } from "vitest";
import { buildStateFromBlocks } from "./build-state-from-blocks";
import { assertChainIntegrity } from "./chain-integrity";
import type { BlockId } from "./block-id";
import type { Block } from "./block";

const id = (s: string): BlockId => s as BlockId;

function container(
  idStr: string,
  parentId: BlockId | null,
  prev: BlockId | null,
  next: BlockId | null,
  first: BlockId | null,
  last: BlockId | null,
): Block {
  return {
    id: id(idStr),
    type: "section",
    attrs: {},
    parentId,
    prevSiblingId: prev,
    nextSiblingId: next,
    firstChildId: first,
    lastChildId: last,
    inlineContent: null,
  };
}

function leaf(
  idStr: string,
  parentId: BlockId | null,
  prev: BlockId | null,
  next: BlockId | null,
): Block {
  return {
    id: id(idStr),
    type: "paragraph",
    attrs: {},
    parentId,
    prevSiblingId: prev,
    nextSiblingId: next,
    firstChildId: null,
    lastChildId: null,
    inlineContent: { items: [] },
  };
}

/** A well-formed root with two paragraph children p1, p2. */
function wellFormed(): ReadonlyArray<Block> {
  return [
    container("root", null, null, null, id("p1"), id("p2")),
    leaf("p1", id("root"), null, id("p2")),
    leaf("p2", id("root"), id("p1"), null),
  ];
}

describe("assertChainIntegrity", () => {
  it("passes on a well-formed tree (full scan and scoped)", () => {
    const state = buildStateFromBlocks({ rootId: id("root"), blocks: wellFormed() });
    expect(() => assertChainIntegrity(state, "test")).not.toThrow();
    expect(() =>
      assertChainIntegrity(state, "test", new Set([id("p1"), id("p2"), id("root")])),
    ).not.toThrow();
  });

  it("throws on a broken parent backlink", () => {
    const blocks = [
      container("root", null, null, null, id("p1"), id("p2")),
      leaf("p1", id("wrong"), null, id("p2")), // parentId should be root
      leaf("p2", id("root"), id("p1"), null),
    ];
    const state = buildStateFromBlocks({ rootId: id("root"), blocks });
    expect(() => assertChainIntegrity(state, "test")).toThrow(/parent/i);
  });

  it("throws on broken sibling reciprocity", () => {
    const blocks = [
      container("root", null, null, null, id("p1"), id("p2")),
      leaf("p1", id("root"), null, id("p2")),
      leaf("p2", id("root"), null, null), // prevSibling should be p1
    ];
    const state = buildStateFromBlocks({ rootId: id("root"), blocks });
    expect(() => assertChainIntegrity(state, "test")).toThrow(/sibling/i);
  });

  it("throws when lastChildId disagrees with the chain end", () => {
    const blocks = [
      container("root", null, null, null, id("p1"), id("p1")), // lastChild should be p2
      leaf("p1", id("root"), null, id("p2")),
      leaf("p2", id("root"), id("p1"), null),
    ];
    const state = buildStateFromBlocks({ rootId: id("root"), blocks });
    expect(() => assertChainIntegrity(state, "test")).toThrow(/lastChild/i);
  });

  it("throws on firstChild/lastChild presence asymmetry", () => {
    const blocks = [
      container("root", null, null, null, id("p1"), null), // first set, last null
      leaf("p1", id("root"), null, null),
    ];
    const state = buildStateFromBlocks({ rootId: id("root"), blocks });
    expect(() => assertChainIntegrity(state, "test")).toThrow(/firstChild|lastChild/i);
  });

  it("throws when a child link references a missing block", () => {
    const blocks = [
      container("root", null, null, null, id("ghost"), id("ghost")),
    ];
    const state = buildStateFromBlocks({ rootId: id("root"), blocks });
    expect(() => assertChainIntegrity(state, "test")).toThrow(/missing|ghost/i);
  });

  it("throws when a parent claims a different first child", () => {
    // p1 says it is the first child (prevSibling null, parent root) but
    // root.firstChildId points at p2.
    const blocks = [
      container("root", null, null, null, id("p2"), id("p2")),
      leaf("p1", id("root"), null, id("p2")),
      leaf("p2", id("root"), id("p1"), null),
    ];
    const state = buildStateFromBlocks({ rootId: id("root"), blocks });
    expect(() => assertChainIntegrity(state, "test")).toThrow();
  });

  describe("scoped (dirtyIds) inductive behavior", () => {
    // Only p1's parent backlink is broken; p2 is internally consistent.
    function onlyP1Broken() {
      return buildStateFromBlocks({
        rootId: id("root"),
        blocks: [
          container("root", null, null, null, id("p1"), id("p2")),
          leaf("p1", id("wrong"), null, id("p2")),
          leaf("p2", id("root"), id("p1"), null),
        ],
      });
    }

    it("catches the broken block when it is in dirtyIds", () => {
      const state = onlyP1Broken();
      expect(() =>
        assertChainIntegrity(state, "test", new Set([id("p1")])),
      ).toThrow(/parent/i);
    });

    it("skips the broken block when it is not in dirtyIds (no deletion)", () => {
      const state = onlyP1Broken();
      // p2 is consistent in isolation; scoped scan over [p2] must not touch p1.
      expect(() =>
        assertChainIntegrity(state, "test", new Set([id("p2")])),
      ).not.toThrow();
    });

    it("falls back to a full scan when a dirty id no longer resolves (deletion)", () => {
      const state = onlyP1Broken();
      expect(() =>
        assertChainIntegrity(state, "test", new Set([id("deleted-ghost")])),
      ).toThrow(/parent/i);
    });
  });
});
