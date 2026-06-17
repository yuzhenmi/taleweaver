import { describe, it, expect } from "vitest";
import { segmentClusters } from "./text-clusters";

describe("segmentClusters", () => {
  it("ASCII: one cluster per character (unchanged)", () => {
    expect(segmentClusters("ab")).toEqual(["a", "b"]);
  });
  it("combining mark joins its base into one grapheme cluster", () => {
    // Explicit DECOMPOSED "e"+U+0301 = 2 code units; old per-code-unit
    // segmentation split it into ["e","\u0301"]. The .length guard fails loudly
    // if this literal is ever re-normalized to precomposed U+00E9 (1 unit).
    const combining = "e\u0301";
    expect(combining.length).toBe(2);
    expect(segmentClusters(combining)).toEqual([combining]);
  });
});
