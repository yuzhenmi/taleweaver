import { describe, it, expect } from "vitest";
import { logicalToPhysical, type LogicalRect, type PhysicalRect } from "./writing-mode";

describe("logicalToPhysical", () => {
  it("identity for horizontal-tb LTR", () => {
    const logical: LogicalRect = {
      inlineOffset: 10, blockOffset: 20, inlineSize: 100, blockSize: 50,
    };
    const out: PhysicalRect = logicalToPhysical(
      logical, "horizontal-tb", "ltr", /* containingInlineSize */ 500,
    );
    expect(out).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("inverts inline axis for horizontal-tb RTL", () => {
    const logical: LogicalRect = {
      inlineOffset: 10, blockOffset: 20, inlineSize: 100, blockSize: 50,
    };
    const out: PhysicalRect = logicalToPhysical(
      logical, "horizontal-tb", "rtl", /* containingInlineSize */ 500,
    );
    expect(out).toEqual({ x: 500 - 10 - 100, y: 20, width: 100, height: 50 });
  });

  it("RTL with offset 0 places box at right edge", () => {
    const logical: LogicalRect = {
      inlineOffset: 0, blockOffset: 0, inlineSize: 80, blockSize: 30,
    };
    const out = logicalToPhysical(logical, "horizontal-tb", "rtl", 200);
    expect(out).toEqual({ x: 200 - 0 - 80, y: 0, width: 80, height: 30 });
  });
});
