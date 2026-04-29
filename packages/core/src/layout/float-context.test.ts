import { describe, it, expect } from "vitest";
import { createFloatContext } from "./float-context";

describe("FloatContext", () => {
  it("starts empty", () => {
    const fc = createFloatContext();
    expect(fc.activeAt(0)).toEqual({ inlineStartSize: 0, inlineEndSize: 0 });
  });

  it("tracks an inline-start float", () => {
    const fc = createFloatContext();
    fc.placeFloat({ side: "inline-start", inlineOffset: 0, blockOffset: 10, inlineSize: 100, blockSize: 50 });
    expect(fc.activeAt(20).inlineStartSize).toBe(100);
    expect(fc.activeAt(0).inlineStartSize).toBe(0);
    expect(fc.activeAt(60).inlineStartSize).toBe(0);     // float ends at blockOffset=60
  });

  it("stacks inline-start floats horizontally on overlapping blockOffset", () => {
    const fc = createFloatContext();
    fc.placeFloat({ side: "inline-start", inlineOffset: 0, blockOffset: 0, inlineSize: 100, blockSize: 50 });
    fc.placeFloat({ side: "inline-start", inlineOffset: 100, blockOffset: 0, inlineSize: 50, blockSize: 50 });
    expect(fc.activeAt(10).inlineStartSize).toBe(150);
  });

  it("clear: 'inline-start' returns blockOffset past all inline-start floats", () => {
    const fc = createFloatContext();
    fc.placeFloat({ side: "inline-start", inlineOffset: 0, blockOffset: 0, inlineSize: 100, blockSize: 50 });
    fc.placeFloat({ side: "inline-end", inlineOffset: 200, blockOffset: 0, inlineSize: 100, blockSize: 100 });
    expect(fc.clearY("inline-start", 10)).toBe(50);
    expect(fc.clearY("inline-end", 10)).toBe(100);
    expect(fc.clearY("both", 10)).toBe(100);
  });
});
