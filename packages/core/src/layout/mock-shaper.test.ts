import { describe, it, expect } from "vitest";
import { createMockShaper, createVariableMockShaper } from "./mock-shaper";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import type { ComputedStyle } from "../styles";

describe("createMockShaper", () => {
  const cs = INITIAL_COMPUTED_STYLE;

  it("produces one cluster per codepoint with fixed width", () => {
    const shaper = createMockShaper(8, 16);
    const run = shaper.shape("abc", cs, "ltr");
    expect(run.clusters).toHaveLength(3);
    expect(run.clusters[0].inlineAdvance).toBe(8);
    expect(run.unbreakableRunInlineSize).toBe(24);
    expect(run.minClusterInlineSize).toBe(8);
  });

  it("emits soft breaks at internal whitespace", () => {
    const shaper = createMockShaper(8, 16);
    const run = shaper.shape("a b c", cs, "ltr");
    const softs = run.breakOpportunities.filter(b => b.kind === "soft");
    // Spaces at indices 1 and 3
    expect(softs.map(b => b.clusterIndex)).toEqual([1, 3]);
  });

  it("emits hard breaks at \\n and \\r", () => {
    const shaper = createMockShaper(8, 16);
    const run = shaper.shape("a\nb\rc", cs, "ltr");
    const hards = run.breakOpportunities.filter(b => b.kind === "hard");
    expect(hards.map(b => b.clusterIndex)).toEqual([1, 3]);
  });

  it("RTL baseDirection sets bidiLevel to 1", () => {
    const shaper = createMockShaper(8, 16);
    const run = shaper.shape("hello", cs, "rtl");
    expect(run.bidiLevel).toBe(1);
  });

  it("LTR baseDirection sets bidiLevel to 0", () => {
    const shaper = createMockShaper(8, 16);
    const run = shaper.shape("hello", cs, "ltr");
    expect(run.bidiLevel).toBe(0);
  });

  it("font metrics are derived from lineHeight", () => {
    const shaper = createMockShaper(8, 20);
    const fm = shaper.measureFontMetrics(cs);
    expect(fm.ascent).toBeCloseTo(16);
    expect(fm.descent).toBeCloseTo(4);
    expect(fm.ascent + fm.descent).toBe(20);
  });

  it("empty string produces zero clusters and minCluster=0", () => {
    const shaper = createMockShaper(8, 16);
    const run = shaper.shape("", cs, "ltr");
    expect(run.clusters).toHaveLength(0);
    expect(run.minClusterInlineSize).toBe(0);
    expect(run.unbreakableRunInlineSize).toBe(0);
  });
});

const spacingShaper = createMockShaper(10, 16); // 10px/char

function styleWith(over: Partial<ComputedStyle>): ComputedStyle {
  return { ...INITIAL_COMPUTED_STYLE, ...over };
}

describe("mock-shaper letter/word-spacing", () => {
  it("letterSpacing adds to every cluster advance + aggregates", () => {
    const run = spacingShaper.shape("ab", styleWith({ letterSpacing: 4 }), "ltr");
    expect(run.clusters.map(c => c.inlineAdvance)).toEqual([14, 14]); // 10 + 4
    expect(run.unbreakableRunInlineSize).toBe(28); // 14 + 14
    expect(run.minClusterInlineSize).toBe(14);     // widest spaced cluster
  });

  it("wordSpacing adds only to space clusters (plus letterSpacing on all)", () => {
    const run = spacingShaper.shape("a b", styleWith({ letterSpacing: 2, wordSpacing: 5 }), "ltr");
    // 'a' = 10+2, ' ' = 10+2+5, 'b' = 10+2
    expect(run.clusters.map(c => c.inlineAdvance)).toEqual([12, 17, 12]);
    expect(run.unbreakableRunInlineSize).toBe(41);
  });

  it("normal-identity: no spacing → today's advances", () => {
    const run = spacingShaper.shape("ab", styleWith({}), "ltr"); // INITIAL = normal
    expect(run.clusters.map(c => c.inlineAdvance)).toEqual([10, 10]);
    expect(run.unbreakableRunInlineSize).toBe(20);
    expect(run.minClusterInlineSize).toBe(10);
  });

  it("variable-width shaper: letterSpacing adds to per-char spaced advances", () => {
    const varShaper = createVariableMockShaper({ a: 6, b: 8 }, 16);
    const run = varShaper.shape("ab", styleWith({ letterSpacing: 3 }), "ltr");
    expect(run.clusters.map(c => c.inlineAdvance)).toEqual([9, 11]); // 6+3, 8+3
    expect(run.unbreakableRunInlineSize).toBe(20);
    expect(run.minClusterInlineSize).toBe(11); // widest spaced cluster
  });
});
