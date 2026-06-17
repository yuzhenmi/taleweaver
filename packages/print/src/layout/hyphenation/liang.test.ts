import { describe, it, expect } from "vitest";
import { EN_US_PATTERN_SET } from "@taleweaver/hyphenation-en-us";
import { createLiangHyphenator } from "./create-liang-hyphenator";

/**
 * Real-word hyphenation tests for the concrete Knuth-Liang `en-us` hyphenator.
 *
 * The expected break points are SUFFIX-START indices (the first code unit of
 * each suffix — break BEFORE the index, with the "-" glyph rendered on the
 * prefix), matching the engine's `Token.hyphenBreaks` convention and
 * `tryHyphenSplit`. The expected breaks are the canonical TeX `hyphen.tex`
 * (en-US) hyphenations:
 *
 *   hy-phen-ation  → suffix starts at indices 2 ("phen…") and 6 ("ation")
 *   com-put-er     → suffix starts at indices 3 ("put…") and 6 ("er")
 *   al-go-rithm    → suffix starts at indices 2 ("go…") and 4 ("rithm")
 *   he-li-copter   → at least the standard interior breaks
 */
describe("createLiangHyphenator (en-us)", () => {
  const h = createLiangHyphenator({ en: EN_US_PATTERN_SET });

  it("hyphenates 'hyphenation' as hy-phen-ation", () => {
    expect(h.hyphenate("hyphenation", "en")).toEqual([2, 6]);
  });

  it("hyphenates 'computer' as com-put-er", () => {
    expect(h.hyphenate("computer", "en")).toEqual([3, 6]);
  });

  it("hyphenates 'algorithm' as al-go-rithm", () => {
    expect(h.hyphenate("algorithm", "en")).toEqual([2, 4]);
  });

  it("returns [] for a short / unhyphenatable word", () => {
    expect(h.hyphenate("the", "en")).toEqual([]);
  });

  it("returns [] for an unsupported language", () => {
    expect(h.hyphenate("hyphenation", "xx")).toEqual([]);
  });

  it("matches the language case-insensitively and on the en- prefix", () => {
    expect(h.hyphenate("hyphenation", "EN")).toEqual([2, 6]);
    expect(h.hyphenate("hyphenation", "en-US")).toEqual([2, 6]);
    expect(h.hyphenate("hyphenation", "en-GB")).toEqual([2, 6]);
  });

  it("honors the U+00AD contract: ignores soft hyphens for matching but returns ORIGINAL-word indices", () => {
    // "hy­phenation" — a soft hyphen inserted after "hy". The matcher must
    // ignore U+00AD for pattern matching (so it hyphenates the same letters)
    // but report indices into the 12-code-unit ORIGINAL string. The U+00AD is at
    // index 2, so the real breaks (2, 6 in the clean word) shift to (3, 7) in the
    // soft-hyphen-bearing word.
    const word = "hy­phenation";
    expect(word.length).toBe(12);
    expect(h.hyphenate(word, "en")).toEqual([3, 7]);
  });

  it("is deterministic / memoized: repeated calls return equal results", () => {
    expect(h.hyphenate("computer", "en")).toEqual(h.hyphenate("computer", "en"));
  });
});
