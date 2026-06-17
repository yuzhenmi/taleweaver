import { describe, it, expect } from "vitest";
import { splitCell } from "./split-cell";
import { getBlock } from "../state";
import { resolveTableContext, getChildIds, buildTableGrid } from "../table-context";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import { createTestAllocator } from "../block-id";
import type { BlockId } from "../block-id";
import type { State } from "../state";
import type { Block } from "../block";

/** Resolve a context with the caret in the given block. */
function ctxAt(state: State, blockId: string) {
  const ctx = resolveTableContext(state, blockId as BlockId);
  if (ctx === null) throw new Error("expected a table context");
  return ctx;
}

/** A cell block (one empty paragraph child). Sibling links set by the caller. */
function cellBlocks(id: string, rowId: string, attrs: Record<string, unknown> | undefined, prev: string | null, next: string | null): Block[] {
  return [
    buildBlock({ id, type: "table-cell", parentId: rowId, attrs, prevSiblingId: prev, nextSiblingId: next, firstChildId: `${id}p`, lastChildId: `${id}p` }),
    buildBlock({ id: `${id}p`, type: "paragraph", parentId: id, inlineContent: inlineContent([]) }),
  ];
}

describe("splitCell", () => {
  it("unmerges a colSpan-2 cell: drops the span attr, inserts one new cell after the survivor", () => {
    // row0 = [A(colSpan 2), B]; row1 = [C, D, E]. occupancy [[A,A,B],[C,D,E]].
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "B" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: "E" }),
      ...cellBlocks("A", "r0", { colSpan: 2 }, null, "B"),
      ...cellBlocks("B", "r0", undefined, "A", null),
      ...cellBlocks("C", "r1", undefined, null, "D"),
      ...cellBlocks("D", "r1", undefined, "C", "E"),
      ...cellBlocks("E", "r1", undefined, "D", null),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const result = splitCell(state, ctxAt(state, "Ap"), createTestAllocator("nc"));
    expect(result.state).not.toBe(state);

    // A keeps content + position but is now 1×1 (no colSpan attr).
    expect(getBlock(result.state, "A" as BlockId)?.attrs.colSpan).toBeUndefined();
    const r0 = getChildIds(result.state, "r0" as BlockId);
    expect(r0.length).toBe(3);
    expect(r0[0]).toBe("A");
    expect(r0[2]).toBe("B");
    const newId = r0[1];
    if (newId === undefined) throw new Error("expected new cell id at index 1");
    expect(newId).not.toBe("A");
    expect(newId).not.toBe("B");
    expect(getBlock(result.state, newId)?.type).toBe("table-cell");

    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.columnCount).toBe(3);
    expect(grid.occupancy).toEqual([["A", newId, "B"], ["C", "D", "E"]]);
  });

  it("unmerges a colSpan-2 cell at an INTERIOR column: splices after the survivor, before the right neighbor", () => {
    // row0 = [X, A(colSpan 2), Y]; row1 = [P, Q, R, S]. occupancy [[X,A,A,Y],[P,Q,R,S]].
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "X", lastChildId: "Y" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "P", lastChildId: "S" }),
      ...cellBlocks("X", "r0", undefined, null, "A"),
      ...cellBlocks("A", "r0", { colSpan: 2 }, "X", "Y"),
      ...cellBlocks("Y", "r0", undefined, "A", null),
      ...cellBlocks("P", "r1", undefined, null, "Q"),
      ...cellBlocks("Q", "r1", undefined, "P", "R"),
      ...cellBlocks("R", "r1", undefined, "Q", "S"),
      ...cellBlocks("S", "r1", undefined, "R", null),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const result = splitCell(state, ctxAt(state, "Ap"), createTestAllocator("nc"));

    const r0 = getChildIds(result.state, "r0" as BlockId);
    expect(r0.length).toBe(4);
    expect(r0[0]).toBe("X");
    expect(r0[1]).toBe("A");
    expect(r0[3]).toBe("Y");
    // The survivor's nextSiblingId is rewritten from Y to the new cell.
    expect(getBlock(result.state, "A" as BlockId)?.nextSiblingId).toBe(r0[2]);
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["X", "A", r0[2], "Y"], ["P", "Q", "R", "S"]]);
  });

  it("unmerges a rowSpan-2 cell: inserts a new cell at the head of the next row", () => {
    // row0 = [A(rowSpan 2), B]; row1 = [C]. occupancy [[A,B],[A,C]].
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "B" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: "C" }),
      ...cellBlocks("A", "r0", { rowSpan: 2 }, null, "B"),
      ...cellBlocks("B", "r0", undefined, "A", null),
      ...cellBlocks("C", "r1", undefined, null, null),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const result = splitCell(state, ctxAt(state, "Ap"), createTestAllocator("nc"));

    expect(getBlock(result.state, "A" as BlockId)?.attrs.rowSpan).toBeUndefined();
    const r1 = getChildIds(result.state, "r1" as BlockId);
    expect(r1.length).toBe(2);
    expect(r1[1]).toBe("C");
    const newId = r1[0];
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A", "B"], [newId, "C"]]);
  });

  it("unmerges a 2×2 block: fills the 3 remaining slots, splicing correctly around spanning neighbors", () => {
    // row0 = [A(rowSpan 2,colSpan 2), B]; row1 = [C]. occupancy [[A,A,B],[A,A,C]].
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "B" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: "C" }),
      ...cellBlocks("A", "r0", { rowSpan: 2, colSpan: 2 }, null, "B"),
      ...cellBlocks("B", "r0", undefined, "A", null),
      ...cellBlocks("C", "r1", undefined, null, null),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const result = splitCell(state, ctxAt(state, "Ap"), createTestAllocator("nc"));

    const a = getBlock(result.state, "A" as BlockId);
    expect(a?.attrs.rowSpan).toBeUndefined();
    expect(a?.attrs.colSpan).toBeUndefined();

    const r0 = getChildIds(result.state, "r0" as BlockId);
    const r1 = getChildIds(result.state, "r1" as BlockId);
    expect(r0[0]).toBe("A");
    expect(r0[2]).toBe("B");
    expect(r1[2]).toBe("C");

    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.columnCount).toBe(3);
    // A at (0,0); new cells fill (0,1),(1,0),(1,1); B at (0,2); C at (1,2).
    const n01 = r0[1], n10 = r1[0], n11 = r1[1];
    expect(grid.occupancy).toEqual([["A", n01, "B"], [n10, n11, "C"]]);
    // Every filled slot is a distinct real cell (rectangular, no overlap/holes).
    expect(new Set([n01, n10, n11]).size).toBe(3);
  });

  it("no-ops (returns the same state) when the caret cell is not a real span", () => {
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r0" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", firstChildId: "A", lastChildId: "B" }),
      ...cellBlocks("A", "r0", undefined, null, "B"),
      ...cellBlocks("B", "r0", undefined, "A", null),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const result = splitCell(state, ctxAt(state, "Ap"), createTestAllocator("nc"));
    expect(result.state).toBe(state); // identity → handler short-circuits
    expect(result.dirtyIds.size).toBe(0);
  });

  it("ignores a malformed (non-integer) span — agrees with spanValue (no-op)", () => {
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r0" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", firstChildId: "A", lastChildId: "B" }),
      ...cellBlocks("A", "r0", { colSpan: 1.5 }, null, "B"),
      ...cellBlocks("B", "r0", undefined, "A", null),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const result = splitCell(state, ctxAt(state, "Ap"), createTestAllocator("nc"));
    expect(result.state).toBe(state);
  });
});
