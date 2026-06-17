import { describe, it, expect } from "vitest";
import { createMockShaper, createVariableMockShaper } from "./mock-shaper";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import type { ComputedStyle } from "../styles";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

describe("createMockShaper", () => {
  const cs = INITIAL_COMPUTED_STYLE;

  it("produces one cluster per grapheme with fixed width (single-code-unit chars unchanged)", () => {
    const shaper = createMockShaper(8, 16);
    const run = shaper.shape("abc", cs, "ltr");
    expect(run.clusters).toHaveLength(3);
    expect(nth(run.clusters, 0, "cluster").inlineAdvance).toBe(8);
    expect(run.unbreakableRunInlineSize).toBe(24);
    expect(run.minClusterInlineSize).toBe(8);
  });

  it("emits soft breaks at internal whitespace", () => {
    const shaper = createMockShaper(8, 16);
    const run = shaper.shape("a b c", cs, "ltr");
    const softs = run.breakOpportunities.filter(b => b.kind === "soft");
    // UAX #14 places the break opportunity AFTER the space (before the next
    // word), not AT the space. For "a b c" (spaces at 1, 3) the opportunities
    // are at offsets 2 and 4. Derived from lineBreakOpportunities("a b c").
    expect(softs.map(b => b.clusterIndex)).toEqual([2, 4]);
  });

  it("emits hard breaks at \\n and \\r", () => {
    const shaper = createMockShaper(8, 16);
    const run = shaper.shape("a\nb\rc", cs, "ltr");
    const hards = run.breakOpportunities.filter(b => b.kind === "hard");
    // UAX #14 LB5: the mandatory break is AFTER the newline (before the next
    // char), not AT the newline. For "a\nb\rc" (\n at 1, \r at 3) the mandatory
    // breaks are at offsets 2 and 4. Derived from lineBreakOpportunities.
    expect(hards.map(b => b.clusterIndex)).toEqual([2, 4]);
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

describe("createMockShaper grapheme clustering (P6-S1)", () => {
  const shaper = createMockShaper(8, 16);
  const cs = INITIAL_COMPUTED_STYLE;
  it("ASCII: one cluster per char, unchanged (start/end per code unit, advance 8)", () => {
    const run = shaper.shape("ab", cs, cs.direction);
    expect(run.clusters.map(c => [c.start, c.end, c.inlineAdvance])).toEqual([[0, 1, 8], [1, 2, 8]]);
  });
  it("combining sequence is ONE cluster spanning 2 code units with one base advance", () => {
    const text = "e\u0301"; // e + combining acute = 2 UTF-16 code units (decomposed)
    expect(text.length).toBe(2); // guard: fails loudly if re-normalized to precomposed U+00E9
    const run = shaper.shape(text, cs, cs.direction);
    expect(run.clusters).toHaveLength(1);
    const c0 = nth(run.clusters, 0, "cluster");
    expect([c0.start, c0.end, c0.inlineAdvance]).toEqual([0, 2, 8]);
  });
  it("surrogate-pair emoji is ONE cluster spanning 2 code units", () => {
    const run = shaper.shape("\u{1F600}", cs, cs.direction);
    expect(run.clusters).toHaveLength(1);
    const c0 = nth(run.clusters, 0, "cluster");
    expect([c0.start, c0.end]).toEqual([0, 2]);
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

describe("mock-shaper UAX#14 breakOpportunities (S2.3)", () => {
  const cs = INITIAL_COMPUTED_STYLE;
  it("CJK: soft break between every ideograph", () => {
    const run = createMockShaper(8, 16).shape("一二三四", cs, "ltr");
    const softs = run.breakOpportunities.filter(b => b.kind === "soft").map(b => b.clusterIndex);
    expect(softs).toEqual([1, 2, 3]);
  });
  it("NBSP (U+00A0, GL): NO soft break around the non-breaking space", () => {
    const text = "a\u00A0b"; // a + NBSP (U+00A0) + b
    const run = createMockShaper(8, 16).shape(text, cs, "ltr");
    const softs = run.breakOpportunities.filter(b => b.kind === "soft").map(b => b.clusterIndex);
    expect(softs).not.toContain(1);
    expect(softs).not.toContain(2);
  });
  it("regular space still a soft break (Latin unchanged)", () => {
    const run = createMockShaper(8, 16).shape("a b", cs, "ltr");
    const softs = run.breakOpportunities.filter(b => b.kind === "soft").map(b => b.clusterIndex);
    expect(softs).toContain(2); // break before 'b' (after the space)
  });
  it("newline is a hard break", () => {
    const run = createMockShaper(8, 16).shape("a\nb", cs, "ltr");
    // UAX #14 LB5: mandatory break is AFTER the LF (before 'b'), i.e. offset 2.
    expect(run.breakOpportunities.filter(b => b.kind === "hard").map(b => b.clusterIndex)).toEqual([2]);
  });
});
