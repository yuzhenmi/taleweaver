import { describe, it, expect } from "vitest";
import { formatCounter } from "./list-counter";

describe("formatCounter", () => {
  it("decimal", () => {
    expect(formatCounter(1, "decimal")).toBe("1.");
    expect(formatCounter(42, "decimal")).toBe("42.");
  });
  it("lower-alpha", () => {
    expect(formatCounter(1, "lower-alpha")).toBe("a.");
    expect(formatCounter(2, "lower-alpha")).toBe("b.");
    expect(formatCounter(26, "lower-alpha")).toBe("z.");
    expect(formatCounter(27, "lower-alpha")).toBe("aa.");
    expect(formatCounter(28, "lower-alpha")).toBe("ab.");
  });
  it("upper-alpha", () => {
    expect(formatCounter(1, "upper-alpha")).toBe("A.");
    expect(formatCounter(27, "upper-alpha")).toBe("AA.");
  });
  it("lower-roman", () => {
    expect(formatCounter(1, "lower-roman")).toBe("i.");
    expect(formatCounter(4, "lower-roman")).toBe("iv.");
    expect(formatCounter(9, "lower-roman")).toBe("ix.");
    expect(formatCounter(40, "lower-roman")).toBe("xl.");
    expect(formatCounter(1994, "lower-roman")).toBe("mcmxciv.");
  });
  it("upper-roman", () => {
    expect(formatCounter(1, "upper-roman")).toBe("I.");
    expect(formatCounter(1994, "upper-roman")).toBe("MCMXCIV.");
  });
});
