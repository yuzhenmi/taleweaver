import { describe, it, expect } from "vitest";
import { resolveTableContext, getChildIds, buildTableGrid } from "./table-context";
import { buildBlock, buildState, inlineContent } from "../test-utils/state-builders";
import type { BlockId } from "./block-id";
import type { Block } from "./block";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/**
 * doc
 *  └ table [columnWidths 0.5/0.5]
 *     ├ row0 → cA(pA), cB(pB)
 *     └ row1 → cC(pC), cD(pD)
 * Extra cell attrs let individual tests inject a span / ragged shape.
 */
function buildTableState(opts?: {
  cAattrs?: Record<string, unknown>;
  dropCellD?: boolean;
}): ReturnType<typeof buildState> {
  const blocks: Block[] = [
    buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
    buildBlock({
      id: "table", type: "table", parentId: "doc",
      attrs: { columnWidths: [0.5, 0.5] },
      firstChildId: "row0", lastChildId: "row1",
    }),
    buildBlock({ id: "row0", type: "table-row", parentId: "table", nextSiblingId: "row1", firstChildId: "cA", lastChildId: "cB" }),
    buildBlock({ id: "row1", type: "table-row", parentId: "table", prevSiblingId: "row0", firstChildId: "cC", lastChildId: opts?.dropCellD ? "cC" : "cD" }),
    buildBlock({ id: "cA", type: "table-cell", parentId: "row0", nextSiblingId: "cB", firstChildId: "pA", lastChildId: "pA", attrs: opts?.cAattrs }),
    buildBlock({ id: "cB", type: "table-cell", parentId: "row0", prevSiblingId: "cA", firstChildId: "pB", lastChildId: "pB" }),
    buildBlock({ id: "cC", type: "table-cell", parentId: "row1", nextSiblingId: opts?.dropCellD ? null : "cD", firstChildId: "pC", lastChildId: "pC" }),
    buildBlock({ id: "pA", type: "paragraph", parentId: "cA", inlineContent: inlineContent([]) }),
    buildBlock({ id: "pB", type: "paragraph", parentId: "cB", inlineContent: inlineContent([]) }),
    buildBlock({ id: "pC", type: "paragraph", parentId: "cC", inlineContent: inlineContent([]) }),
  ];
  if (!opts?.dropCellD) {
    blocks.push(
      buildBlock({ id: "cD", type: "table-cell", parentId: "row1", prevSiblingId: "cC", firstChildId: "pD", lastChildId: "pD" }),
      buildBlock({ id: "pD", type: "paragraph", parentId: "cD", inlineContent: inlineContent([]) }),
    );
  }
  return buildState({ rootId: "doc", blocks });
}

describe("getChildIds", () => {
  it("returns the document-order child ids of a parent", () => {
    const state = buildTableState();
    expect(getChildIds(state, "table" as BlockId)).toEqual(["row0", "row1"]);
    expect(getChildIds(state, "row0" as BlockId)).toEqual(["cA", "cB"]);
  });
  it("returns [] for a missing or childless block", () => {
    const state = buildTableState();
    expect(getChildIds(state, "nope" as BlockId)).toEqual([]);
    expect(getChildIds(state, "pA" as BlockId)).toEqual([]);
  });
});

describe("resolveTableContext", () => {
  it("resolves the full grid context from a caret inside a cell's paragraph", () => {
    const state = buildTableState();
    const ctx = resolveTableContext(state, "pD" as BlockId);
    expect(ctx).not.toBeNull();
    if (ctx === null) throw new Error("expected ctx");
    expect(ctx.tableId).toBe("table");
    expect(ctx.rowId).toBe("row1");
    expect(ctx.cellId).toBe("cD");
    expect(ctx.rowIndex).toBe(1);
    expect(ctx.colIndex).toBe(1);
    expect(ctx.rowIds).toEqual(["row0", "row1"]);
    expect(ctx.cellIdsByRow).toEqual([["cA", "cB"], ["cC", "cD"]]);
    expect(ctx.hasSpans).toBe(false);
    expect(ctx.spanned).toBe(false);
    expect(ctx.ragged).toBe(false);
  });

  it("resolves when given the cell id directly", () => {
    const state = buildTableState();
    const ctx = resolveTableContext(state, "cA" as BlockId);
    expect(ctx?.colIndex).toBe(0);
    expect(ctx?.rowIndex).toBe(0);
  });

  it("returns null when the block is not inside a table", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
    });
    expect(resolveTableContext(state, "p" as BlockId)).toBeNull();
    expect(resolveTableContext(state, "missing" as BlockId)).toBeNull();
  });

  it("returns null for a table inside a NON-main tree (header/footer body) — ops are main-tree-only", () => {
    // A full table tree lives in templateContents (a header/footer body), not the
    // main tree. ancestorChain resolves it (cross-tree), but getBlock is main-tree
    // only, so no table-cell matches → null (the main-tree guard).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([]) }),
      ],
      templateContents: [
        buildBlock({ id: "tplTable", type: "table", firstChildId: "tplRow", lastChildId: "tplRow" }),
        buildBlock({ id: "tplRow", type: "table-row", parentId: "tplTable", firstChildId: "tplCell", lastChildId: "tplCell" }),
        buildBlock({ id: "tplCell", type: "table-cell", parentId: "tplRow", firstChildId: "tplPara", lastChildId: "tplPara" }),
        buildBlock({ id: "tplPara", type: "paragraph", parentId: "tplCell", inlineContent: inlineContent([]) }),
      ],
    });
    expect(resolveTableContext(state, "tplPara" as BlockId)).toBeNull();
  });

  it("flags hasSpans/spanned when any cell carries a real rowSpan/colSpan", () => {
    // cA colSpan 2 on the 2×2 fixture: cB is pushed to grid col 2, but row1 only
    // fills cols 0–1 → occupancy [[cA,cA,cB],[cC,cD,null]] has a HOLE at (1,2). So
    // this fixture is spanned AND ragged (the span is not compensated below). The
    // ragged gate wins → P15b leaves it gated. (A WELL-FORMED spanned table — span
    // compensated so the grid tiles fully — is the next test.)
    const state = buildTableState({ cAattrs: { colSpan: 2 } });
    const ctx = resolveTableContext(state, "pA" as BlockId);
    expect(ctx?.hasSpans).toBe(true);
    expect(ctx?.spanned).toBe(true);
    expect(ctx?.ragged).toBe(true);
  });

  it("a WELL-FORMED spanned table tiles fully: spanned=true, ragged=false (P15b runs)", () => {
    // row0 = [A(colSpan 2)]; row1 = [C, D]. occupancy [[A,A],[C,D]] — no holes.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "table", lastChildId: "table" }),
        buildBlock({ id: "table", type: "table", parentId: "doc", firstChildId: "r0", lastChildId: "r1" }),
        buildBlock({ id: "r0", type: "table-row", parentId: "table", nextSiblingId: "r1", firstChildId: "A", lastChildId: "A" }),
        buildBlock({ id: "r1", type: "table-row", parentId: "table", prevSiblingId: "r0", firstChildId: "C", lastChildId: "D" }),
        buildBlock({ id: "A", type: "table-cell", parentId: "r0", attrs: { colSpan: 2 }, firstChildId: "Ap", lastChildId: "Ap" }),
        buildBlock({ id: "Ap", type: "paragraph", parentId: "A", inlineContent: inlineContent([]) }),
        buildBlock({ id: "C", type: "table-cell", parentId: "r1", nextSiblingId: "D", firstChildId: "Cp", lastChildId: "Cp" }),
        buildBlock({ id: "Cp", type: "paragraph", parentId: "C", inlineContent: inlineContent([]) }),
        buildBlock({ id: "D", type: "table-cell", parentId: "r1", prevSiblingId: "C", firstChildId: "Dp", lastChildId: "Dp" }),
        buildBlock({ id: "Dp", type: "paragraph", parentId: "D", inlineContent: inlineContent([]) }),
      ],
    });
    const ctx = resolveTableContext(state, "Ap" as BlockId);
    expect(ctx?.spanned).toBe(true);
    expect(ctx?.ragged).toBe(false);
    expect(ctx?.hasSpans).toBe(true);
  });

  it("does NOT flag a malformed (non-integer) span — agrees with the component predicate", () => {
    const state = buildTableState({ cAattrs: { colSpan: 1.5 } });
    const ctx = resolveTableContext(state, "pA" as BlockId);
    expect(ctx?.hasSpans).toBe(false);
  });

  it("flags hasSpans/ragged for a ragged table (rows with differing cell counts)", () => {
    const state = buildTableState({ dropCellD: true }); // row1 has 1 cell, row0 has 2
    const ctx = resolveTableContext(state, "pA" as BlockId);
    expect(ctx).not.toBeNull();
    expect(ctx?.hasSpans).toBe(true);
    // ragged (degenerate) → P15b LEAVES IT GATED (a handler checks `ragged` first
    // so a spanned-AND-ragged table still no-ops — the ragged gate wins).
    expect(ctx?.ragged).toBe(true);
    expect(ctx?.spanned).toBe(false);
  });
});

describe("buildTableGrid", () => {
  it("builds the occupancy grid for a uniform 2×2 table from the State tree", () => {
    const state = buildTableState();
    const grid = buildTableGrid(state, "table" as BlockId);
    expect(grid).not.toBeNull();
    if (grid === null) throw new Error("expected a grid");
    expect(grid.columnCount).toBe(2);
    expect(grid.occupancy).toEqual([["cA", "cB"], ["cC", "cD"]]);
    // every cell is 1×1 at its document position
    expect(grid.cells).toEqual([
      { cellId: "cA", gridRow: 0, gridCol: 0, rowSpan: 1, colSpan: 1 },
      { cellId: "cB", gridRow: 0, gridCol: 1, rowSpan: 1, colSpan: 1 },
      { cellId: "cC", gridRow: 1, gridCol: 0, rowSpan: 1, colSpan: 1 },
      { cellId: "cD", gridRow: 1, gridCol: 1, rowSpan: 1, colSpan: 1 },
    ]);
  });

  it("reads spans via spanValue: a colSpan-2 cell claims two grid columns (state-built grid matches layout)", () => {
    const state = buildTableState({ cAattrs: { colSpan: 2 } });
    const grid = buildTableGrid(state, "table" as BlockId);
    if (grid === null) throw new Error("expected a grid");
    // cA spans cols 0–1, cB lands at col 2 → columnCount 3; row1 has a null tail.
    expect(grid.columnCount).toBe(3);
    expect(grid.occupancy).toEqual([["cA", "cA", "cB"], ["cC", "cD", null]]);
    expect(grid.cells[0]).toEqual({ cellId: "cA", gridRow: 0, gridCol: 0, rowSpan: 1, colSpan: 2 });
  });

  it("ignores a malformed (non-integer) span — agrees with the component's spanValue predicate", () => {
    const state = buildTableState({ cAattrs: { colSpan: 2.9 } });
    const grid = buildTableGrid(state, "table" as BlockId);
    if (grid === null) throw new Error("expected a grid");
    // spanValue(2.9) → undefined → 1×1 (NOT clampSpan(2.9)=2). Byte-identical to layout.
    expect(grid.columnCount).toBe(2);
    expect(nth(grid.cells, 0, "grid cell").colSpan).toBe(1);
  });

  it("reads rowSpan via spanValue: a rowSpan-2 cell reserves its column into the next row", () => {
    // row0 = [cA(rowSpan 2), cB], row1 = [cC] (dropCellD). cA fills (0,0) AND (1,0),
    // so cC lands at col 1 — the grid is rectangular even though the rows have
    // differing CELL counts. Exercises assignTableGrid's freeAtRow carryover.
    const state = buildTableState({ cAattrs: { rowSpan: 2 }, dropCellD: true });
    const grid = buildTableGrid(state, "table" as BlockId);
    if (grid === null) throw new Error("expected a grid");
    expect(grid.columnCount).toBe(2);
    expect(grid.occupancy).toEqual([["cA", "cB"], ["cA", "cC"]]);
    expect(grid.cells[0]).toEqual({ cellId: "cA", gridRow: 0, gridCol: 0, rowSpan: 2, colSpan: 1 });
    expect(grid.cells[2]).toEqual({ cellId: "cC", gridRow: 1, gridCol: 1, rowSpan: 1, colSpan: 1 });
  });

  it("returns null when the id is not a main-tree table block", () => {
    const state = buildTableState();
    expect(buildTableGrid(state, "row0" as BlockId)).toBeNull();
    expect(buildTableGrid(state, "missing" as BlockId)).toBeNull();
  });
});
