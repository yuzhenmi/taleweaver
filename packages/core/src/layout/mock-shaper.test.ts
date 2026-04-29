import { describe, it, expect } from "vitest";
import { createMockShaper } from "./mock-shaper";
import { INITIAL_COMPUTED_STYLE } from "../styles";

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
