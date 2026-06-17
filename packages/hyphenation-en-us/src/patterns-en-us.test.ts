import { describe, it, expect } from "vitest";
import { EN_US_PATTERN_SET } from "./patterns-en-us";

/**
 * Well-formedness of the en-US pattern DATA. The real hyphenation-correctness
 * coverage (real words → break points, BCP-47 resolution, the U+00AD contract,
 * memoization) lives in `@taleweaver/print`'s `liang.test.ts`, which exercises
 * the ALGORITHM against this set. Here we only assert the data is shaped right.
 */
describe("EN_US_PATTERN_SET (en-us data)", () => {
  it("has a non-empty whitespace-separated patterns string with known TeX patterns", () => {
    expect(typeof EN_US_PATTERN_SET.patterns).toBe("string");
    expect(EN_US_PATTERN_SET.patterns.trim().length).toBeGreaterThan(0);
    // Spot-check a known canonical hyphen.tex pattern survived: a wholesale
    // corruption (blank-out, miskey) of the data would drop it.
    expect(EN_US_PATTERN_SET.patterns).toContain("hy3ph");
  });

  it("has an exceptions record mapping words to -separated spellings", () => {
    expect(typeof EN_US_PATTERN_SET.exceptions).toBe("object");
    for (const [word, spelling] of Object.entries(EN_US_PATTERN_SET.exceptions)) {
      expect(typeof word).toBe("string");
      expect(typeof spelling).toBe("string");
    }
    // Spot-check a known canonical exception survived (the TeX exception list).
    expect(EN_US_PATTERN_SET.exceptions["associate"]).toBe("as-so-ciate");
  });
});
