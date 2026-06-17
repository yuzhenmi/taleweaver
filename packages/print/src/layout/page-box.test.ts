import { describe, it, expect } from "vitest";
import { createPageBox } from "./page-box";
import { createBlockBox } from "./layout-box";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
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
      null, null, null,              // headerSlot, footerSlot, footnoteSlot
      96, 96,                        // effectiveTopInset, effectiveBottomInset
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
      null, null, null,              // headerSlot, footerSlot, footnoteSlot
      96, 96,                        // effectiveTopInset, effectiveBottomInset
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
      null, null, null,              // headerSlot, footerSlot, footnoteSlot
      96, 96,                        // effectiveTopInset, effectiveBottomInset
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
      null, null, null,              // headerSlot, footerSlot, footnoteSlot
      96, 96,                        // effectiveTopInset, effectiveBottomInset
    );
    // RTL: inline-axis is mirrored
    const expectedX = containingInlineSize - inlineOffset - inlineSize;
    expect(page.x).toBe(expectedX);
    expect(page.y).toBe(0);
    expect(page.width).toBe(inlineSize);
    expect(page.height).toBe(1056);
  });

  it("defaults headerSlot/footerSlot to null when passed null", () => {
    const cs = INITIAL_COMPUTED_STYLE;
    const us = computeUsedStyle(cs, 816, "indefinite");
    const page = createPageBox(
      "page-null-slots",
      0, 0,
      816, 1056,
      cs.writingMode, cs.direction,
      cs, us,
      [],
      0,
      816,
      null, null, null,              // headerSlot, footerSlot, footnoteSlot
      96, 96,                        // effectiveTopInset, effectiveBottomInset
    );
    expect(page.headerSlot).toBeNull();
    expect(page.footerSlot).toBeNull();
    // Slots are not promoted into children — they're distinct named fields.
    expect(page.children).toHaveLength(0);
  });

  it("stores the headerSlot/footerSlot BlockBoxes passed to it", () => {
    const cs = INITIAL_COMPUTED_STYLE;
    const us = computeUsedStyle(cs, 816, "indefinite");
    const header = createBlockBox(
      "header-body", 0, 0, 816, 36,
      cs.writingMode, cs.direction, cs, us,
      [], 816,
    );
    const footer = createBlockBox(
      "footer-body", 0, 1020, 816, 36,
      cs.writingMode, cs.direction, cs, us,
      [], 816,
    );
    const page = createPageBox(
      "page-slots",
      0, 0,
      816, 1056,
      cs.writingMode, cs.direction,
      cs, us,
      [],
      0,
      816,
      header, footer, null,          // headerSlot, footerSlot, footnoteSlot
      96, 96,                        // effectiveTopInset, effectiveBottomInset
    );
    expect(page.headerSlot).toBe(header);
    expect(page.footerSlot).toBe(footer);
    // Named slots are kept out of children (paint/line-collection treat them distinctly).
    expect(page.children).toHaveLength(0);
    // Slots are covered by the page's own freeze.
    expect(Object.isFrozen(page)).toBe(true);
  });

  it("round-trips the effectiveTopInset/effectiveBottomInset region edges (#332)", () => {
    const cs = INITIAL_COMPUTED_STYLE;
    const us = computeUsedStyle(cs, 816, "indefinite");
    const page = createPageBox(
      "page-insets",
      0, 0,
      816, 1056,
      cs.writingMode, cs.direction,
      cs, us,
      [],
      0,
      816,
      null, null, null,              // headerSlot, footerSlot, footnoteSlot
      72, 48,                        // effectiveTopInset, effectiveBottomInset
    );
    // The body content area is page-local [effectiveTopInset, blockSize − effectiveBottomInset].
    expect(page.effectiveTopInset).toBe(72);
    expect(page.effectiveBottomInset).toBe(48);
    expect(page.blockSize - page.effectiveBottomInset).toBe(1056 - 48);
  });
});
