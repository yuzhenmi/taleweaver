import { describe, it, expect } from "vitest";
import { createFloatEnvironment } from "./float-context";
import type { PlacedFloat } from "./float-context";
import { createElementBox } from "@taleweaver/core";

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

  it("dirtyBlockOffsetSince returns +Infinity for same instance", () => {
    const env = createFloatEnvironment();
    expect(env.dirtyBlockOffsetSince(env)).toBe(Number.POSITIVE_INFINITY);
  });

  it("dirtyBlockOffsetSince returns +Infinity for empty equal envs", () => {
    const a = createFloatEnvironment();
    const b = createFloatEnvironment();
    expect(a.dirtyBlockOffsetSince(b)).toBe(Number.POSITIVE_INFINITY);
  });

  it("dirtyBlockOffsetSince returns lowest differing block-offset", () => {
    const a = createFloatEnvironment();
    a.placeFloat("inline-start", 0, 80, 50, 200);
    a.placeFloat("inline-start", 100, 80, 50, 200);
    const b = createFloatEnvironment();
    b.placeFloat("inline-start", 0, 80, 50, 200);
    // Second float missing from b → diff at block 100.
    expect(a.dirtyBlockOffsetSince(b)).toBe(100);
  });

  it("dirtyBlockOffsetSince returns 0 when first float differs", () => {
    const a = createFloatEnvironment();
    a.placeFloat("inline-start", 0, 80, 50, 200);
    const b = createFloatEnvironment();
    b.placeFloat("inline-start", 0, 100, 50, 200);  // different inline-size
    expect(a.dirtyBlockOffsetSince(b)).toBe(0);
  });

  it("seedPlaced injects a pre-placed float verbatim (cumulative frame, no placement logic)", () => {
    const env = createFloatEnvironment();
    const f: PlacedFloat = { side: "inline-start", inlineOffset: 0, blockOffset: 100, inlineSize: 200, blockSize: 40 };
    env.seedPlaced(f);
    // It is visible to queries at its cumulative offset, untouched.
    expect(env.getPlacedFloats()).toEqual([f]);
    const active = env.availableInlineSizeAt(120, 600); // 120 ∈ [100,140)
    expect(active.inlineStartSize).toBe(200);
    // And it participates in placement of a subsequent float (push-down below it).
    const placed = env.placeFloat("inline-start", 100, 500, 20, 600); // 500 > 600-200=400 free → push below 140
    expect(placed.blockOffset).toBe(140);
  });
});

describe("peekPlaceFloat", () => {
  // peekPlaceFloat(side, requestedBlockOffset, inlineSize, containingInlineSize)
  // matches placeFloat(side, requestedBlockOffset, inlineSize, blockSize, containingInlineSize)
  // minus blockSize (vertical fit is the caller's concern).
  it("returns the same landing offset placeFloat would, WITHOUT mutating the env", () => {
    const env = createFloatEnvironment();
    // Seed a full-width inline-start float occupying [0, 50] so a second
    // inline-start float at offset 0 must push below to 50.
    env.placeFloat("inline-start", 0, 100, 50, 100);
    const peek = env.peekPlaceFloat("inline-start", 0, 100, 100);
    expect(peek.blockOffset).toBe(50);          // pushed below the first float
    const placed = env.placeFloat("inline-start", 0, 100, 30, 100);
    expect(placed.blockOffset).toBe(50);        // same offset the peek predicted
    expect(env.getPlacedFloats().length).toBe(2); // peek added nothing
  });

  it("peek == place for a float that fits at the requested offset (no push-below)", () => {
    const env = createFloatEnvironment();
    const peek = env.peekPlaceFloat("inline-end", 10, 40, 100);
    const placed = env.placeFloat("inline-end", 10, 40, 20, 100);
    expect(peek.blockOffset).toBe(placed.blockOffset);
    expect(peek.inlineOffset).toBe(placed.inlineOffset);
  });
});

describe("pushFloat channel", () => {
  it("accumulates pushed floats and reads them back; placed/clearance unaffected", () => {
    const env = createFloatEnvironment();
    const node = createElementBox("f", { display: "block", float: "inline-start" }, []);
    env.pushFloat({ node, side: "inline-start" });
    expect(env.pushedFloats().length).toBe(1);
    expect(env.pushedFloats()[0]?.side).toBe("inline-start");
    // Pushing does NOT place: no exclusion region, clearance unchanged at the queried offset.
    expect(env.getPlacedFloats().length).toBe(0);
    expect(env.clearance("both", 7)).toBe(7);
  });
});
