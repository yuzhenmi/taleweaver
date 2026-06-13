import { describe, it, expect } from "vitest";
import { insertTableColumnSpanAware } from "./insert-table-column-span-aware";
import { getBlock } from "../state";
import { resolveTableContext, getChildIds, buildTableGrid } from "../table-context";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import { createTestAllocator } from "../block-id";
import type { BlockId } from "../block-id";
import type { State } from "../state";
import type { Block } from "../block";
import type { ColumnPosition } from "./insert-table-column";

function cell(id: string, rowId: string, attrs: Record<string, unknown> | undefined, prev: string | null, next: string | null): Block[] {
  return [
    buildBlock({ id, type: "table-cell", parentId: rowId, attrs, prevSiblingId: prev, nextSiblingId: next, firstChildId: `${id}p`, lastChildId: `${id}p` }),
    buildBlock({ id: `${id}p`, type: "paragraph", parentId: id, inlineContent: inlineContent([]) }),
  ];
}

/** row0=[A(colSpan 2)], row1=[C, D]. occupancy [[A,A],[C,D]] (A spans both cols of row0). */
function buildColSpanTable(tableAttrs?: Record<string, unknown>): State {
  const blocks: Block[] = [
    buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
    buildBlock({ id: "table", type: "table", parentId: "doc", attrs: tableAttrs, firstChildId: "r0", lastChildId: "r1" }),
    buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "A" }),
    buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: "D" }),
    ...cell("A", "r0", { colSpan: 2 }, null, null),
    ...cell("C", "r1", undefined, null, "D"),
    ...cell("D", "r1", undefined, "C", null),
  ];
  return buildState({ rootId: "doc", blocks });
}

function ctxAt(state: State, blockId: string) {
  const ctx = resolveTableContext(state, blockId as BlockId);
  if (ctx === null) throw new Error("expected table context");
  return ctx;
}

const run = (state: State, caretBlock: string, pos: ColumnPosition) =>
  insertTableColumnSpanAware(state, ctxAt(state, caretBlock), pos, createTestAllocator("nc"));

describe("insertTableColumnSpanAware", () => {
  it("insert-right of a column that a colSpan crosses: the spanning cell grows, the rest gets a new cell", () => {
    // Caret in C (grid col 0). Insert right → boundary at grid col 1, which A
    // (colSpan 2, row 0) crosses → A.colSpan 2→3; row 1 (C/D boundary) gets a new cell.
    const state = buildColSpanTable();
    const result = run(state, "Cp", "right");
    expect(result.state).not.toBe(state);

    expect(getBlock(result.state, "A" as BlockId)?.attrs.colSpan).toBe(3);
    const r1 = getChildIds(result.state, "r1" as BlockId);
    expect(r1.length).toBe(3); // C, new, D
    expect(r1[0]).toBe("C");
    expect(r1[2]).toBe("D");
    const newCell = r1[1];

    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.columnCount).toBe(3);
    expect(grid.occupancy).toEqual([["A", "A", "A"], ["C", newCell, "D"]]);
  });

  it("insert-left of the first column: a new cell in every row, no span crosses", () => {
    // Caret in C (grid col 0). Insert left → boundary at grid col 0 (table edge):
    // nothing to the left, no crossing → both rows get a new cell; A is unchanged.
    const state = buildColSpanTable();
    const result = run(state, "Cp", "left");

    expect(getBlock(result.state, "A" as BlockId)?.attrs.colSpan).toBe(2); // unchanged
    const r0 = getChildIds(result.state, "r0" as BlockId);
    const r1 = getChildIds(result.state, "r1" as BlockId);
    expect(r0.length).toBe(2); // new cell + A
    expect(r0[1]).toBe("A");
    expect(r1[0]).not.toBe("C"); // new cell is at the head of row 1
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.columnCount).toBe(3);
    expect(grid.occupancy).toEqual([[r0[0], "A", "A"], [r1[0], "C", "D"]]);
  });

  it("insert-LEFT of an interior column a (non-caret) colSpan crosses: that cell bumps, caret row gets a new cell", () => {
    // row0=[B(colSpan 2), X], row1=[C, D, E]. occupancy [[B,B,X],[C,D,E]]. Caret in D
    // (grid col 1); insert left → boundary at grid col 1, which B crosses (cols 0–1)
    // → B.colSpan 2→3; row 1 (C/D boundary) gets a new cell between C and D.
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "B", lastChildId: "X" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: "E" }),
      ...cell("B", "r0", { colSpan: 2 }, null, "X"),
      ...cell("X", "r0", undefined, "B", null),
      ...cell("C", "r1", undefined, null, "D"),
      ...cell("D", "r1", undefined, "C", "E"),
      ...cell("E", "r1", undefined, "D", null),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const result = run(state, "Dp", "left"); // boundary at grid col 1

    expect(getBlock(result.state, "B" as BlockId)?.attrs.colSpan).toBe(3);
    const r1 = getChildIds(result.state, "r1" as BlockId);
    expect(r1.length).toBe(4); // C, new, D, E
    expect(r1[0]).toBe("C");
    expect(r1[2]).toBe("D");
    const newCell = r1[1];
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["B", "B", "B", "X"], ["C", newCell, "D", "E"]]);
  });

  it("re-splices columnWidths when present (one undo reverts cells + widths)", () => {
    const state = buildColSpanTable({ columnWidths: [0.5, 0.5] });
    const result = run(state, "Cp", "right"); // insert at grid col 1
    const cw = getBlock(result.state, "table" as BlockId)?.attrs.columnWidths;
    expect(Array.isArray(cw) && cw.length).toBe(3);
    // renormalized to sum 1
    const sum = (cw as number[]).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it("auto-layout table (no columnWidths) gets no attr change", () => {
    const state = buildColSpanTable(); // no columnWidths
    const result = run(state, "Cp", "right");
    expect(getBlock(result.state, "table" as BlockId)?.attrs.columnWidths).toBeUndefined();
  });

  it("a 2×2 cell crossing the boundary bumps colSpan once (dedup over its 2 rows) and preserves rowSpan", () => {
    // A(rowSpan 2,colSpan 2) covers rows 0–1, cols 0–1; B at (0,2), C at (1,2);
    // row2 = [X, Y, Z]. occupancy [[A,A,B],[A,A,C],[X,Y,Z]]. Caret in X (row 2, col 0);
    // insert right → boundary at grid col 1, which A crosses in BOTH rows 0 and 1.
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r2" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "B" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", nextSiblingId: "r2", firstChildId: "C", lastChildId: "C" }),
      buildBlock({ id: "r2", type: "table-row", parentId: "table", prevSiblingId: "r1", firstChildId: "X", lastChildId: "Z" }),
      ...cell("A", "r0", { rowSpan: 2, colSpan: 2 }, null, "B"),
      ...cell("B", "r0", undefined, "A", null),
      ...cell("C", "r1", undefined, null, null),
      ...cell("X", "r2", undefined, null, "Y"),
      ...cell("Y", "r2", undefined, "X", "Z"),
      ...cell("Z", "r2", undefined, "Y", null),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const result = run(state, "Xp", "right"); // boundary at grid col 1

    const a = getBlock(result.state, "A" as BlockId);
    expect(a?.attrs.colSpan).toBe(3); // bumped ONCE despite crossing in two rows
    expect(a?.attrs.rowSpan).toBe(2); // preserved
    const r2 = getChildIds(result.state, "r2" as BlockId);
    expect(r2.length).toBe(4); // X, new, Y, Z
    const newCell = r2[1];
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.columnCount).toBe(4);
    expect(grid.occupancy).toEqual([
      ["A", "A", "A", "B"],
      ["A", "A", "A", "C"],
      ["X", newCell, "Y", "Z"],
    ]);
  });
});
