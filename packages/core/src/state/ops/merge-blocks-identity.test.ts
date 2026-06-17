/**
 * Identity-survival contract for `mergeAdjacentBlocks`' SEAM-MERGE (surgical-inline-ops
 * Phase 1, slice 5). When two blocks merge and their seam runs are same-attrs, the LEFT
 * block's trailing run (the merge RECEIVER, already live in the left block's Y.Array)
 * keeps its `Y.Text` identity after slice 5 swaps the post-pass to the in-place twin
 * (`mergeAdjacentSameAttrsTextItemsInPlace`).
 *
 * RED before the swap (the rebuild post-pass replaces both seam runs with a fresh
 * `Y.Text`, orphaning the receiver too); GREEN after. NOTE: the donor (the right block's
 * content) is CLONED into the left (Class-3 structural — fresh regardless), so the
 * left-side RECEIVER survival is the only discriminating assertion; a donor-orphan check
 * would pass with or without the swap (the right block is deleted entirely) and is omitted.
 */
import { describe, it, expect } from "vitest";
import { mergeAdjacentBlocks } from "./merge-blocks";
import type { BlockId } from "../block-id";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";
import { relAt, survives } from "../../test-utils/relpos-survival";

/** doc > [ p1(left runs), p2(right runs) ] — two sibling leaf paragraphs. */
function twoBlocks(left: ReturnType<typeof text>[], right: ReturnType<typeof text>[]) {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
      buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent(left) }),
      buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent(right) }),
    ],
  });
}

describe("mergeAdjacentBlocks seam-merge — RelativePosition identity survival", () => {
  it("the LEFT block's trailing run (merge receiver) keeps identity when the seam runs converge", () => {
    // p1=["AX"{bold}], p2=["YB"{bold}]; merge p1+p2. The clone of "YB" is appended onto
    // p1's live array, then "AX"{bold} + "YB"{bold} are same-attrs and merge → "AXYB"{bold}.
    // With the in-place seam normalizer, "AX" (receiver) keeps its Y.Text; a
    // RelativePosition at 'A' in p1's trailing run survives the merge.
    const s = twoBlocks([text("AX", { bold: true })], [text("YB", { bold: true })]);
    const rel = relAt(s, "p1", 0); // 'A' in p1's trailing run (the receiver)
    const after = mergeAdjacentBlocks(s, "p1" as BlockId, "p2" as BlockId).state;
    expect(survives(rel, after, "A")).toBe(true);
  });
});
