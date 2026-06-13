/**
 * Change-tracking multi-tree resolution MT-1 — `iterateAllBlocksInDocumentOrder`
 * walks ALL THREE block trees (main `blocks`, then each `embedContents` body
 * subtree, then each `templateContents` body subtree) in a stable order, where
 * the single-tree `iterateBlocksInDocumentOrder` yields ONLY the main tree.
 * This is the foundation that lets the suggestion range index + accept/reject
 * resolve scan find suggestions tagged in footnote / header / footer bodies.
 */
import { describe, it, expect } from "vitest";
import {
  iterateBlocksInDocumentOrder,
  iterateAllBlocksInDocumentOrder,
} from "./document-order";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "../test-utils/state-builders";
import type { State } from "./state";
import type { Block } from "./block";

/** doc>(p) main tree + one embedContent body (fn>fnp) + one templateContent body (hd>hdp). */
function threeTreeState(): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("main")]) }),
    ],
    embedContents: [
      buildBlock({ id: "fn", type: "body-container", firstChildId: "fnp", lastChildId: "fnp" }),
      buildBlock({ id: "fnp", type: "paragraph", parentId: "fn", inlineContent: inlineContent([text("note")]) }),
    ],
    templateContents: [
      buildBlock({ id: "hd", type: "body-container", firstChildId: "hdp", lastChildId: "hdp" }),
      buildBlock({ id: "hdp", type: "paragraph", parentId: "hd", inlineContent: inlineContent([text("hdr")]) }),
    ],
  });
}

const ids = (it: Iterable<Block>): string[] => [...it].map((b) => b.id);

describe("iterateAllBlocksInDocumentOrder", () => {
  it("yields the main tree, then embed bodies, then template bodies (in document order)", () => {
    const state = threeTreeState();
    expect(ids(iterateAllBlocksInDocumentOrder(state))).toEqual([
      "doc", "p", // main tree
      "fn", "fnp", // embedContents body subtree
      "hd", "hdp", // templateContents body subtree
    ]);
  });

  it("the single-tree iterator stays MAIN-TREE-ONLY (the body trees are NOT yielded)", () => {
    const state = threeTreeState();
    expect(ids(iterateBlocksInDocumentOrder(state))).toEqual(["doc", "p"]);
  });

  it("equals the single-tree walk when there are no embed/template bodies", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("only")]) }),
      ],
    });
    expect(ids(iterateAllBlocksInDocumentOrder(state))).toEqual(ids(iterateBlocksInDocumentOrder(state)));
  });

  it("enumerates MULTIPLE embed roots, each with a fresh active-path guard", () => {
    // Two independent footnote bodies — both roots + their children must be
    // yielded sequentially after the main tree. A shared `visited` set across
    // roots would wrongly fire the cycle guard; fresh-per-root is the contract.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("m")]) }),
      ],
      embedContents: [
        buildBlock({ id: "fn1", type: "body-container", firstChildId: "fn1p", lastChildId: "fn1p" }),
        buildBlock({ id: "fn1p", type: "paragraph", parentId: "fn1", inlineContent: inlineContent([text("1")]) }),
        buildBlock({ id: "fn2", type: "body-container", firstChildId: "fn2p", lastChildId: "fn2p" }),
        buildBlock({ id: "fn2p", type: "paragraph", parentId: "fn2", inlineContent: inlineContent([text("2")]) }),
      ],
    });
    const got = ids(iterateAllBlocksInDocumentOrder(state));
    // Main tree first, then both embed bodies (root + child each). Embed-root
    // enumeration order is the Y.Map's, so assert membership + the per-body
    // root→child adjacency rather than a fixed fn1-before-fn2 order.
    expect(got.slice(0, 2)).toEqual(["doc", "p"]);
    expect(new Set(got)).toEqual(new Set(["doc", "p", "fn1", "fn1p", "fn2", "fn2p"]));
    expect(got).toHaveLength(6);
    expect(got.indexOf("fn1p")).toBe(got.indexOf("fn1") + 1);
    expect(got.indexOf("fn2p")).toBe(got.indexOf("fn2") + 1);
  });

  it("descends into nested body children (depth-first within each body subtree)", () => {
    // An embed body whose root has TWO paragraph children — both must be yielded
    // after the root, in sibling order, inside the embed segment.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("m")]) }),
      ],
      embedContents: [
        buildBlock({ id: "fn", type: "body-container", firstChildId: "a", lastChildId: "b" }),
        buildBlock({ id: "a", type: "paragraph", parentId: "fn", nextSiblingId: "b", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "b", type: "paragraph", parentId: "fn", prevSiblingId: "a", inlineContent: inlineContent([text("b")]) }),
      ],
    });
    expect(ids(iterateAllBlocksInDocumentOrder(state))).toEqual(["doc", "p", "fn", "a", "b"]);
  });
});
