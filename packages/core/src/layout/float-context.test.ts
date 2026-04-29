import { describe, it, expect } from "vitest";
import { createFloatEnvironment } from "./float-context";

describe("FloatEnvironment — CSS 9.5.1 placement", () => {
  it("first float on inline-start at requested block-offset", () => {
    const env = createFloatEnvironment();
    const r = env.placeFloat("inline-start", 0, 80, 50, 200);
    expect(r).toEqual({ blockOffset: 0, inlineOffset: 0 });
  });

  it("first float on inline-end placed against right edge", () => {
    const env = createFloatEnvironment();
    const r = env.placeFloat("inline-end", 0, 80, 50, 200);
    expect(r).toEqual({ blockOffset: 0, inlineOffset: 120 }); // 200 - 80
  });

  it("two same-side floats stack: second pushes below if no fit", () => {
    const env = createFloatEnvironment();
    env.placeFloat("inline-start", 0, 200, 50, 200);  // fills container
    const r = env.placeFloat("inline-start", 0, 200, 50, 200);
    expect(r).toEqual({ blockOffset: 50, inlineOffset: 0 }); // pushed to 50
  });

  it("inline-start and inline-end floats coexist if widths sum < container", () => {
    const env = createFloatEnvironment();
    env.placeFloat("inline-start", 0, 80, 50, 200);
    const r = env.placeFloat("inline-end", 0, 80, 50, 200);
    expect(r).toEqual({ blockOffset: 0, inlineOffset: 120 });
  });

  it("clearance returns block-offset past cleared side", () => {
    const env = createFloatEnvironment();
    env.placeFloat("inline-start", 0, 80, 100, 200);
    expect(env.clearance("inline-start", 50)).toBe(100);
    expect(env.clearance("inline-end", 50)).toBe(50); // no inline-end floats
    expect(env.clearance("both", 50)).toBe(100);
  });

  it("availableInlineSizeAt returns side widths at a block-offset", () => {
    const env = createFloatEnvironment();
    env.placeFloat("inline-start", 0, 80, 100, 200);
    expect(env.availableInlineSizeAt(50, 200)).toEqual({ inlineStartSize: 80, inlineEndSize: 0 });
    expect(env.availableInlineSizeAt(150, 200)).toEqual({ inlineStartSize: 0, inlineEndSize: 0 });
  });

  it("lowestFloatBlockEdge returns max block-edge across floats", () => {
    const env = createFloatEnvironment();
    env.placeFloat("inline-start", 0, 200, 100, 200); // fills container; ends at 100
    env.placeFloat("inline-start", 0, 200, 50, 200);  // pushed to 100; ends at 150
    expect(env.lowestFloatBlockEdge()).toBe(150);
  });

  it("dirtyBlockOffsetSince: same instance returns +Infinity (no change)", () => {
    const env = createFloatEnvironment();
    expect(env.dirtyBlockOffsetSince(env)).toBe(Number.POSITIVE_INFINITY);
  });

  it("dirtyBlockOffsetSince: different instance returns 0 (full re-wrap)", () => {
    const env1 = createFloatEnvironment();
    const env2 = createFloatEnvironment();
    expect(env1.dirtyBlockOffsetSince(env2)).toBe(0);
  });
});
