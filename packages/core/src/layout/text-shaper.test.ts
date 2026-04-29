import { describe, it, expect } from "vitest";
import type { Cluster, BreakOpportunity, FontMetrics, ShapedRun } from "./text-shaper";

describe("TextShaper types", () => {
  it("compiles a Cluster fixture", () => {
    const cluster: Cluster = {
      start: 0, end: 1, inlineAdvance: 8,
      isLigature: false, glyphs: [42],
    };
    expect(cluster.inlineAdvance).toBe(8);
    expect(cluster.glyphs).toEqual([42]);
  });

  it("compiles a BreakOpportunity fixture for each kind", () => {
    const hard: BreakOpportunity = { clusterIndex: 5, kind: "hard" };
    const soft: BreakOpportunity = { clusterIndex: 3, kind: "soft" };
    const hyphen: BreakOpportunity = { clusterIndex: 7, kind: "hyphen" };
    expect([hard.kind, soft.kind, hyphen.kind]).toEqual(["hard", "soft", "hyphen"]);
  });

  it("compiles a FontMetrics fixture", () => {
    const fm: FontMetrics = {
      ascent: 12, descent: 4, lineGap: 0,
      capHeight: 10, xHeight: 6,
    };
    expect(fm.ascent + fm.descent).toBe(16);
  });
});
