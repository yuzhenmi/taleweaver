import { describe, it, expect } from "vitest";
import { createMockHyphenator } from "./mock-hyphenator";

describe("createMockHyphenator", () => {
  it("returns sorted suffix-start indices at every Nth code unit (default every=3)", () => {
    const h = createMockHyphenator({});
    // "hyphenation" — length 11. Break before code units 3, 6, 9.
    expect(h.hyphenate("hyphenation", "en")).toEqual([3, 6, 9]);
  });

  it("honors a custom `every` step", () => {
    const h = createMockHyphenator({ every: 2 });
    // length 6 → break before 2, 4. (Index 6 is the end, not interior.)
    expect(h.hyphenate("abcdef", "en")).toEqual([2, 4]);
  });

  it("returns [] for a non-matching language when a language is configured", () => {
    const h = createMockHyphenator({ language: "en" });
    expect(h.hyphenate("hyphenation", "de")).toEqual([]);
    // matching language still hyphenates
    expect(h.hyphenate("hyphenation", "en")).toEqual([3, 6, 9]);
  });

  it("matches any language when `language` is undefined", () => {
    const h = createMockHyphenator({});
    expect(h.hyphenate("hyphenation", "de")).toEqual([3, 6, 9]);
    expect(h.hyphenate("hyphenation", "fr")).toEqual([3, 6, 9]);
  });

  it("returns [] for a word shorter than `floor`", () => {
    const h = createMockHyphenator({ floor: 5 });
    expect(h.hyphenate("abcd", "en")).toEqual([]); // length 4 < 5
    expect(h.hyphenate("abcde", "en")).toEqual([3]); // length 5 >= 5
  });

  it("returns no interior point at or past the word end", () => {
    const h = createMockHyphenator({ every: 3 });
    // length 3 → first candidate would be index 3 = end, so no interior breaks.
    expect(h.hyphenate("abc", "en")).toEqual([]);
  });
});
