import { describe, it, expect } from "vitest";
import { createMockMeasurer } from "./text-measurer";

describe("createMockMeasurer", () => {
  it("measures width as text length times char width", () => {
    const m = createMockMeasurer(8, 16);
    expect(m.measureWidth("hello", {})).toBe(40);
    expect(m.measureWidth("ab", {})).toBe(16);
  });

  it("measures empty string as zero width", () => {
    const m = createMockMeasurer(8, 16);
    expect(m.measureWidth("", {})).toBe(0);
  });

  it("returns configured line height", () => {
    const m = createMockMeasurer(8, 24);
    expect(m.measureHeight({})).toBe(24);
  });

  it("uses default values when no arguments given", () => {
    const m = createMockMeasurer();
    expect(m.measureWidth("abc", {})).toBe(24); // 3 * 8 default
    expect(m.measureHeight({})).toBe(16); // default
  });

  it("ignores styles in measurements", () => {
    const m = createMockMeasurer(10, 20);
    const styles = { fontSize: 32, fontWeight: "bold" };
    expect(m.measureWidth("ab", styles)).toBe(20); // 2 * 10
    expect(m.measureHeight(styles)).toBe(20);
  });

  it("returns configured cursor height", () => {
    const m = createMockMeasurer(8, 24, 19);
    expect(m.measureCursorHeight({})).toBe(19);
  });

  it("defaults cursor height to line height when not specified", () => {
    const m = createMockMeasurer(8, 16);
    expect(m.measureCursorHeight({})).toBe(16);
  });
});
