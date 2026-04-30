import { describe, it, expect } from "vitest";
import { createPageBox } from "./page-box";
import { createBlockBox } from "./layout-box-v2";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import { computeUsedStyle } from "./used-style";

describe("createPageBox", () => {
  it("constructs a frozen PageBox with type=page (LTR, empty children)", () => {
    const cs = INITIAL_COMPUTED_STYLE;
    const us = computeUsedStyle(cs, 816, "indefinite");
    const page = createPageBox(
      "page-0",
      0, 0,                         // inlineOffset, blockOffset
      816, 1056,                    // inlineSize, blockSize
      cs.writingMode, cs.direction,
      cs, us,
      [],                            // children
      0,                             // pageIndex
      816,                           // containingInlineSize
    );
    expect(page.type).toBe("page");
    expect(page.key).toBe("page-0");
    expect(page.inlineSize).toBe(816);
    expect(page.blockSize).toBe(1056);
    expect(page.pageIndex).toBe(0);
    expect(page.x).toBe(0);
    expect(page.y).toBe(0);
    expect(page.width).toBe(816);
    expect(page.height).toBe(1056);
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.children)).toBe(true);
    expect(Object.isFrozen(page.computedStyle)).toBe(true);
    expect(Object.isFrozen(page.usedStyle)).toBe(true);
  });

  it("constructs a frozen PageBox with non-empty children", () => {
    const cs = INITIAL_COMPUTED_STYLE;
    const us = computeUsedStyle(cs, 816, "indefinite");
    const child = createBlockBox(
      "child", 0, 0, 100, 50,
      cs.writingMode, cs.direction, cs, us,
      [], 100,
    );
    const page = createPageBox(
      "page-1",
      0, 100,                       // inlineOffset, blockOffset
      816, 1056,                    // inlineSize, blockSize
      cs.writingMode, cs.direction,
      cs, us,
      [child],                       // children
      1,                             // pageIndex
      816,                           // containingInlineSize
    );
    expect(page.type).toBe("page");
    expect(page.children).toHaveLength(1);
    expect(Object.isFrozen(page.children)).toBe(true);
    expect(Object.isFrozen(page.computedStyle)).toBe(true);
    expect(Object.isFrozen(page.usedStyle)).toBe(true);
  });

  it("maps LTR logical coords to physical (identity)", () => {
    const cs = INITIAL_COMPUTED_STYLE;
    const us = computeUsedStyle(cs, 816, "indefinite");
    const page = createPageBox(
      "page-ltr",
      0, 0,                         // inlineOffset, blockOffset
      816, 1056,                    // inlineSize, blockSize
      "horizontal-tb", "ltr",
      cs, us,
      [],
      0,
      816,
    );
    // LTR is identity mapping for horizontal-tb
    expect(page.x).toBe(0);
    expect(page.y).toBe(0);
    expect(page.width).toBe(816);
    expect(page.height).toBe(1056);
  });

  it("maps RTL logical coords to physical (inline-axis mirrored)", () => {
    const cs = INITIAL_COMPUTED_STYLE;
    const us = computeUsedStyle(cs, 816, "indefinite");
    const containingInlineSize = 816;
    const inlineOffset = 0;
    const inlineSize = 816;
    const page = createPageBox(
      "page-rtl",
      inlineOffset, 0,              // inlineOffset, blockOffset
      inlineSize, 1056,             // inlineSize, blockSize
      "horizontal-tb", "rtl",
      cs, us,
      [],
      0,
      containingInlineSize,
    );
    // RTL: inline-axis is mirrored
    const expectedX = containingInlineSize - inlineOffset - inlineSize;
    expect(page.x).toBe(expectedX);
    expect(page.y).toBe(0);
    expect(page.width).toBe(inlineSize);
    expect(page.height).toBe(1056);
  });
});
