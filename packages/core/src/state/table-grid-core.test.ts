/**
 * P15b — layering-neutral occupancy-grid core. Exercises `assignTableGrid` on
 * the neutral `GridCell` input (spans pre-resolved to integers ≥ 1 by the
 * caller — NO metadata/LayoutBoxMetadata dependency). These cases mirror the
 * layout-side grid tests (layout/table-grid.test.ts) but feed the neutral
 * input directly, proving the scan algorithm is identical when callers pre-
 * normalize spans the way their layer does.
 */
import { describe, it, expect } from "vitest";
import { assignTableGrid } from "./table-grid-core";
import type { GridCell } from "./table-grid-core";
import type { BlockId } from "./block-id";

/** Build a neutral grid cell; spans default to 1 (the caller's pre-clamp contract). */
function cell(id: string, rowSpan = 1, colSpan = 1): GridCell {
  return { cellId: id as BlockId, rowSpan, colSpan };
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

describe("assignTableGrid (neutral core, #P15b)", () => {
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

  it("defensively clamps a sub-1 span to 1 (caller-contract backstop)", () => {
    // Callers pre-clamp, but the core still floors invalid spans to ≥ 1 so a
    // stray 0 / fractional never corrupts the scan (matches layout behavior).
    const g = assignTableGrid([
      [cell("a", 0, 0), cell("b")],
    ]);
    expect(g.columnCount).toBe(2);
    expect(g.cells[0]).toEqual({ cellId: "a", gridRow: 0, gridCol: 0, rowSpan: 1, colSpan: 1 });
    expect(g.occupancy).toEqual([["a", "b"]]);
  });

  it("dev-asserts on a malformed overlap (a colSpan cell colliding with a rowSpan from above)", () => {
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
    expect(g.occupancy[1]).toEqual(["C", "B"]);
  });

  it("a malformed overlap does NOT shrink the winner's column reservation (3-row)", () => {
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
