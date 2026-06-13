import { describe, it, expect } from "vitest";
import { spanValue, isSpan } from "./table-cell-span";

describe("table-cell-span — shared span predicate", () => {
  it("treats a finite integer > 1 as a real span", () => {
    expect(spanValue(2)).toBe(2);
    expect(spanValue(3)).toBe(3);
    expect(isSpan(2)).toBe(true);
  });

  it("treats 1 / 0 / absent as no-span (the HTML default + identity)", () => {
    for (const v of [1, 0, undefined, null]) {
      expect(spanValue(v)).toBeUndefined();
      expect(isSpan(v)).toBe(false);
    }
  });

  it("treats malformed values (string, fractional, NaN, Infinity) as no-span", () => {
    for (const v of ["2", "abc", 1.5, NaN, Infinity, -2, {}]) {
      expect(spanValue(v)).toBeUndefined();
      expect(isSpan(v)).toBe(false);
    }
  });

  it("requires an integer — a fractional > 1 is no-span (so resolver/component/layout agree)", () => {
    // 2.9 is not an integer → no span. Were it floored to 2, the resolver would
    // call the cell spanned while layout's clampSpan saw a different value.
    expect(spanValue(2.9)).toBeUndefined();
  });
});
