import { describe, it, expect } from "vitest";
import { resolveCellRange } from "./table-cell-range";
import { createPosition, createSpan } from "./block-position";
import { buildBlock, buildState, inlineContent } from "../test-utils/state-builders";
import type { BlockId } from "./block-id";
import type { State } from "./state";
import type { Block } from "./block";

/** A 2×2 table: doc > table > [row0(cA,cB), row1(cC,cD)], each cell one paragraph. */
function build2x2(): State {
  const blocks: Block[] = [
    buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
    buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "row0", lastChildId: "row1" }),
    buildBlock({ id: "row0", type: "table-row", parentId: "table", nextSiblingId: "row1", firstChildId: "cA", lastChildId: "cB" }),
    buildBlock({ id: "row1", type: "table-row", parentId: "table", prevSiblingId: "row0", firstChildId: "cC", lastChildId: "cD" }),
    buildBlock({ id: "cA", type: "table-cell", parentId: "row0", nextSiblingId: "cB", firstChildId: "pA", lastChildId: "pA" }),
    buildBlock({ id: "cB", type: "table-cell", parentId: "row0", prevSiblingId: "cA", firstChildId: "pB", lastChildId: "pB" }),
    buildBlock({ id: "cC", type: "table-cell", parentId: "row1", nextSiblingId: "cD", firstChildId: "pC", lastChildId: "pC" }),
    buildBlock({ id: "cD", type: "table-cell", parentId: "row1", prevSiblingId: "cC", firstChildId: "pD", lastChildId: "pD" }),
    buildBlock({ id: "pA", type: "paragraph", parentId: "cA", inlineContent: inlineContent([]) }),
    buildBlock({ id: "pB", type: "paragraph", parentId: "cB", inlineContent: inlineContent([]) }),
    buildBlock({ id: "pC", type: "paragraph", parentId: "cC", inlineContent: inlineContent([]) }),
    buildBlock({ id: "pD", type: "paragraph", parentId: "cD", inlineContent: inlineContent([]) }),
  ];
  return buildState({ rootId: "doc", blocks });
}

const sel = (a: string, f: string) =>
  createSpan(createPosition(a as BlockId, 0), createPosition(f as BlockId, 0));

describe("resolveCellRange", () => {
  it("a collapsed selection inside one cell → a single-cell range", () => {
    const range = resolveCellRange(build2x2(), sel("pA", "pA"));
    expect(range).toEqual({ tableId: "table", minRow: 0, minCol: 0, maxRow: 0, maxCol: 0 });
  });

  it("anchor + focus in opposite corner cells → the bounding rectangle", () => {
    const range = resolveCellRange(build2x2(), sel("pA", "pD")); // cA (0,0) .. cD (1,1)
    expect(range).toEqual({ tableId: "table", minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 });
    // order-independent: focus→anchor gives the same rectangle
    expect(resolveCellRange(build2x2(), sel("pD", "pA"))).toEqual(range);
  });

  it("returns null when an endpoint is not in a table", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "p" }),
        buildBlock({ id: "table", type: "table", parentId: "doc", nextSiblingId: "p", firstChildId: "row0", lastChildId: "row0" }),
        buildBlock({ id: "row0", type: "table-row", parentId: "table", firstChildId: "cA", lastChildId: "cA" }),
        buildBlock({ id: "cA", type: "table-cell", parentId: "row0", firstChildId: "pA", lastChildId: "pA" }),
        buildBlock({ id: "pA", type: "paragraph", parentId: "cA", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", prevSiblingId: "table", inlineContent: inlineContent([]) }),
      ],
    });
    expect(resolveCellRange(state, sel("pA", "p"))).toBeNull(); // focus outside any table
    expect(resolveCellRange(state, sel("p", "p"))).toBeNull();
  });

  it("returns null when the endpoints are in two DIFFERENT tables", () => {
    // Two sibling single-cell tables in one document. A selection whose anchor is
    // in table1 and focus in table2 has no single rectangular range → null.
    const oneCellTable = (suffix: string, prev: string | null, next: string | null): Block[] => [
      buildBlock({ id: `t${suffix}`, type: "table", parentId: "doc", prevSiblingId: prev, nextSiblingId: next, firstChildId: `r${suffix}`, lastChildId: `r${suffix}` }),
      buildBlock({ id: `r${suffix}`, type: "table-row", parentId: `t${suffix}`, firstChildId: `c${suffix}`, lastChildId: `c${suffix}` }),
      buildBlock({ id: `c${suffix}`, type: "table-cell", parentId: `r${suffix}`, firstChildId: `p${suffix}`, lastChildId: `p${suffix}` }),
      buildBlock({ id: `p${suffix}`, type: "paragraph", parentId: `c${suffix}`, inlineContent: inlineContent([]) }),
    ];
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "t1", lastChildId: "t2" }),
        ...oneCellTable("1", null, "t2"),
        ...oneCellTable("2", "t1", null),
      ],
    });
    expect(resolveCellRange(state, sel("p1", "p2"))).toBeNull();
  });

  it("expands to whole span-rectangles: a merged cell partially in the bbox pulls the range out (F3)", () => {
    // 3 columns. row0 = [cA, cB, cC] (all 1×1); row1 = [cM(colSpan 2 at col 0), cD].
    // occupancy: [[cA,cB,cC],[cM,cM,cD]]. Select cB (0,1) .. cD (1,2): the endpoint
    // bbox is rows 0–1, cols 1–2, which PARTIALLY covers cM (cols 0–1). The fixpoint
    // must expand minCol to 0 to include cM's whole rectangle → cols 0–2.
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "row0", lastChildId: "row1" }),
      buildBlock({ id: "row0", type: "table-row", parentId: "table", nextSiblingId: "row1", firstChildId: "cA", lastChildId: "cC" }),
      buildBlock({ id: "row1", type: "table-row", parentId: "table", prevSiblingId: "row0", firstChildId: "cM", lastChildId: "cD" }),
      buildBlock({ id: "cA", type: "table-cell", parentId: "row0", nextSiblingId: "cB", firstChildId: "pA", lastChildId: "pA" }),
      buildBlock({ id: "cB", type: "table-cell", parentId: "row0", prevSiblingId: "cA", nextSiblingId: "cC", firstChildId: "pB", lastChildId: "pB" }),
      buildBlock({ id: "cC", type: "table-cell", parentId: "row0", prevSiblingId: "cB", firstChildId: "pC", lastChildId: "pC" }),
      buildBlock({ id: "cM", type: "table-cell", parentId: "row1", attrs: { colSpan: 2 }, nextSiblingId: "cD", firstChildId: "pM", lastChildId: "pM" }),
      buildBlock({ id: "cD", type: "table-cell", parentId: "row1", prevSiblingId: "cM", firstChildId: "pD", lastChildId: "pD" }),
      buildBlock({ id: "pA", type: "paragraph", parentId: "cA", inlineContent: inlineContent([]) }),
      buildBlock({ id: "pB", type: "paragraph", parentId: "cB", inlineContent: inlineContent([]) }),
      buildBlock({ id: "pC", type: "paragraph", parentId: "cC", inlineContent: inlineContent([]) }),
      buildBlock({ id: "pM", type: "paragraph", parentId: "cM", inlineContent: inlineContent([]) }),
      buildBlock({ id: "pD", type: "paragraph", parentId: "cD", inlineContent: inlineContent([]) }),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const range = resolveCellRange(state, sel("pB", "pD")); // cB (0,1) .. cD (1,2)
    expect(range).toEqual({ tableId: "table", minRow: 0, minCol: 0, maxRow: 1, maxCol: 2 });
  });
});
