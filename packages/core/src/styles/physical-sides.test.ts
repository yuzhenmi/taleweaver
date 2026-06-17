import { describe, it, expect } from "vitest";
import { physicalBorderSides, resolveLogicalSides } from "./physical-sides";
import type { UsedStyle } from "./used-style";
import { INITIAL_COMPUTED_STYLE } from "./property-meta";

function us(partial: Partial<UsedStyle>): UsedStyle {
  return partial as unknown as UsedStyle;
}

describe("physicalBorderSides", () => {
  it("maps logical sides to physical for horizontal-tb + LTR", () => {
    const sides = physicalBorderSides(us({
      writingMode: "horizontal-tb", direction: "ltr",
      borderBlockStartWidth: 2, borderBlockStartStyle: "solid", borderBlockStartColor: "#111",
      borderBlockEndWidth: 3, borderBlockEndStyle: "solid", borderBlockEndColor: "#222",
      borderInlineStartWidth: 4, borderInlineStartStyle: "solid", borderInlineStartColor: "#333",
      borderInlineEndWidth: 5, borderInlineEndStyle: "solid", borderInlineEndColor: "#444",
      paddingBlockStart: 0, paddingBlockEnd: 0, paddingInlineStart: 0, paddingInlineEnd: 0,
    }));
    expect(sides.topWidth).toBe(2);    expect(sides.topColor).toBe("#111");
    expect(sides.bottomWidth).toBe(3); expect(sides.bottomColor).toBe("#222");
    expect(sides.leftWidth).toBe(4);   expect(sides.leftColor).toBe("#333");
    expect(sides.rightWidth).toBe(5);  expect(sides.rightColor).toBe("#444");
  });

  it("maps block-start to the RIGHT for vertical-rl", () => {
    const sides = physicalBorderSides(us({
      writingMode: "vertical-rl", direction: "ltr",
      borderBlockStartWidth: 2, borderBlockStartStyle: "solid", borderBlockStartColor: "#111",
      borderBlockEndWidth: 0, borderBlockEndStyle: "none", borderBlockEndColor: "#000",
      borderInlineStartWidth: 0, borderInlineStartStyle: "none", borderInlineStartColor: "#000",
      borderInlineEndWidth: 0, borderInlineEndStyle: "none", borderInlineEndColor: "#000",
      paddingBlockStart: 0, paddingBlockEnd: 0, paddingInlineStart: 0, paddingInlineEnd: 0,
    }));
    expect(sides.rightWidth).toBe(2);
    expect(sides.rightColor).toBe("#111");
  });

  it("accepts a ComputedStyle-shaped context (P-2 widening)", () => {
    const cs = INITIAL_COMPUTED_STYLE;
    expect(resolveLogicalSides({ writingMode: cs.writingMode, direction: cs.direction }))
      .toEqual({ blockStart: "top", blockEnd: "bottom", inlineStart: "left", inlineEnd: "right" });
    expect(resolveLogicalSides({ writingMode: "horizontal-tb", direction: "rtl" }))
      .toEqual({ blockStart: "top", blockEnd: "bottom", inlineStart: "right", inlineEnd: "left" });
    expect(resolveLogicalSides({ writingMode: "vertical-rl", direction: "ltr" }))
      .toEqual({ blockStart: "right", blockEnd: "left", inlineStart: "top", inlineEnd: "bottom" });
  });
});
