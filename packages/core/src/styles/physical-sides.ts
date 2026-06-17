import type { UsedStyle } from "./used-style";
import type { BorderStyle } from "./style";
import type { Color } from "./color";
import type { WritingMode, Direction } from "./writing-mode";
import { assertNeverWritingMode } from "./writing-mode";

export interface PhysicalBorderSides {
  topWidth: number; rightWidth: number; bottomWidth: number; leftWidth: number;
  topStyle: BorderStyle; rightStyle: BorderStyle; bottomStyle: BorderStyle; leftStyle: BorderStyle;
  topColor: Color; rightColor: Color; bottomColor: Color; leftColor: Color;
  topPadding: number; rightPadding: number; bottomPadding: number; leftPadding: number;
}

type PhysicalSide = "top" | "right" | "bottom" | "left";

/**
 * The four logical sides resolved to physical sides for a given
 * (writingMode, direction). Consistent with `logicalToPhysical` in
 * `@taleweaver/core` (the source of truth for axis→physical mapping).
 */
interface LogicalSideMap {
  blockStart: PhysicalSide;
  blockEnd: PhysicalSide;
  inlineStart: PhysicalSide;
  inlineEnd: PhysicalSide;
}

/**
 * The minimal context `resolveLogicalSides` reads: the two axis-orienting
 * properties. Both `ComputedStyle` and `UsedStyle` structurally satisfy this,
 * so the one logical→physical-side mapper serves cascade-time (ComputedStyle)
 * and layout-time (UsedStyle) callers — no parallel clone.
 */
export interface LogicalSideContext {
  readonly writingMode: WritingMode;
  readonly direction: Direction;
}

/**
 * Map each logical side to its physical side, derived ONCE per box, agreeing
 * with `logicalToPhysical`:
 *   - block axis → physical side:
 *       horizontal-tb: block-start→top,   block-end→bottom
 *       vertical-rl:   block-start→right,  block-end→left   (blocks stack right→left)
 *       vertical-lr:   block-start→left,   block-end→right  (blocks stack left→right)
 *   - inline axis → physical side:
 *       horizontal-tb LTR: inline-start→left,   inline-end→right
 *       horizontal-tb RTL: inline-start→right,  inline-end→left
 *       vertical * LTR (inline runs top→bottom): inline-start→top,    inline-end→bottom
 *       vertical * RTL (inline runs bottom→top): inline-start→bottom, inline-end→top
 */
export function resolveLogicalSides(us: Readonly<LogicalSideContext>): LogicalSideMap {
  const isRtl = us.direction === "rtl";
  // Exhaustive over the WritingMode union: a future 4th mode makes the `default`
  // arm a compile error (#437), and an out-of-union value throws rather than
  // silently mapping as h-tb. h-tb stays byte-identical to the legacy path.
  switch (us.writingMode) {
    case "horizontal-tb":
      // block → top/bottom, inline → left/right (flipped under RTL).
      return {
        blockStart: "top",
        blockEnd: "bottom",
        inlineStart: isRtl ? "right" : "left",
        inlineEnd: isRtl ? "left" : "right",
      };
    case "vertical-rl":
    case "vertical-lr":
      // Vertical modes: inline axis → physical y (top/bottom), block axis →
      // physical x (left/right).
      return {
        // Blocks stack right→left (rl) or left→right (lr).
        blockStart: us.writingMode === "vertical-rl" ? "right" : "left",
        blockEnd: us.writingMode === "vertical-rl" ? "left" : "right",
        // Inline runs top→bottom (LTR) or bottom→top (RTL).
        inlineStart: isRtl ? "bottom" : "top",
        inlineEnd: isRtl ? "top" : "bottom",
      };
    default:
      return assertNeverWritingMode(us.writingMode);
  }
}

export function physicalBorderSides(us: Readonly<UsedStyle>): PhysicalBorderSides {
  const sides = resolveLogicalSides(us);

  // Per-physical-side accumulators. Defaults are the absent-side values that the
  // legacy h-tb code produced for the inline sides when not assigned; every
  // physical side is overwritten exactly once by the four logical assignments,
  // so the defaults only guard the type — they are never observed.
  const width: Record<PhysicalSide, number> = { top: 0, right: 0, bottom: 0, left: 0 };
  const style: Record<PhysicalSide, BorderStyle> = { top: "none", right: "none", bottom: "none", left: "none" };
  const color: Record<PhysicalSide, Color> = { top: "black", right: "black", bottom: "black", left: "black" };
  const padding: Record<PhysicalSide, number> = { top: 0, right: 0, bottom: 0, left: 0 };

  // Assign each logical field family to the physical side it maps to.
  width[sides.blockStart] = us.borderBlockStartWidth;
  width[sides.blockEnd] = us.borderBlockEndWidth;
  width[sides.inlineStart] = us.borderInlineStartWidth;
  width[sides.inlineEnd] = us.borderInlineEndWidth;

  style[sides.blockStart] = us.borderBlockStartStyle;
  style[sides.blockEnd] = us.borderBlockEndStyle;
  style[sides.inlineStart] = us.borderInlineStartStyle;
  style[sides.inlineEnd] = us.borderInlineEndStyle;

  color[sides.blockStart] = us.borderBlockStartColor;
  color[sides.blockEnd] = us.borderBlockEndColor;
  color[sides.inlineStart] = us.borderInlineStartColor;
  color[sides.inlineEnd] = us.borderInlineEndColor;

  padding[sides.blockStart] = us.paddingBlockStart;
  padding[sides.blockEnd] = us.paddingBlockEnd;
  padding[sides.inlineStart] = us.paddingInlineStart;
  padding[sides.inlineEnd] = us.paddingInlineEnd;

  return {
    topWidth: width.top, rightWidth: width.right, bottomWidth: width.bottom, leftWidth: width.left,
    topStyle: style.top, rightStyle: style.right, bottomStyle: style.bottom, leftStyle: style.left,
    topColor: color.top, rightColor: color.right, bottomColor: color.bottom, leftColor: color.left,
    topPadding: padding.top, rightPadding: padding.right, bottomPadding: padding.bottom, leftPadding: padding.left,
  };
}
