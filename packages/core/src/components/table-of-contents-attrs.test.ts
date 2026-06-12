import { describe, it, expect } from "vitest";
import { tocLevelsFromAttrs, tocLeaderFromAttrs, tocShowPageNumbersFromAttrs, tocIndentStepFromAttrs, DEFAULT_TOC_ATTRS } from "./table-of-contents-attrs";

describe("table-of-contents attrs validators", () => {
  it("levels: valid array passes; invalid → all levels 1..6", () => {
    expect(tocLevelsFromAttrs([1, 2, 3])).toEqual([1, 2, 3]);
    expect(tocLevelsFromAttrs("nope")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(tocLevelsFromAttrs([0, 7, 2])).toEqual([2]); // drops out-of-range
    expect(tocLevelsFromAttrs([1.5, 2, 3])).toEqual([2, 3]); // drops non-integer
  });
  it("leader: 'dot'|'dash'|'line'|'none' pass; else 'dot'", () => {
    expect(tocLeaderFromAttrs("dash")).toBe("dash");
    expect(tocLeaderFromAttrs("bogus")).toBe("dot");
  });
  it("showPageNumbers: boolean passes; else true", () => {
    expect(tocShowPageNumbersFromAttrs(false)).toBe(false);
    expect(tocShowPageNumbersFromAttrs(undefined)).toBe(true);
  });
  it("indentStep: positive number → that number; else default 18", () => {
    expect(tocIndentStepFromAttrs(24)).toBe(24);
    expect(tocIndentStepFromAttrs(-5)).toBe(18);
    expect(tocIndentStepFromAttrs(0)).toBe(18); // zero is not a valid step (> 0 required)
    expect(tocIndentStepFromAttrs(Infinity)).toBe(18); // rejects non-finite
  });
  it("DEFAULT_TOC_ATTRS is the all-levels / dot / show / 18px default", () => {
    expect(DEFAULT_TOC_ATTRS).toEqual({ levels: [1, 2, 3, 4, 5, 6], leader: "dot", showPageNumbers: true, indentStep: 18 });
  });
});
