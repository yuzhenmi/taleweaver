import { describe, it, expect } from "vitest";
import { createFloatContext } from "./float-context";

describe("FloatContext", () => {
  it("starts empty", () => {
    const fc = createFloatContext();
    expect(fc.activeAt(0)).toEqual({ leftWidth: 0, rightWidth: 0, nearestBottom: Infinity });
  });

  it("tracks a left float", () => {
    const fc = createFloatContext();
    fc.placeFloat({ side: "left", x: 0, y: 10, width: 100, height: 50 });
    expect(fc.activeAt(20).leftWidth).toBe(100);
    expect(fc.activeAt(0).leftWidth).toBe(0);
    expect(fc.activeAt(60).leftWidth).toBe(0);     // float ends at y=60
  });

  it("stacks left floats horizontally on overlapping y", () => {
    const fc = createFloatContext();
    fc.placeFloat({ side: "left", x: 0, y: 0, width: 100, height: 50 });
    fc.placeFloat({ side: "left", x: 100, y: 0, width: 50, height: 50 });
    expect(fc.activeAt(10).leftWidth).toBe(150);
  });

  it("nearestBottom returns the closest float bottom in active set", () => {
    const fc = createFloatContext();
    fc.placeFloat({ side: "left", x: 0, y: 0, width: 100, height: 30 });
    fc.placeFloat({ side: "left", x: 100, y: 0, width: 50, height: 50 });
    expect(fc.activeAt(10).nearestBottom).toBe(30);
  });

  it("clear: 'left' returns y past all left floats", () => {
    const fc = createFloatContext();
    fc.placeFloat({ side: "left", x: 0, y: 0, width: 100, height: 50 });
    fc.placeFloat({ side: "right", x: 200, y: 0, width: 100, height: 100 });
    expect(fc.clearY("left", 10)).toBe(50);
    expect(fc.clearY("right", 10)).toBe(100);
    expect(fc.clearY("both", 10)).toBe(100);
  });
});
