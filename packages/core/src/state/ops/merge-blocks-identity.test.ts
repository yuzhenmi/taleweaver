/**
 * Character-survival contract for `mergeAdjacentBlocks`: blocks are ranges of one
 * CRDT sequence delimited by marks, so a merge deletes the right block's mark
 * and EVERY character — left and right — keeps its identity.
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

describe("mergeAdjacentBlocks — character survival", () => {
  it("every character survives, LEFT and RIGHT (a merge deletes the mark only — nothing is re-minted)", () => {
    const s = twoBlocks([text("AX", { bold: true })], [text("YB", { bold: true })]);
    const relA = relAt(s, "p1", 0);
    const relX = relAt(s, "p1", 1);
    const relY = relAt(s, "p2", 0);
    const after = mergeAdjacentBlocks(s, "p1" as BlockId, "p2" as BlockId).state;
    expect(survives(relA, after, "A")).toBe(true);
    expect(survives(relX, after, "X")).toBe(true);
    expect(survives(relY, after, "Y")).toBe(true);
  });
});
