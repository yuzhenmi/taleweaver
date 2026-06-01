import { describe, it, expect } from "vitest";
import { formatCounter } from "./format-counter";

describe("formatCounter — decimal", () => {
  it("formats 1-based integers verbatim", () => {
    expect(formatCounter(1, "decimal")).toBe("1");
    expect(formatCounter(2, "decimal")).toBe("2");
    expect(formatCounter(3, "decimal")).toBe("3");
    expect(formatCounter(10, "decimal")).toBe("10");
    expect(formatCounter(42, "decimal")).toBe("42");
    expect(formatCounter(1000, "decimal")).toBe("1000");
  });
});

describe("formatCounter — lower-roman", () => {
  it("formats the i..xii sequence", () => {
    const expected = [
      "i", "ii", "iii", "iv", "v", "vi",
      "vii", "viii", "ix", "x", "xi", "xii",
    ];
    expected.forEach((s, idx) => {
      expect(formatCounter(idx + 1, "lower-roman")).toBe(s);
    });
  });

  it("formats subtractive boundaries at all magnitudes (ix, xl, xc, cd, cm, 3888)", () => {
    expect(formatCounter(9, "lower-roman")).toBe("ix");
    expect(formatCounter(40, "lower-roman")).toBe("xl");
    expect(formatCounter(49, "lower-roman")).toBe("xlix");
    expect(formatCounter(90, "lower-roman")).toBe("xc");
    expect(formatCounter(400, "lower-roman")).toBe("cd");
    expect(formatCounter(900, "lower-roman")).toBe("cm");
    expect(formatCounter(2024, "lower-roman")).toBe("mmxxiv");
    expect(formatCounter(3888, "lower-roman")).toBe("mmmdccclxxxviii");
  });

  it("upper-roman subtractive boundaries (CD, CM)", () => {
    expect(formatCounter(400, "upper-roman")).toBe("CD");
    expect(formatCounter(900, "upper-roman")).toBe("CM");
    expect(formatCounter(3888, "upper-roman")).toBe("MMMDCCCLXXXVIII");
  });

  it("base case n=1 is i", () => {
    expect(formatCounter(1, "lower-roman")).toBe("i");
  });
});

describe("formatCounter — upper-roman", () => {
  it("formats the I..XII sequence", () => {
    const expected = [
      "I", "II", "III", "IV", "V", "VI",
      "VII", "VIII", "IX", "X", "XI", "XII",
    ];
    expected.forEach((s, idx) => {
      expect(formatCounter(idx + 1, "upper-roman")).toBe(s);
    });
  });

  it("formats subtractive boundaries (IX, XL)", () => {
    expect(formatCounter(9, "upper-roman")).toBe("IX");
    expect(formatCounter(40, "upper-roman")).toBe("XL");
  });
});

describe("formatCounter — lower-alpha (bijective base-26)", () => {
  it("formats a..z", () => {
    const letters = "abcdefghijklmnopqrstuvwxyz".split("");
    letters.forEach((c, idx) => {
      expect(formatCounter(idx + 1, "lower-alpha")).toBe(c);
    });
  });

  it("rolls over to aa, ab, az, ba past z", () => {
    expect(formatCounter(27, "lower-alpha")).toBe("aa");
    expect(formatCounter(28, "lower-alpha")).toBe("ab");
    expect(formatCounter(52, "lower-alpha")).toBe("az");
    expect(formatCounter(53, "lower-alpha")).toBe("ba");
    expect(formatCounter(702, "lower-alpha")).toBe("zz");
    expect(formatCounter(703, "lower-alpha")).toBe("aaa");
  });

  it("base case n=1 is a", () => {
    expect(formatCounter(1, "lower-alpha")).toBe("a");
  });
});

describe("formatCounter — upper-alpha (bijective base-26)", () => {
  it("formats A..Z then AA", () => {
    expect(formatCounter(1, "upper-alpha")).toBe("A");
    expect(formatCounter(26, "upper-alpha")).toBe("Z");
    expect(formatCounter(27, "upper-alpha")).toBe("AA");
    expect(formatCounter(28, "upper-alpha")).toBe("AB");
    expect(formatCounter(53, "upper-alpha")).toBe("BA");
  });
});

describe("formatCounter — symbol", () => {
  it("uses the traditional typographic cycle *, †, ‡, §, ‖, ¶", () => {
    expect(formatCounter(1, "symbol")).toBe("*");
    expect(formatCounter(2, "symbol")).toBe("†");
    expect(formatCounter(3, "symbol")).toBe("‡");
    expect(formatCounter(4, "symbol")).toBe("§");
    expect(formatCounter(5, "symbol")).toBe("‖");
    expect(formatCounter(6, "symbol")).toBe("¶");
  });

  it("doubles the glyph for the second cycle", () => {
    expect(formatCounter(7, "symbol")).toBe("**");
    expect(formatCounter(8, "symbol")).toBe("††");
    expect(formatCounter(12, "symbol")).toBe("¶¶");
  });

  it("triples the glyph for the third cycle", () => {
    expect(formatCounter(13, "symbol")).toBe("***");
    expect(formatCounter(14, "symbol")).toBe("†††");
    expect(formatCounter(18, "symbol")).toBe("¶¶¶");
  });

  it("base case n=1 is a single asterisk", () => {
    expect(formatCounter(1, "symbol")).toBe("*");
  });
});

describe("formatCounter — invalid input", () => {
  it("throws on non-positive values", () => {
    expect(() => formatCounter(0, "decimal")).toThrow();
    expect(() => formatCounter(-1, "lower-roman")).toThrow();
  });

  it("throws on non-integer values", () => {
    expect(() => formatCounter(1.5, "decimal")).toThrow();
  });
});
