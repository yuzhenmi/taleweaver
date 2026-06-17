import { describe, it, expect } from "vitest";
import { resolveUsedLength, resolveUsedLengthOrNone, computeUsedStyle } from "./used-style";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";

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

  // ---------------------------------------------------------------------
  // C-B: line-height resolution at the used-style level (per spec at
  // docs/superpowers/specs/2026-05-23-line-height-disambiguation-design.md).
  // The cascade preserves unitless ratio in `cs.lineHeight`; used-style
  // multiplies by own fontSize. Percent in `cs.lineHeight` resolves
  // against own fontSize, NOT containing inline-size.
  // ---------------------------------------------------------------------

  it("C-B: unitless lineHeight × own fontSize", () => {
    const cs = { ...INITIAL_COMPUTED_STYLE, fontSize: 16, lineHeight: 1.5 };
    const us = computeUsedStyle(cs, 500, "indefinite");
    expect(us.lineHeight).toBe(24);
  });

  it("C-B: unitless lineHeight inherits as ratio — a larger fontSize child gets a proportionally larger line", () => {
    // Same lineHeight ratio, different fontSize → different used px line.
    const child = { ...INITIAL_COMPUTED_STYLE, fontSize: 32, lineHeight: 1.5 };
    const us = computeUsedStyle(child, 500, "indefinite");
    expect(us.lineHeight).toBe(48);
  });

  it("C-B: percent lineHeight resolves against own fontSize (not containing-block)", () => {
    const cs = {
      ...INITIAL_COMPUTED_STYLE,
      fontSize: 16,
      lineHeight: { unit: "percent" as const, value: 150 },
    };
    // `150%` of fontSize 16 = 24, NOT 150% of containing-inline-size 500.
    const us = computeUsedStyle(cs, 500, "indefinite");
    expect(us.lineHeight).toBe(24);
  });

  it("C-B: initial lineHeight (1.2) × initial fontSize (16) = 19.2", () => {
    // INITIAL_COMPUTED_STYLE.lineHeight === 1.2, fontSize === 16.
    const us = computeUsedStyle(INITIAL_COMPUTED_STYLE, 500, "indefinite");
    expect(us.lineHeight).toBeCloseTo(19.2, 5);
  });
});
