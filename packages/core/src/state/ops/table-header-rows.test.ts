import { describe, it, expect } from "vitest";
import { assignTableGrid } from "../table-grid-core";
import type { GridCell, TableGrid } from "../table-grid-core";
import type { BlockId } from "../block-id";
import { largestCleanHeaderCount, adjustHeaderRowCount } from "./table-header-rows";

type CellSpec = readonly [string, number?, number?];

/** Build a grid from a per-row list of `[cellId, rowSpan?, colSpan?]` tuples.
 *  An empty row (`[]`) is a row whose only columns are covered by a span from
 *  above. */
function grid(rows: readonly (readonly CellSpec[])[]): TableGrid {
  const gridRows: GridCell[][] = rows.map((row) =>
    row.map(([id, rowSpan = 1, colSpan = 1]): GridCell => ({
      cellId: id as BlockId,
      rowSpan,
      colSpan,
    })),
  );
  return assignTableGrid(gridRows);
}

describe("largestCleanHeaderCount", () => {
  it("returns the requested count when no cell spans (all 1×1)", () => {
    // 3 rows, every cell 1×1 → any header boundary is clean.
    const g = grid([[["a"]], [["b"]], [["c"]]]);
    expect(largestCleanHeaderCount(g, 2)).toBe(2);
    expect(largestCleanHeaderCount(g, 1)).toBe(1);
    expect(largestCleanHeaderCount(g, 0)).toBe(0);
  });

  it("clamps a rowSpan=2 cell in row 1 down to 1 when requested=2", () => {
    // row0=[A], row1=[B(rowSpan 2)] covering row2 (row2 empty in col 0). The
    // B-origin cell at row 1 spans rows 1–2, so a boundary at count=2 (between
    // rows 1 and 2) would straddle B → the largest clean count ≤ 2 is 1.
    const g = grid([[["A"]], [["B", 2]], []]);
    expect(largestCleanHeaderCount(g, 2)).toBe(1);
    expect(largestCleanHeaderCount(g, 1)).toBe(1); // count=1: B originates at row 1 ≥ 1 → no straddle
  });

  it("returns 0 when every candidate count > 0 straddles", () => {
    // A single-column cell spanning rows 0–1 straddles boundary at count=1; the
    // only clean count is 0. row1 is empty (A's span covers col 0).
    const g = grid([[["A", 2]], []]);
    expect(largestCleanHeaderCount(g, 1)).toBe(0);
    expect(largestCleanHeaderCount(g, 0)).toBe(0);
  });

  it("clamps requested above rowCount to rowCount then to the clean boundary", () => {
    // 2 rows, no spans → requested=5 clamps to rowCount=2.
    const clean = grid([[["a"]], [["b"]]]);
    expect(largestCleanHeaderCount(clean, 5)).toBe(2);
    // 2 rows, A spans rows 0–1 (row1 col 0 covered). count=2 (= rowCount): A
    // spans rows 0–1, 0+2=2 not > 2 → no straddle (nothing past the table end) →
    // clean. So requested=5 clamps to rowCount=2, which is clean.
    const spanned = grid([[["A", 2]], []]);
    expect(largestCleanHeaderCount(spanned, 5)).toBe(2);
  });
});

describe("adjustHeaderRowCount", () => {
  it("delete inside the header shrinks the count by 1", () => {
    expect(adjustHeaderRowCount(2, "delete", 0)).toBe(1);
    expect(adjustHeaderRowCount(2, "delete", 1)).toBe(1);
  });

  it("delete of the last header row (count=1, r=0) turns the header off", () => {
    expect(adjustHeaderRowCount(1, "delete", 0)).toBe(0);
  });

  it("delete at or past the boundary leaves the count unchanged", () => {
    expect(adjustHeaderRowCount(2, "delete", 2)).toBe(2);
    expect(adjustHeaderRowCount(2, "delete", 3)).toBe(2);
  });

  it("insert inside the header grows the count by 1", () => {
    expect(adjustHeaderRowCount(2, "insert", 0)).toBe(3);
    expect(adjustHeaderRowCount(2, "insert", 1)).toBe(3);
  });

  it("insert AT the boundary is a body row (unchanged)", () => {
    expect(adjustHeaderRowCount(2, "insert", 2)).toBe(2);
  });

  it("insert past the boundary leaves the count unchanged", () => {
    expect(adjustHeaderRowCount(2, "insert", 3)).toBe(2);
  });

  it("no-header (count=0) stays 0 for any insert/delete", () => {
    expect(adjustHeaderRowCount(0, "insert", 0)).toBe(0);
    expect(adjustHeaderRowCount(0, "delete", 0)).toBe(0);
  });

  it("result always satisfies 0 <= result <= newRowCount (property)", () => {
    // Exercise a grid of (count, op, r) over a base rowCount; the new rowCount is
    // rowCount ± 1 for insert/delete. Assert the invariant holds for every case.
    for (let rowCount = 1; rowCount <= 6; rowCount++) {
      for (let count = 0; count <= rowCount; count++) {
        for (let r = 0; r <= rowCount; r++) {
          for (const op of ["insert", "delete"] as const) {
            // delete is only valid for r < rowCount (a real row index).
            if (op === "delete" && r >= rowCount) continue;
            const newRowCount = op === "insert" ? rowCount + 1 : rowCount - 1;
            const result = adjustHeaderRowCount(count, op, r);
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThanOrEqual(newRowCount);
          }
        }
      }
    }
  });
});
