import { describe, it, expect } from "vitest";
import { PX_TO_PT, pointYUp, rectYUp, mediaBoxOf } from "./coordinate";

describe("coordinate transform", () => {
  it("scales CSS px to PDF points at 0.75", () => {
    expect(PX_TO_PT).toBeCloseTo(0.75, 10);
  });

  it("flips a point's y against the page height and scales", () => {
    // page height 100px; engine point (40, 25) → ((40*0.75), (100-25)*0.75)
    expect(pointYUp(40, 25, 100)).toEqual([30, 56.25]);
  });

  it("converts a top-left rect to a y-up PDF rect", () => {
    // rect (10, 20, 30, 40) in a 200px-tall page →
    //   x=10*0.75=7.5, y=(200-20-40)*0.75=105, w=30*0.75=22.5, h=40*0.75=30
    expect(rectYUp(10, 20, 30, 40, 200)).toEqual([7.5, 105, 22.5, 30]);
  });

  it("builds a MediaBox from physical page px dims", () => {
    expect(mediaBoxOf(816, 1056)).toEqual([0, 0, 612, 792]); // US Letter px→pt
  });
});
