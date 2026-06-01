// packages/core/src/state/assert-same-tree.test.ts
//
// C.2c T7c: `assertSameTree` is a dev-only single-tree invariant guard for the
// structural ops (split / merge / delete-range). After an op resolves its
// reference block's owning tree (`kind`), it gathers the sibling / parent ids
// it is about to read + rewire and asserts each resolves to the SAME `kind` —
// throwing a descriptive error if the op is about to write across trees (e.g. a
// main-tree sibling pointer leaking into a header body, which would corrupt
// state). Production builds (`NODE_ENV === "production"`) are a no-op.

import { describe, it, expect } from "vitest";
import { assertSameTree } from "./assert-same-tree";
import { buildBlock, buildState, inlineContent, text } from "../test-utils/state-builders";
import type { BlockId } from "./block-id";
import type { State } from "./state";

// Two trees: a main doc (doc > p) and a header body (hdr-root > hdr-c1, hdr-c2).
function buildMixed(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text("body")]),
      }),
    ],
    templateContents: [
      buildBlock({
        id: "hdr-root",
        type: "header",
        parentId: null,
        firstChildId: "hdr-c1",
        lastChildId: "hdr-c2",
      }),
      buildBlock({
        id: "hdr-c1",
        type: "paragraph",
        parentId: "hdr-root",
        nextSiblingId: "hdr-c2",
        inlineContent: inlineContent([text("alpha")]),
      }),
      buildBlock({
        id: "hdr-c2",
        type: "paragraph",
        parentId: "hdr-root",
        prevSiblingId: "hdr-c1",
        inlineContent: inlineContent([text("beta")]),
      }),
    ],
  });
}

describe("assertSameTree (dev-only single-tree invariant)", () => {
  it("does not throw when every neighbor id resolves to the expected kind", () => {
    const state = buildMixed();
    // All header ids are templateContent.
    expect(() =>
      assertSameTree(
        state,
        "templateContent",
        ["hdr-root" as BlockId, "hdr-c2" as BlockId],
        "splitBlockAtPosition",
      ),
    ).not.toThrow();
  });

  it("does not throw on a pure main-tree neighbor set", () => {
    const state = buildMixed();
    expect(() =>
      assertSameTree(state, "block", ["doc" as BlockId, "p" as BlockId], "mergeAdjacentBlocks"),
    ).not.toThrow();
  });

  it("throws when a neighbor id belongs to a DIFFERENT tree (cross-tree write)", () => {
    const state = buildMixed();
    // Expect templateContent but include a main-tree id ("p").
    expect(() =>
      assertSameTree(
        state,
        "templateContent",
        ["hdr-c2" as BlockId, "p" as BlockId],
        "splitBlockAtPosition",
      ),
    ).toThrow(/splitBlockAtPosition/);
  });

  it("throws when a neighbor id resolves to no tree at all", () => {
    const state = buildMixed();
    expect(() =>
      assertSameTree(
        state,
        "templateContent",
        ["hdr-c1" as BlockId, "ghost" as BlockId],
        "mergeAdjacentBlocks",
      ),
    ).toThrow(/mergeAdjacentBlocks/);
  });

  it("ignores null neighbor ids (no sibling / no parent is valid)", () => {
    const state = buildMixed();
    expect(() =>
      assertSameTree(
        state,
        "templateContent",
        [null, "hdr-c2" as BlockId, null],
        "deleteRange",
      ),
    ).not.toThrow();
  });
});
