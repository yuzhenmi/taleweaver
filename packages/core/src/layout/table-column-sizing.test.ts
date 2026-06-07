import { describe, it, expect } from "vitest";
import { distributeColumnIntrinsics } from "./table-column-sizing";
import type { SpannedCellIntrinsic } from "./table-column-sizing";

describe("distributeColumnIntrinsics (CSS Tables §17.4)", () => {
  it("non-spanning cells set each column to the max over its cells", () => {
    const cells: SpannedCellIntrinsic[] = [
      { gridCol: 0, colSpan: 1, min: 10, max: 20 },
      { gridCol: 1, colSpan: 1, min: 5, max: 8 },
      { gridCol: 0, colSpan: 1, min: 12, max: 15 }, // second row, col0 again
    ];
    expect(distributeColumnIntrinsics(cells, 2)).toEqual({
      colMins: [12, 5],
      colMaxes: [20, 8],
    });
  });

  it("a colSpan-2 max shortfall is distributed proportional to the columns' current max", () => {
    // span-1 bases: col0 {10,10}, col1 {10,10}. Banner colSpan-2 max 30.
    // span max sum = 20, shortfall 10 split proportional to [10,10] → +5 each.
    const cells: SpannedCellIntrinsic[] = [
      { gridCol: 0, colSpan: 1, min: 10, max: 10 },
      { gridCol: 1, colSpan: 1, min: 10, max: 10 },
      { gridCol: 0, colSpan: 2, min: 0, max: 30 },
    ];
    const { colMins, colMaxes } = distributeColumnIntrinsics(cells, 2);
    expect(colMaxes[0]).toBeCloseTo(15);
    expect(colMaxes[1]).toBeCloseTo(15);
    expect(colMins).toEqual([10, 10]); // banner.min 0 < current span min 20 → unchanged
  });

  it("shortfall splits EVENLY when the spanned columns are all zero-width", () => {
    const cells: SpannedCellIntrinsic[] = [
      { gridCol: 0, colSpan: 2, min: 8, max: 8 },
    ];
    const { colMins, colMaxes } = distributeColumnIntrinsics(cells, 2);
    expect(colMins).toEqual([4, 4]);
    expect(colMaxes).toEqual([4, 4]);
  });

  it("max is floored to min per column", () => {
    // col0 base max 2 but a span-1 min 6 pushes its min above its max.
    const cells: SpannedCellIntrinsic[] = [
      { gridCol: 0, colSpan: 1, min: 2, max: 2 },
      { gridCol: 1, colSpan: 1, min: 2, max: 2 },
      { gridCol: 0, colSpan: 2, min: 12, max: 0 }, // min spans both, max 0
    ];
    const { colMins, colMaxes } = distributeColumnIntrinsics(cells, 2);
    // min shortfall 12-4=8 over [col0,col1] weighted by maxes [2,2] → +4 each → [6,6]
    expect(colMins).toEqual([6, 6]);
    // maxes floored up to mins
    expect(colMaxes).toEqual([6, 6]);
  });
});
