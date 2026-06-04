import { describe, it, expect } from "vitest";
import { graphemeClusters } from "./graphemes";

describe("graphemeClusters", () => {
  it("ASCII: one cluster per character (unchanged from per-code-unit)", () => {
    expect(graphemeClusters("ab")).toEqual(["a", "b"]);
  });
  it("combining mark joins its base (e + U+0301 = one cluster)", () => {
    // Explicit DECOMPOSED form "e" + combining acute = 2 UTF-16 code units, so
    // the old per-code-unit segmentation would split it into ["e", "́"].
    // (A precomposed "é" U+00E9 is 1 code unit and passes either way — not
    // load-bearing.) The escape guarantees this test actually exercises grouping.
    const decomposed = "e\u0301";
    expect(decomposed.length).toBe(2);
    expect(graphemeClusters(decomposed)).toEqual([decomposed]);
  });
  it("surrogate-pair emoji is one cluster", () => {
    expect(graphemeClusters("\u{1F600}")).toEqual(["\u{1F600}"]); // 😀 = 2 code units
  });
  it("ZWJ sequence is one cluster", () => {
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}"; // 👨‍👩‍👧
    expect(graphemeClusters(family)).toEqual([family]);
  });
  it("regional-indicator flag is one cluster (4 code units)", () => {
    const flag = "\u{1F1FA}\u{1F1F8}"; // 🇺🇸
    expect(graphemeClusters(flag)).toEqual([flag]);
  });
  it("empty string -> no clusters", () => {
    expect(graphemeClusters("")).toEqual([]);
  });
});
