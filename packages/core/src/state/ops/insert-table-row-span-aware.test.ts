import { describe, it, expect } from "vitest";
import { insertTableRowSpanAware } from "./insert-table-row-span-aware";
import { getBlock } from "../state";
import { resolveTableContext, getChildIds, buildTableGrid } from "../table-context";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import { createTestAllocator } from "../block-id";
import type { BlockId } from "../block-id";
import type { State } from "../state";
import type { Block } from "../block";
import type { RowPosition } from "./insert-table-row";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

function cell(id: string, rowId: string, attrs: Record<string, unknown> | undefined, prev: string | null, next: string | null): Block[] {
  return [
    buildBlock({ id, type: "table-cell", parentId: rowId, attrs, prevSiblingId: prev, nextSiblingId: next, firstChildId: `${id}p`, lastChildId: `${id}p` }),
    buildBlock({ id: `${id}p`, type: "paragraph", parentId: id, inlineContent: inlineContent([]) }),
  ];
}

/** row0=[A(rowSpan 2), B], row1=[C]. occupancy [[A,B],[A,C]] (A carries into row1 col0). */
function buildRowSpanTable(): State {
  const blocks: Block[] = [
    buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
    buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
    buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "B" }),
    buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: "C" }),
    ...cell("A", "r0", { rowSpan: 2 }, null, "B"),
    ...cell("B", "r0", undefined, "A", null),
    ...cell("C", "r1", undefined, null, null),
  ];
  return buildState({ rootId: "doc", blocks });
}

function ctxAt(state: State, blockId: string) {
  const ctx = resolveTableContext(state, blockId as BlockId);
  if (ctx === null) throw new Error("expected table context");
  return ctx;
}

const run = (state: State, caretBlock: string, pos: RowPosition) =>
  insertTableRowSpanAware(state, ctxAt(state, caretBlock), pos, createTestAllocator("nr"));

describe("insertTableRowSpanAware", () => {
  it("insert-below a row that a rowSpan crosses: the spanning cell grows, the rest gets a new cell", () => {
    // Caret in B (grid row 0). Insert below → boundary at grid row 1, which A
    // (rowSpan 2) crosses → A.rowSpan 2→3; column 1 (B/C boundary) gets a new cell.
    const state = buildRowSpanTable();
    const result = run(state, "Bp", "below");
    expect(result.state).not.toBe(state);

    expect(getBlock(result.state, "A" as BlockId)?.attrs.rowSpan).toBe(3);
    const rows = getChildIds(result.state, "table" as BlockId);
    expect(rows.length).toBe(3); // r0, NEW, r1
    expect(rows[0]).toBe("r0");
    expect(rows[2]).toBe("r1");
    const newRow = nth(rows, 1, "row");
    const newCells = getChildIds(result.state, newRow);
    expect(newCells.length).toBe(1); // only the non-covered column

    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A", "B"], ["A", newCells[0]], ["A", "C"]]);
  });

  it("insert-above the top row: a full fresh row, no span crosses (caret cell at the top edge)", () => {
    // Caret in A (grid row 0). Insert above → boundary at grid row 0 (table top):
    // nothing above, no crossing → both columns get new cells; A is unchanged.
    const state = buildRowSpanTable();
    const result = run(state, "Ap", "above");

    expect(getBlock(result.state, "A" as BlockId)?.attrs.rowSpan).toBe(2); // unchanged
    const rows = getChildIds(result.state, "table" as BlockId);
    expect(rows.length).toBe(3);
    expect(rows[1]).toBe("r0"); // new row is at the head
    const newCells = getChildIds(result.state, nth(rows, 0, "row"));
    expect(newCells.length).toBe(2);
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([[newCells[0], newCells[1]], ["A", "B"], ["A", "C"]]);
  });

  it("insert-below the bottom of a rowSpan cell: a full fresh row past the span, no crossing", () => {
    // Caret in C (grid row 1, the last row). Insert below → boundary at grid row 2
    // (= rowCount): A's span ends at row 1, so nothing crosses → 2 new cells.
    const state = buildRowSpanTable();
    const result = run(state, "Cp", "below");

    expect(getBlock(result.state, "A" as BlockId)?.attrs.rowSpan).toBe(2); // unchanged
    const rows = getChildIds(result.state, "table" as BlockId);
    expect(rows.length).toBe(3);
    expect(rows[2]).not.toBe("r1"); // new row is at the tail
    const newCells = getChildIds(result.state, nth(rows, 2, "row"));
    expect(newCells.length).toBe(2);
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A", "B"], ["A", "C"], [newCells[0], newCells[1]]]);
  });

  it("insert-ABOVE an interior row that a (non-caret) span crosses: that cell bumps, caret column gets a new cell", () => {
    // col0: A(rowSpan 2) covers rows 0–1, then E at row 2. col1: B, C, D.
    // occupancy [[A,B],[A,C],[E,D]]. Caret in C (grid row 1). Insert above → boundary
    // at grid row 1, which A crosses (rows 0–1) → A.rowSpan 2→3; column 1 (B/C) new.
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r2" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "B" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", nextSiblingId: "r2", firstChildId: "C", lastChildId: "C" }),
      buildBlock({ id: "r2", type: "table-row", parentId: "table", prevSiblingId: "r1", firstChildId: "E", lastChildId: "D" }),
      ...cell("A", "r0", { rowSpan: 2 }, null, "B"),
      ...cell("B", "r0", undefined, "A", null),
      ...cell("C", "r1", undefined, null, null),
      ...cell("E", "r2", undefined, null, "D"),
      ...cell("D", "r2", undefined, "E", null),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const result = run(state, "Cp", "above"); // boundary at grid row 1

    expect(getBlock(result.state, "A" as BlockId)?.attrs.rowSpan).toBe(3);
    const rows = getChildIds(result.state, "table" as BlockId);
    expect(rows.length).toBe(4); // r0, NEW, r1, r2
    expect(rows[0]).toBe("r0");
    expect(rows[2]).toBe("r1");
    const newCells = getChildIds(result.state, nth(rows, 1, "row"));
    expect(newCells.length).toBe(1); // only column 1 uncovered
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A", "B"], ["A", newCells[0]], ["A", "C"], ["E", "D"]]);
  });

  it("keeps headerRowCount naming the leading block across a span-aware insert (#487)", () => {
    // 4-row, 2-col table with a BODY span (E rowSpan 2 over rows 2–3) so
    // headerRowCount=2 (rows 0–1) is clean-cut valid. row0=[A,B] row1=[C,D]
    // row2=[E(rowSpan2),F] row3=[G]. occupancy [[A,B],[C,D],[E,F],[E,G]].
    const fourRowBodySpan = (): State => {
      const blocks: Block[] = [
        buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
        buildBlock({ id: "table", type: "table", parentId: "doc", attrs: { headerRowCount: 2 }, firstChildId: "r0", lastChildId: "r3" }),
        buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "B" }),
        buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", nextSiblingId: "r2", firstChildId: "C", lastChildId: "D" }),
        buildBlock({ id: "r2", type: "table-row", parentId: "table", prevSiblingId: "r1", nextSiblingId: "r3", firstChildId: "E", lastChildId: "F" }),
        buildBlock({ id: "r3", type: "table-row", parentId: "table", prevSiblingId: "r2", firstChildId: "G", lastChildId: "G" }),
        ...cell("A", "r0", undefined, null, "B"),
        ...cell("B", "r0", undefined, "A", null),
        ...cell("C", "r1", undefined, null, "D"),
        ...cell("D", "r1", undefined, "C", null),
        ...cell("E", "r2", { rowSpan: 2 }, null, "F"),
        ...cell("F", "r2", undefined, "E", null),
        ...cell("G", "r3", undefined, null, null),
      ];
      return buildState({ rootId: "doc", blocks });
    };
    const hrc = (s: State) => getBlock(s, "table" as BlockId)?.attrs.headerRowCount;
    // Insert INSIDE the header (above row 1, gr=1 < count=2) → 3.
    expect(hrc(run(fourRowBodySpan(), "Dp", "above").state)).toBe(3);
    // Insert AT the boundary (below row 1, gr=2 === count) → body row, unchanged (2).
    expect(hrc(run(fourRowBodySpan(), "Dp", "below").state)).toBe(2);
  });

  it("a 2×2 cell crossing the boundary bumps rowSpan once (dedup) and preserves colSpan", () => {
    // row0=[A(rowSpan 2,colSpan 2), B], row1=[C]. occupancy [[A,A,B],[A,A,C]].
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "B" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: "C" }),
      ...cell("A", "r0", { rowSpan: 2, colSpan: 2 }, null, "B"),
      ...cell("B", "r0", undefined, "A", null),
      ...cell("C", "r1", undefined, null, null),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const result = run(state, "Bp", "below"); // caret in B (col 2, grid row 0); boundary at row 1

    const a = getBlock(result.state, "A" as BlockId);
    expect(a?.attrs.rowSpan).toBe(3); // bumped once despite covering two columns
    expect(a?.attrs.colSpan).toBe(2); // preserved
    const rows = getChildIds(result.state, "table" as BlockId);
    const newRow = nth(rows, 1, "row");
    const newCells = getChildIds(result.state, newRow);
    expect(newCells.length).toBe(1); // only column 2 is uncovered
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A", "A", "B"], ["A", "A", newCells[0]], ["A", "A", "C"]]);
  });
});
