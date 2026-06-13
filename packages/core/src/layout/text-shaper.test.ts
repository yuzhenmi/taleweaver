import { describe, it, expect } from "vitest";
import type { Cluster, BreakOpportunity, FontMetrics } from "./text-shaper";
import { toBreakOpportunities } from "./text-shaper";

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

  it("toBreakOpportunities maps the UAX #14 classifier to BreakOpportunity[]", () => {
    // Regular space: a soft break before the word after it (UAX #14 LB after SP).
    const latin = toBreakOpportunities("ab cd");
    expect(latin.some(b => b.kind === "soft" && b.clusterIndex === 3)).toBe(true);
    // No hard break in a single-line run.
    expect(latin.some(b => b.kind === "hard")).toBe(false);
    // A mandatory break (LF) maps to "hard".
    expect(toBreakOpportunities("a\nb").some(b => b.kind === "hard")).toBe(true);
    // CJK ideographs (class ID) get a soft break between them (offset 1) by
    // default — and never a "hyphen" kind (no hyphenation backend).
    const cjk = toBreakOpportunities("一二");
    expect(cjk.some(b => b.kind === "soft" && b.clusterIndex === 1)).toBe(true);
    expect(cjk.every(b => b.kind !== "hyphen")).toBe(true);
    // NBSP (GL glue) suppresses the break around it: "a b" has no soft
    // break at the glue boundary (offsets 1 or 2).
    const nbsp = toBreakOpportunities("a\u00A0b");
    expect(nbsp.some(b => b.clusterIndex === 1 || b.clusterIndex === 2)).toBe(false);
  });

  it("compiles a FontMetrics fixture", () => {
    const fm: FontMetrics = {
      ascent: 12, descent: 4, lineGap: 0,
      capHeight: 10, xHeight: 6,
    };
    expect(fm.ascent + fm.descent).toBe(16);
  });
});
