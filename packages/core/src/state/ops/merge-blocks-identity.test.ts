/**
 * Character-survival contract for `mergeAdjacentBlocks`: right's content is
 * appended to left's `Y.Text` with one offset insert, so every character of the
 * LEFT block keeps its identity. The right block's characters are re-minted (Yjs
 * cannot reparent items) — the documented structural-op limit, asserted honestly.
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
  it("every LEFT character survives; the moved RIGHT characters are re-minted (structural limit)", () => {
    const s = twoBlocks([text("AX", { bold: true })], [text("YB", { bold: true })]);
    const relA = relAt(s, "p1", 0);
    const relX = relAt(s, "p1", 1);
    const relY = relAt(s, "p2", 0);
    const after = mergeAdjacentBlocks(s, "p1" as BlockId, "p2" as BlockId).state;
    expect(survives(relA, after, "A")).toBe(true);
    expect(survives(relX, after, "X")).toBe(true);
    expect(survives(relY, after, "Y")).toBe(false);
  });
});
