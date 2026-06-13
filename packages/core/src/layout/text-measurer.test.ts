import { describe, it, expect } from "vitest";
import { createMockMeasurer, measurerToShaper } from "./text-measurer";
import { INITIAL_COMPUTED_STYLE } from "../styles";

describe("createMockMeasurer", () => {
  it("measures width as text length times char width", () => {
    const m = createMockMeasurer(8, 16);
    expect(m.measureWidth("hello", INITIAL_COMPUTED_STYLE)).toBe(40);
    expect(m.measureWidth("ab", INITIAL_COMPUTED_STYLE)).toBe(16);
  });

  it("measures empty string as zero width", () => {
    const m = createMockMeasurer(8, 16);
    expect(m.measureWidth("", INITIAL_COMPUTED_STYLE)).toBe(0);
  });

  it("returns configured line height", () => {
    const m = createMockMeasurer(8, 24);
    expect(m.measureHeight(INITIAL_COMPUTED_STYLE)).toBe(24);
  });

  it("uses default values when provided explicit arguments", () => {
    const m = createMockMeasurer(8, 16);
    expect(m.measureWidth("abc", INITIAL_COMPUTED_STYLE)).toBe(24); // 3 * 8
    expect(m.measureHeight(INITIAL_COMPUTED_STYLE)).toBe(16);
  });

  it("ignores styles in measurements", () => {
    const m = createMockMeasurer(10, 20);
    expect(m.measureWidth("ab", INITIAL_COMPUTED_STYLE)).toBe(20); // 2 * 10
    expect(m.measureHeight(INITIAL_COMPUTED_STYLE)).toBe(20);
  });
});

describe("measurerToShaper UAX#14 breakOpportunities (S2.3)", () => {
  const cs = INITIAL_COMPUTED_STYLE;
  const shaper = measurerToShaper(createMockMeasurer(8, 16));

  it("CJK: soft break between every ideograph", () => {
    const run = shaper.shape("一二三四", cs, "ltr");
    const softs = run.breakOpportunities
      .filter((b) => b.kind === "soft")
      .map((b) => b.clusterIndex);
    expect(softs).toEqual([1, 2, 3]);
  });

  it("NBSP (U+00A0, GL): NO soft break around the non-breaking space", () => {
    const run = shaper.shape("a\u00A0b", cs, "ltr"); // a + NBSP (U+00A0) + b
    const softs = run.breakOpportunities
      .filter((b) => b.kind === "soft")
      .map((b) => b.clusterIndex);
    expect(softs).not.toContain(1);
    expect(softs).not.toContain(2);
  });
});
