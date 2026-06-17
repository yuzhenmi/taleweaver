import { describe, it, expect } from "vitest";
import { createMockShaper } from "@taleweaver/core";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";

/**
 * Hyphenation slice 1 — U+00AD SOFT HYPHEN is a zero-advance format char.
 *
 * A soft hyphen renders NOTHING and contributes ZERO inline advance unless it is
 * the chosen line-end break (where the "-" glyph is shaped separately). The
 * shaper is the single source of truth for cluster advances, so it must give a
 * U+00AD cluster `inlineAdvance: 0` — making a word measure identically with or
 * without its embedded soft hyphens (used-size AND, downstream, intrinsic size).
 */
const SHY = "­";

describe("soft hyphen (U+00AD) zero-advance — mock shaper", () => {
  const shaper = createMockShaper(8, 16);

  it("gives a U+00AD cluster inlineAdvance 0", () => {
    const run = shaper.shape("a" + SHY + "b", INITIAL_COMPUTED_STYLE, "ltr");
    const shy = run.clusters.find((c) => run.text.codePointAt(c.start) === 0x00ad);
    expect(shy).toBeDefined();
    expect(shy?.inlineAdvance).toBe(0);
  });

  it("measures a word the same with or without an embedded soft hyphen", () => {
    const total = (t: string): number =>
      shaper
        .shape(t, INITIAL_COMPUTED_STYLE, "ltr")
        .clusters.reduce((s, c) => s + c.inlineAdvance, 0);
    expect(total("hy" + SHY + "phen")).toBe(total("hyphen"));
  });

  it("excludes the soft hyphen from unbreakableRunInlineSize", () => {
    const withSHY = shaper.shape("hy" + SHY + "phen", INITIAL_COMPUTED_STYLE, "ltr");
    const without = shaper.shape("hyphen", INITIAL_COMPUTED_STYLE, "ltr");
    expect(withSHY.unbreakableRunInlineSize).toBe(without.unbreakableRunInlineSize);
  });

  it("adds no letter-spacing for the soft hyphen cluster", () => {
    // letter-spacing is per-cluster; a zero-advance format char must not pick it
    // up either, so a spaced word measures the same with or without a soft hyphen.
    const style = { ...INITIAL_COMPUTED_STYLE, letterSpacing: 4 };
    const total = (t: string): number =>
      shaper.shape(t, style, "ltr").clusters.reduce((s, c) => s + c.inlineAdvance, 0);
    expect(total("hy" + SHY + "phen")).toBe(total("hyphen"));
  });

  it("handles multiple + leading/trailing soft hyphens (all zero-advance)", () => {
    const total = (t: string): number =>
      shaper.shape(t, INITIAL_COMPUTED_STYLE, "ltr").clusters.reduce((s, c) => s + c.inlineAdvance, 0);
    expect(total(SHY + "a" + SHY + SHY + "b" + SHY)).toBe(total("ab"));
  });
});
