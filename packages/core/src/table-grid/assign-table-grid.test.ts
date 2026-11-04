/**
 * P15b — layering-neutral occupancy-grid core. Exercises `assignTableGrid` on
 * the neutral `GridCell` input (spans pre-resolved to integers ≥ 1 by the
 * caller — NO metadata/LayoutBoxMetadata dependency). These cases mirror the
 * layout-side grid tests (layout/table-grid.test.ts) but feed the neutral
 * input directly, proving the scan algorithm is identical when callers pre-
 * normalize spans the way their layer does.
 */
import { describe, it, expect } from "vitest";
import { EMPTY_CARRY, assignTableGrid, type Carry, type GridCell, placeRow } from "./assign-table-grid";

/** Build a neutral grid cell; spans default to 1 (the caller's pre-clamp contract). */
function cell(id: string, rowSpan = 1, colSpan = 1): GridCell {
  return { cellId: id, rowSpan, colSpan };
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

  it("caps the width at maxColumns: spans clip to it, a cell whose slot would be past it overflows", () => {
    const g = assignTableGrid([[cell("A", 2, 3), cell("B", 1, 2)], [cell("C"), cell("D")]], 4);
    expect(g.columnCount).toBe(4);
    expect(g.cells.map((c) => [c.cellId, c.colSpan])).toEqual([["A", 3], ["B", 1], ["C", 1]]);
    expect(g.overflow).toEqual(["D"]);
  });
});

describe("placeRow (one row of the forming, with the carry from above)", () => {
  it("places after covered slots; the carry keeps STORED (unclipped) spans", () => {
    const r0 = placeRow(EMPTY_CARRY, [cell("A", 5), cell("B")]);
    expect(r0.placed).toEqual([
      { cellId: "A", gridCol: 0, rowSpan: 5, colSpan: 1 },
      { cellId: "B", gridCol: 1, rowSpan: 1, colSpan: 1 },
    ]);
    expect(r0.width).toBe(2);
    expect(r0.slots).toEqual(["A", "B"]);
    expect(r0.carryOut).toEqual([{ head: "A", rowsLeft: 4 }]);
    const r1 = placeRow(r0.carryOut, [cell("c")]);
    expect(r1.placed).toEqual([{ cellId: "c", gridCol: 1, rowSpan: 1, colSpan: 1 }]);
    expect(r1.width).toBe(2);
    expect(r1.carryOut).toEqual([{ head: "A", rowsLeft: 3 }]);
  });

  it("an uncovered carry is the shared empty one; a row with no cell has width 0", () => {
    const r = placeRow(EMPTY_CARRY, [cell("a"), cell("b")]);
    expect(r.carryOut).toBe(EMPTY_CARRY);
    const covered: Carry = [undefined, { head: "X", rowsLeft: 1 }];
    const z = placeRow(covered, []);
    expect(z.width).toBe(0);
    expect(z.slots).toEqual([undefined, "X"]);
    expect(z.carryOut).toBe(EMPTY_CARRY);
    // Dense: a 1-row cell before a head leaves an undefined entry, not a hole.
    const h = placeRow(EMPTY_CARRY, [cell("a"), cell("B", 2)]).carryOut;
    expect(h).toEqual([undefined, { head: "B", rowsLeft: 1 }]);
    expect(0 in h).toBe(true);
  });

  it("clips colSpan to the free run and to maxColumns; past the cap overflows", () => {
    const r = placeRow([undefined, undefined, { head: "X", rowsLeft: 2 }], [cell("a", 1, 3), cell("b", 1, 9), cell("c")], 4);
    expect(r.placed).toEqual([
      { cellId: "a", gridCol: 0, rowSpan: 1, colSpan: 2 },
      { cellId: "b", gridCol: 3, rowSpan: 1, colSpan: 1 },
    ]);
    expect(r.overflow).toEqual(["c"]);
    expect(r.width).toBe(4);
  });

  it("assignTableGrid is placeRow row by row, spans clipped to the table's end on output", () => {
    const rows = [[cell("A", 9), cell("B", 1, 2)], [cell("C", 2)], [cell("D"), cell("E")]];
    const g = assignTableGrid(rows);
    let carry: Carry = EMPTY_CARRY;
    const cells = rows.flatMap((r, i) => {
      const pr = placeRow(carry, r);
      carry = pr.carryOut;
      return pr.placed.map((p) => ({ ...p, gridRow: i, rowSpan: Math.min(p.rowSpan, rows.length - i) }));
    });
    expect(g.cells).toEqual(cells);
    expect(g.cells[0]).toEqual({ cellId: "A", gridRow: 0, gridCol: 0, rowSpan: 3, colSpan: 1 });
  });
});
