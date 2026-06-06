/**
 * P8 S1 — table grid model. `cellSpan` reads the structural rowSpan/colSpan a
 * cell carries in `metadata` (stamped by the table-cell component from attrs).
 */
import { describe, it, expect } from "vitest";
import { cellSpan } from "./table-grid";

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
