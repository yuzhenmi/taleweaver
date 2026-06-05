import { describe, it, expect } from "vitest";
import { lineBreakClass } from "./line-break-class";

describe("lineBreakClass", () => {
  it("classifies common code points", () => {
    expect(lineBreakClass(0x0041)).toBe("AL"); // 'A' Alphabetic
    expect(lineBreakClass(0x0020)).toBe("SP"); // SPACE
    expect(lineBreakClass(0x00A0)).toBe("GL"); // NBSP — Glue (the NBSP-no-break basis)
    expect(lineBreakClass(0x000A)).toBe("LF"); // LINE FEED
    expect(lineBreakClass(0x000D)).toBe("CR"); // CARRIAGE RETURN
    expect(lineBreakClass(0x2028)).toBe("BK"); // LINE SEPARATOR (mandatory)
    expect(lineBreakClass(0x002D)).toBe("HY"); // HYPHEN-MINUS
    expect(lineBreakClass(0x0030)).toBe("NU"); // '0' Numeric
    expect(lineBreakClass(0x4E00)).toBe("ID"); // CJK ideograph 一
    expect(lineBreakClass(0x1F1E6)).toBe("RI"); // REGIONAL INDICATOR A (astral)
  });

  it("classifies an astral CJK Extension B code point as ID", () => {
    // U+20000 (𠀀) — CJK Unified Ideograph Extension B, requires surrogate pair.
    expect(lineBreakClass(0x20000)).toBe("ID");
  });

  it("returns XX for an unassigned / out-of-range code point", () => {
    expect(lineBreakClass(0x10FFFF)).toBe("XX"); // last code point, unassigned
    expect(lineBreakClass(-1)).toBe("XX");
    expect(lineBreakClass(0x110000)).toBe("XX"); // beyond Unicode range
  });
});

import { isEastAsianWide } from "./line-break-class";

describe("isEastAsianWide", () => {
  it("is true for East-Asian wide/fullwidth code points", () => {
    expect(isEastAsianWide(0x4E00)).toBe(true);   // CJK ideograph 一 (W)
    expect(isEastAsianWide(0x3008)).toBe(true);   // 〈 LEFT ANGLE BRACKET (W) — the LB30 case
    expect(isEastAsianWide(0xFF01)).toBe(true);   // ！ FULLWIDTH EXCLAMATION (F)
    expect(isEastAsianWide(0xFF61)).toBe(true);   // ｡ HALFWIDTH IDEOGRAPHIC FULL STOP (H) — H is in LB30's set
  });
  it("is false for narrow / neutral code points", () => {
    expect(isEastAsianWide(0x0041)).toBe(false);  // 'A' (Na)
    expect(isEastAsianWide(0x0028)).toBe(false);  // '(' (Na) — ordinary OP, LB30 suppresses
    expect(isEastAsianWide(-1)).toBe(false);
  });
});
