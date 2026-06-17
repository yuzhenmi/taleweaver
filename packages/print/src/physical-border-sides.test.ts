/**
 * P3.4 — `physicalBorderSides` writing-mode generalization.
 *
 * `physicalBorderSides` maps logical border/padding sides (block-start/end,
 * inline-start/end) to physical top/right/bottom/left. It MUST agree with
 * `logicalToPhysical` (core's source of truth) for every (writingMode,
 * direction) combo:
 *   - block axis → physical side:
 *       h-tb:        block-start→top,   block-end→bottom
 *       vertical-rl: block-start→RIGHT, block-end→LEFT   (blocks stack right→left)
 *       vertical-lr: block-start→LEFT,  block-end→RIGHT  (blocks stack left→right)
 *   - inline axis → physical side:
 *       h-tb LTR:    inline-start→left, inline-end→right
 *       h-tb RTL:    inline-start→right, inline-end→left
 *       vertical * LTR (inline runs top→bottom): inline-start→TOP, inline-end→BOTTOM
 *       vertical * RTL (inline runs bottom→top): inline-start→BOTTOM, inline-end→TOP
 *
 * Asymmetric logical widths (block-start=1, block-end=2, inline-start=3,
 * inline-end=4) make any transposed/mis-mapped side observable.
 */

import { describe, it, expect } from "vitest";
import type { WritingMode, Direction, UsedStyle } from "@taleweaver/core";
import { physicalBorderSides } from "@taleweaver/core";

/**
 * A UsedStyle with ASYMMETRIC logical border widths + matched padding, plus
 * distinguishable styles/colors on each logical side (so style/color mapping is
 * independently checkable). Everything irrelevant to border/padding is filled
 * with neutral values.
 */
function makeUsedStyle(writingMode: WritingMode, direction: Direction): UsedStyle {
  return {
    display: "block",
    writingMode,
    direction,
    boxSizing: "content-box",
    marginBlockStart: 0, marginBlockEnd: 0, marginInlineStart: 0, marginInlineEnd: 0,

    paddingBlockStart: 10, paddingBlockEnd: 20,
    paddingInlineStart: 30, paddingInlineEnd: 40,

    borderBlockStartWidth: 1, borderBlockEndWidth: 2,
    borderInlineStartWidth: 3, borderInlineEndWidth: 4,
    borderBlockStartStyle: "solid", borderBlockEndStyle: "dashed",
    borderInlineStartStyle: "dotted", borderInlineEndStyle: "none",
    borderBlockStartColor: "bs-color", borderBlockEndColor: "be-color",
    borderInlineStartColor: "is-color", borderInlineEndColor: "ie-color",

    backgroundColor: "transparent",
    fontFamily: "sans-serif", fontSize: 16, fontWeight: "normal", fontStyle: "normal",
    underline: false, lineThrough: false, lineHeight: 20, color: "black",
    whiteSpace: "normal", verticalAlign: "baseline",
    textAlign: "start", textIndent: 0, textWrap: "wrap", hyphens: "none",
    language: "", hyphenateLimitChars: [5, 2, 2],
    overflowWrap: "normal",
    letterSpacing: "normal", wordSpacing: "normal", textTransform: "none",
    fontFeatureSettings: [], tabStops: [], defaultTabStop: 48,
    float: "none", clear: "none",
    breakBefore: "auto", breakAfter: "auto", breakInside: "auto",
    widows: 2, orphans: 2,
    listStyleType: "disc", listStylePosition: "outside",
  };
}

describe("physicalBorderSides — writing-mode generalization (P3.4)", () => {
  // ── Width mapping table across all six (writingMode, direction) combos ──────
  // Each row asserts the four physical widths. block-start=1/block-end=2,
  // inline-start=3/inline-end=4. A transposed side is caught by the asymmetry.
  const cases: ReadonlyArray<{
    name: string;
    writingMode: WritingMode;
    direction: Direction;
    top: number; right: number; bottom: number; left: number;
  }> = [
    // h-tb LTR: block→top/bottom, inline-start→left, inline-end→right (current behavior, byte-identical).
    { name: "h-tb LTR", writingMode: "horizontal-tb", direction: "ltr", top: 1, bottom: 2, left: 3, right: 4 },
    // h-tb RTL: inline flips → inline-start→right, inline-end→left.
    { name: "h-tb RTL", writingMode: "horizontal-tb", direction: "rtl", top: 1, bottom: 2, right: 3, left: 4 },
    // vertical-rl LTR: block-start→right, block-end→left; inline-start→top, inline-end→bottom.
    { name: "vertical-rl LTR", writingMode: "vertical-rl", direction: "ltr", right: 1, left: 2, top: 3, bottom: 4 },
    // vertical-lr LTR: block-start→left, block-end→right; inline-start→top, inline-end→bottom.
    { name: "vertical-lr LTR", writingMode: "vertical-lr", direction: "ltr", left: 1, right: 2, top: 3, bottom: 4 },
    // vertical-rl RTL: block-start→right, block-end→left; inline-start→bottom, inline-end→top.
    { name: "vertical-rl RTL", writingMode: "vertical-rl", direction: "rtl", right: 1, left: 2, bottom: 3, top: 4 },
    // vertical-lr RTL: block-start→left, block-end→right; inline-start→bottom, inline-end→top.
    { name: "vertical-lr RTL", writingMode: "vertical-lr", direction: "rtl", left: 1, right: 2, bottom: 3, top: 4 },
  ];

  for (const c of cases) {
    it(`${c.name}: width sides map per logicalToPhysical`, () => {
      const sides = physicalBorderSides(makeUsedStyle(c.writingMode, c.direction));
      expect(sides.topWidth).toBe(c.top);
      expect(sides.rightWidth).toBe(c.right);
      expect(sides.bottomWidth).toBe(c.bottom);
      expect(sides.leftWidth).toBe(c.left);
    });
  }

  // ── Style/Color/Padding map the SAME way as width (spot-check on a vertical
  //    combo where every side differs from h-tb). vertical-rl RTL exercises both
  //    the block mirror (right/left) and the inline RTL flip (bottom/top). ──────
  it("vertical-rl RTL: style/color/padding map identically to width", () => {
    const sides = physicalBorderSides(makeUsedStyle("vertical-rl", "rtl"));

    // block-start (solid/bs-color/pad10) → right; block-end (dashed/be-color/pad20) → left.
    expect(sides.rightStyle).toBe("solid");
    expect(sides.leftStyle).toBe("dashed");
    expect(sides.rightColor).toBe("bs-color");
    expect(sides.leftColor).toBe("be-color");
    expect(sides.rightPadding).toBe(10);
    expect(sides.leftPadding).toBe(20);

    // inline-start (dotted/is-color/pad30) → bottom; inline-end (none/ie-color/pad40) → top.
    expect(sides.bottomStyle).toBe("dotted");
    expect(sides.topStyle).toBe("none");
    expect(sides.bottomColor).toBe("is-color");
    expect(sides.topColor).toBe("ie-color");
    expect(sides.bottomPadding).toBe(30);
    expect(sides.topPadding).toBe(40);
  });

  // ── h-tb LTR full record stays byte-identical to the legacy mapping. ─────────
  it("h-tb LTR: full record byte-identical to legacy mapping", () => {
    const sides = physicalBorderSides(makeUsedStyle("horizontal-tb", "ltr"));
    expect(sides).toEqual({
      topWidth: 1, rightWidth: 4, bottomWidth: 2, leftWidth: 3,
      topStyle: "solid", rightStyle: "none", bottomStyle: "dashed", leftStyle: "dotted",
      topColor: "bs-color", rightColor: "ie-color", bottomColor: "be-color", leftColor: "is-color",
      topPadding: 10, rightPadding: 40, bottomPadding: 20, leftPadding: 30,
    });
  });

  // ── #437 exhaustiveness guard: an out-of-union writing mode (reachable only via
  //    a cast) throws instead of silently falling through to the h-tb mapping.
  //    Discriminating: before #437 the residual fall-through treated it as h-tb. ──
  it("throws on an out-of-union writing mode (exhaustiveness guard)", () => {
    const us = makeUsedStyle("sideways-rl" as unknown as WritingMode, "ltr");
    expect(() => physicalBorderSides(us)).toThrow(/Unhandled writing mode/);
  });
});
