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

/** Run `fn` with NODE_ENV forced to "production" (exercises the non-dev path). */
function inProduction<T>(fn: () => T): T {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const prev = proc?.env?.NODE_ENV;
  if (proc?.env) proc.env.NODE_ENV = "production";
  try {
    return fn();
  } finally {
    if (proc?.env) proc.env.NODE_ENV = prev;
  }
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

  it("dev-asserts on a malformed overlap (a colSpan cell colliding with a rowSpan from above)", () => {
    // A 1×1 at (0,0); B rowSpan-2 at (0,1) occupies (1,1). Row1 C colSpan-2 starts at the
    // free col 0 and would extend into the occupied (1,1) → overlap.
    expect(() =>
      assignTableGrid([
        [cell("A"), cell("B", 2)],
        [cell("C", 1, 2)],
      ]),
    ).toThrow(/overlap/i);
  });

  it("in production, a malformed overlap does NOT throw and never overwrites the first writer", () => {
    const g = inProduction(() =>
      assignTableGrid([
        [cell("A"), cell("B", 2)],
        [cell("C", 1, 2)],
      ]),
    );
    // B (first writer) keeps (1,1); C took col 0 of row 1.
    expect(g.occupancy[1]).toEqual(["C", "B"]);
  });

  it("a malformed overlap does NOT shrink the winner's column reservation (3-row)", () => {
    // B rowSpan-3 owns col 1 through row 2. In row 1 a colSpan-2 C collides at
    // (1,1); the prod first-writer path must NOT lower B's freeAtRow[1] (3), or a
    // row-2 cell would wrongly enter the still-occupied col 1. With the bug,
    // row 2's F would collide with B and be dropped (columnCount 2); correct is
    // F routed to col 2 (columnCount 3).
    const g = inProduction(() =>
      assignTableGrid([
        [cell("A"), cell("B", 3)],
        [cell("C", 1, 2)],
        [cell("E"), cell("F")],
      ]),
    );
    expect(g.columnCount).toBe(3);
    expect(g.occupancy[2]).toEqual(["E", "B", "F"]);
  });
});
