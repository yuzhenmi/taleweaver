import { describe, expect, it } from "vitest";

import { formatCounter } from "./format-counter";

describe("formatCounter (shared bare formatter)", () => {
  it("decimal is bare (no trailing dot)", () => {
    expect(formatCounter(1, "decimal")).toBe("1");
    expect(formatCounter(42, "decimal")).toBe("42");
  });

  it("lower-alpha is bijective base-26, bare", () => {
    expect(formatCounter(1, "lower-alpha")).toBe("a");
    expect(formatCounter(2, "lower-alpha")).toBe("b");
    expect(formatCounter(26, "lower-alpha")).toBe("z");
    expect(formatCounter(27, "lower-alpha")).toBe("aa");
    expect(formatCounter(28, "lower-alpha")).toBe("ab");
  });

  it("upper-alpha is bijective base-26, bare", () => {
    expect(formatCounter(1, "upper-alpha")).toBe("A");
    expect(formatCounter(3, "upper-alpha")).toBe("C");
    expect(formatCounter(27, "upper-alpha")).toBe("AA");
  });

  it("lower-roman is subtractive, bare", () => {
    expect(formatCounter(1, "lower-roman")).toBe("i");
    expect(formatCounter(4, "lower-roman")).toBe("iv");
    expect(formatCounter(9, "lower-roman")).toBe("ix");
    expect(formatCounter(40, "lower-roman")).toBe("xl");
    expect(formatCounter(1994, "lower-roman")).toBe("mcmxciv");
  });

  it("upper-roman is subtractive, bare", () => {
    expect(formatCounter(1, "upper-roman")).toBe("I");
    expect(formatCounter(1994, "upper-roman")).toBe("MCMXCIV");
  });

  it("bullet styles return their glyph", () => {
    expect(formatCounter(1, "disc")).toBe("•"); // •
    expect(formatCounter(7, "circle")).toBe("○"); // ○
    expect(formatCounter(99, "square")).toBe("▪"); // ▪
  });
});
