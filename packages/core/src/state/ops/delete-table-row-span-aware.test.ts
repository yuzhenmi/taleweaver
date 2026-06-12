import { describe, it, expect } from "vitest";
import { deleteTableRowSpanAware } from "./delete-table-row-span-aware";
import { getBlock } from "../state";
import { resolveTableContext, getChildIds, buildTableGrid } from "../table-context";
import { buildBlock, buildState, inlineContent } from "../../test-utils/state-builders";
import type { BlockId } from "../block-id";
import type { State } from "../state";
import type { Block } from "../block";

function cell(id: string, rowId: string, attrs: Record<string, unknown> | undefined, prev: string | null, next: string | null): Block[] {
  return [
    buildBlock({ id, type: "table-cell", parentId: rowId, attrs, prevSiblingId: prev, nextSiblingId: next, firstChildId: `${id}p`, lastChildId: `${id}p` }),
    buildBlock({ id: `${id}p`, type: "paragraph", parentId: id, inlineContent: inlineContent([]) }),
  ];
}

function ctxAt(state: State, blockId: string) {
  const ctx = resolveTableContext(state, blockId as BlockId);
  if (ctx === null) throw new Error("expected table context");
  return ctx;
}

const run = (state: State, caretBlock: string) =>
  deleteTableRowSpanAware(state, ctxAt(state, caretBlock));

/** row0=[A(rowSpan N), B], then single-cell rows r1..r{N-1}. occupancy: A carries down col0. */
function buildVerticalSpan(n: number): State {
  const blocks: Block[] = [
    buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
    buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: `r${n - 1}` }),
    buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "B" }),
    ...cell("A", "r0", { rowSpan: n }, null, "B"),
    ...cell("B", "r0", undefined, "A", null),
  ];
  // tail rows r1..r{n-1}: each one cell (C, D, ...) at col 1 (A covers col 0).
  for (let r = 1; r < n; r++) {
    const id = String.fromCharCode("C".charCodeAt(0) + (r - 1));
    blocks.push(
      buildBlock({ id: `r${r}`, type: "table-row", parentId: "table", prevSiblingId: `r${r - 1}`, nextSiblingId: r < n - 1 ? `r${r + 1}` : null, firstChildId: id, lastChildId: id }),
      ...cell(id, `r${r}`, undefined, null, null),
    );
  }
  return buildState({ rootId: "doc", blocks });
}

describe("deleteTableRowSpanAware", () => {
  it("delete a row a span COVERS from above: the covering cell shrinks its rowSpan", () => {
    // row0=[A(rowSpan 2), B], row1=[C]. occupancy [[A,B],[A,C]]. Delete row1 (caret C).
    const state = buildVerticalSpan(2);
    const result = run(state, "Cp");
    expect(result.state).not.toBe(state);

    expect(getBlock(result.state, "A" as BlockId)?.attrs.rowSpan).toBeUndefined(); // 2→1, attr dropped
    expect(getChildIds(result.state, "table" as BlockId)).toEqual(["r0"]); // row1 gone
    expect(getBlock(result.state, "C" as BlockId)).toBeNull();
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A", "B"]]);
  });

  it("delete a row a span ORIGINATES in: the cell re-homes one row down, keeping its content", () => {
    // row0=[A(rowSpan 2), B], row1=[C]. Delete row0 (caret B). A re-homes to row1 as 1×1.
    const state = buildVerticalSpan(2);
    const result = run(state, "Bp");

    expect(getBlock(result.state, "B" as BlockId)).toBeNull(); // 1×1 in the deleted row → removed
    const a = getBlock(result.state, "A" as BlockId);
    expect(a?.attrs.rowSpan).toBeUndefined(); // 2→1, attr dropped
    expect(a?.parentId).toBe("r1"); // re-homed onto the next row
    expect(getChildIds(result.state, "table" as BlockId)).toEqual(["r1"]);
    expect(getChildIds(result.state, "r1" as BlockId)).toEqual(["A", "C"]); // A spliced before C
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A", "C"]]);
  });

  it("delete the origin row of a rowSpan-3 cell: it re-homes with remaining span 2", () => {
    // row0=[A(rowSpan 3), B], row1=[C], row2=[D]. Delete row0 (caret B).
    const state = buildVerticalSpan(3);
    const result = run(state, "Bp");

    const a = getBlock(result.state, "A" as BlockId);
    expect(a?.attrs.rowSpan).toBe(2); // 3→2, still a span
    expect(a?.parentId).toBe("r1");
    expect(getChildIds(result.state, "table" as BlockId)).toEqual(["r1", "r2"]);
    expect(getChildIds(result.state, "r1" as BlockId)).toEqual(["A", "C"]);
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A", "C"], ["A", "D"]]);
  });

  it("delete a MIDDLE row a rowSpan-3 cell covers: the covering cell shrinks to span 2", () => {
    // row0=[A(rowSpan 3), B], row1=[C], row2=[D]. Delete row1 (caret C).
    const state = buildVerticalSpan(3);
    const result = run(state, "Cp");

    expect(getBlock(result.state, "A" as BlockId)?.attrs.rowSpan).toBe(2); // 3→2
    expect(getBlock(result.state, "C" as BlockId)).toBeNull();
    expect(getChildIds(result.state, "table" as BlockId)).toEqual(["r0", "r2"]);
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A", "B"], ["A", "D"]]);
  });

  it("a deleted row with a covering cell + a re-homing span + a removed 1×1 (all three buckets at once)", () => {
    // 3×3. col0: A(rowSpan 3) covers all rows. row1: B(col1, rowSpan 2) covers rows1–2; C(col2, 1×1).
    // row0: P(col1), Q(col2). row2: R(col2). occupancy [[A,P,Q],[A,B,C],[A,B,R]]. Delete row1 (caret C):
    // A covering→rowSpan 2, B re-home to row2→rowSpan 1, C removed.
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r2" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "Q" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", nextSiblingId: "r2", firstChildId: "B", lastChildId: "C" }),
      buildBlock({ id: "r2", type: "table-row", parentId: "table", prevSiblingId: "r1", firstChildId: "R", lastChildId: "R" }),
      ...cell("A", "r0", { rowSpan: 3 }, null, "P"),
      ...cell("P", "r0", undefined, "A", "Q"),
      ...cell("Q", "r0", undefined, "P", null),
      ...cell("B", "r1", { rowSpan: 2 }, null, "C"),
      ...cell("C", "r1", undefined, "B", null),
      ...cell("R", "r2", undefined, null, null),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const result = run(state, "Cp");

    expect(getBlock(result.state, "A" as BlockId)?.attrs.rowSpan).toBe(2); // covering: 3→2
    expect(getBlock(result.state, "B" as BlockId)?.attrs.rowSpan).toBeUndefined(); // re-home: 2→1
    expect(getBlock(result.state, "B" as BlockId)?.parentId).toBe("r2");
    expect(getBlock(result.state, "C" as BlockId)).toBeNull(); // 1×1 removed
    expect(getChildIds(result.state, "table" as BlockId)).toEqual(["r0", "r2"]);
    expect(getChildIds(result.state, "r2" as BlockId)).toEqual(["B", "R"]);
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["A", "P", "Q"], ["A", "B", "R"]]);
  });

  it("re-homes a span into an INTERIOR position of the next row (between existing cells)", () => {
    // row0=[P, A(rowSpan 2), Q], row1=[X, _, Y] (A covers (1,1)). occupancy [[P,A,Q],[X,A,Y]].
    // Delete row0 (caret P): P,Q removed; A re-homes to row1 BETWEEN X (col0) and Y (col2).
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "P", lastChildId: "Q" }),
      buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "X", lastChildId: "Y" }),
      ...cell("P", "r0", undefined, null, "A"),
      ...cell("A", "r0", { rowSpan: 2 }, "P", "Q"),
      ...cell("Q", "r0", undefined, "A", null),
      ...cell("X", "r1", undefined, null, "Y"),
      ...cell("Y", "r1", undefined, "X", null),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const result = run(state, "Pp");

    expect(getBlock(result.state, "P" as BlockId)).toBeNull();
    expect(getBlock(result.state, "Q" as BlockId)).toBeNull();
    const a = getBlock(result.state, "A" as BlockId);
    expect(a?.parentId).toBe("r1");
    expect(a?.prevSiblingId).toBe("X"); // spliced between X and Y
    expect(a?.nextSiblingId).toBe("Y");
    expect(getChildIds(result.state, "r1" as BlockId)).toEqual(["X", "A", "Y"]);
    const grid = buildTableGrid(result.state, "table" as BlockId);
    if (grid === null) throw new Error("expected grid");
    expect(grid.occupancy).toEqual([["X", "A", "Y"]]);
  });

  it("keeps headerRowCount naming the leading block across a row delete (#487)", () => {
    // 4-row, 2-col spanned table; the span lives in the BODY (E rowSpan 2 over
    // rows 2–3) so headerRowCount=2 (rows 0–1) is clean-cut valid.
    // row0=[A,B] row1=[C,D] row2=[E(rowSpan2),F] row3=[G]. occupancy:
    // [[A,B],[C,D],[E,F],[E,G]].
    const fourRowBodySpan = (headerRowCount: number): State => {
      const blocks: Block[] = [
        buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
        buildBlock({ id: "table", type: "table", parentId: "doc", attrs: { headerRowCount }, firstChildId: "r0", lastChildId: "r3" }),
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
    // Delete a header row (row 0, r < count=2) → 1.
    expect(hrc(run(fourRowBodySpan(2), "Ap").state)).toBe(1);
    // Delete a BODY row (row 2, r ≥ count=2) → header unchanged (2).
    expect(hrc(run(fourRowBodySpan(2), "Ep").state)).toBe(2);
    // Delete the LAST header row (row 0, count=1) → header turns OFF (attr dropped).
    expect(hrc(run(fourRowBodySpan(1), "Ap").state)).toBeUndefined();
  });

  it("no-ops (same state ref) on a single-row table (the last-row collapse is the handler's job)", () => {
    const blocks: Block[] = [
      buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
      buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r0" }),
      buildBlock({ id: "r0", type: "table-row", parentId: "table", firstChildId: "A", lastChildId: "B" }),
      ...cell("A", "r0", undefined, null, "B"),
      ...cell("B", "r0", undefined, "A", null),
    ];
    const state = buildState({ rootId: "doc", blocks });
    const result = run(state, "Ap");
    expect(result.state).toBe(state);
    expect(result.dirtyIds.size).toBe(0);
  });
});
