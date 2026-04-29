import { describe, it, expect } from "vitest";
import { resolveUsedLength, resolveUsedLengthOrNone, computeUsedStyle } from "./used-style";
import { INITIAL_COMPUTED_STYLE } from "../styles";

describe("resolveUsedLength", () => {
  it("number passes through", () => {
    expect(resolveUsedLength(42, 100, 0)).toBe(42);
  });

  it("percent resolves against containing inline-size", () => {
    expect(resolveUsedLength({ unit: "percent", value: 50 }, 200, 0)).toBe(100);
    expect(resolveUsedLength({ unit: "percent", value: 25 }, 800, 0)).toBe(200);
  });

  it("auto uses fallback", () => {
    expect(resolveUsedLength("auto", 500, 123)).toBe(123);
  });
});

describe("resolveUsedLengthOrNone", () => {
  it("none → Infinity", () => {
    expect(resolveUsedLengthOrNone("none", 500)).toBe(Number.POSITIVE_INFINITY);
  });
  it("number passes through", () => {
    expect(resolveUsedLengthOrNone(42, 500)).toBe(42);
  });
  it("percent resolves", () => {
    expect(resolveUsedLengthOrNone({ unit: "percent", value: 75 }, 400)).toBe(300);
  });
});

describe("computeUsedStyle", () => {
  it("produces fully numeric output for INITIAL_COMPUTED_STYLE", () => {
    const us = computeUsedStyle(INITIAL_COMPUTED_STYLE, 500, "indefinite");
    expect(us.marginBlockStart).toBe(0);  // 0 passes through
    expect(us.fontSize).toBe(16);
  });

  it("resolves percent margins", () => {
    const cs = {
      ...INITIAL_COMPUTED_STYLE,
      marginBlockStart: { unit: "percent" as const, value: 10 },
    };
    const us = computeUsedStyle(cs, 500, "indefinite");
    expect(us.marginBlockStart).toBe(50);
  });
});
