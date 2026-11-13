/**
 * P8 S1 — table grid model. `cellSpan` reads the structural rowSpan/colSpan a
 * cell carries in `metadata` (stamped by the table-cell component from attrs).
 */
import { describe, it, expect } from "vitest";
import { cellSpan, assignTableGrid } from "./table-grid";
import type { GridCellInput } from "./table-grid";
import type { BlockId } from "@taleweaver/core";

/** Build a grid-cell input; rowSpan/colSpan ride in metadata (as the component stamps). */
function cell(id: string, rowSpan?: number, colSpan?: number): GridCellInput {
  const metadata =
    rowSpan !== undefined || colSpan !== undefined
      ? {
          ...(rowSpan !== undefined ? { rowSpan } : {}),
          ...(colSpan !== undefined ? { colSpan } : {}),
        }
      : undefined;
  return { key: id as BlockId, metadata };
}

describe("cellSpan (#P8.S1)", () => {
  it("defaults to 1×1 when metadata absent", () => {
    expect(cellSpan({ metadata: undefined })).toEqual({ rowSpan: 1, colSpan: 1 });
    expect(cellSpan({})).toEqual({ rowSpan: 1, colSpan: 1 });
  });

  it("defaults to 1×1 when metadata is present but carries no span keys", () => {
    expect(cellSpan({ metadata: { columnWidths: [0.5, 0.5] } })).toEqual({ rowSpan: 1, colSpan: 1 });
  });

  it("reads integer rowSpan/colSpan from metadata", () => {
    expect(cellSpan({ metadata: { rowSpan: 2, colSpan: 3 } })).toEqual({ rowSpan: 2, colSpan: 3 });
  });

  it("defaults the absent dimension to 1", () => {
    expect(cellSpan({ metadata: { colSpan: 2 } })).toEqual({ rowSpan: 1, colSpan: 2 });
    expect(cellSpan({ metadata: { rowSpan: 4 } })).toEqual({ rowSpan: 4, colSpan: 1 });
  });

  it("clamps invalid (0, negative, non-integer) to 1 / floors fractional", () => {
    expect(cellSpan({ metadata: { rowSpan: 0, colSpan: -2 } })).toEqual({ rowSpan: 1, colSpan: 1 });
    expect(cellSpan({ metadata: { rowSpan: 2.7 } })).toEqual({ rowSpan: 2, colSpan: 1 });
  });
});

describe("assignTableGrid (#P8.S1)", () => {
  it("assigns a uniform 2×2 grid (identity)", () => {
    const g = assignTableGrid([
      [cell("a"), cell("b")],
      [cell("c"), cell("d")],
    ]);
    expect(g.columnCount).toBe(2);
    expect(g.cells).toEqual([
      { cellId: "a", gridRow: 0, gridCol: 0, rowSpan: 1, colSpan: 1 },
      { cellId: "b", gridRow: 0, gridCol: 1, rowSpan: 1, colSpan: 1 },
      { cellId: "c", gridRow: 1, gridCol: 0, rowSpan: 1, colSpan: 1 },
      { cellId: "d", gridRow: 1, gridCol: 1, rowSpan: 1, colSpan: 1 },
    ]);
    expect(g.occupancy).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("banner: a top colSpan-2 cell over two cells below", () => {
    const g = assignTableGrid([
      [cell("A", 1, 2)],
      [cell("B"), cell("C")],
    ]);
    expect(g.columnCount).toBe(2);
    expect(g.cells).toEqual([
      { cellId: "A", gridRow: 0, gridCol: 0, rowSpan: 1, colSpan: 2 },
      { cellId: "B", gridRow: 1, gridCol: 0, rowSpan: 1, colSpan: 1 },
      { cellId: "C", gridRow: 1, gridCol: 1, rowSpan: 1, colSpan: 1 },
    ]);
    expect(g.occupancy).toEqual([
      ["A", "A"],
      ["B", "C"],
    ]);
  });

  it("sidebar: a left rowSpan-2 cell routes the next row's cell to col 1", () => {
    const g = assignTableGrid([
      [cell("A", 2), cell("B")],
      [cell("C")],
    ]);
    expect(g.columnCount).toBe(2);
    expect(g.cells).toEqual([
      { cellId: "A", gridRow: 0, gridCol: 0, rowSpan: 2, colSpan: 1 },
      { cellId: "B", gridRow: 0, gridCol: 1, rowSpan: 1, colSpan: 1 },
      { cellId: "C", gridRow: 1, gridCol: 1, rowSpan: 1, colSpan: 1 },
    ]);
    expect(g.occupancy).toEqual([
      ["A", "B"],
      ["A", "C"],
    ]);
  });

  it("ragged: a short row leaves trailing null slots", () => {
    const g = assignTableGrid([
      [cell("a"), cell("b")],
      [cell("c")],
    ]);
    expect(g.columnCount).toBe(2);
    expect(g.occupancy).toEqual([
      ["a", "b"],
      ["c", null],
    ]);
  });

  it("clamps an overlong rowSpan to the remaining rows", () => {
    const g = assignTableGrid([
      [cell("A", 5)], // rowSpan 5 in a 2-row table
      [cell("b")],
    ]);
    expect(g.columnCount).toBe(2);
    expect(g.cells[0]).toEqual({ cellId: "A", gridRow: 0, gridCol: 0, rowSpan: 2, colSpan: 1 });
    expect(g.cells[1]).toEqual({ cellId: "b", gridRow: 1, gridCol: 1, rowSpan: 1, colSpan: 1 });
    expect(g.occupancy).toEqual([
      ["A", null],
      ["A", "b"],
    ]);
  });

  it("clips a colSpan colliding with a rowSpan from above to the free run (RT2; earlier cells win)", () => {
    const g = assignTableGrid([
      [cell("A"), cell("B", 2)],
      [cell("C", 1, 2)],
    ]);
    expect(g.occupancy[1]).toEqual(["C", "B"]);
    expect(g.cells[2]).toEqual({ cellId: "C", gridRow: 1, gridCol: 0, rowSpan: 1, colSpan: 1 });
  });

  it("a clipped cell keeps the winner's column reserved below (3-row)", () => {
    const g = assignTableGrid([
      [cell("A"), cell("B", 3)],
      [cell("C", 1, 2)],
      [cell("E"), cell("F")],
    ]);
    expect(g.columnCount).toBe(3);
    expect(g.occupancy[2]).toEqual(["E", "B", "F"]);
  });
});
