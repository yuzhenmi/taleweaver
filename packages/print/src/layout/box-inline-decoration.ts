import type { UsedStyle } from "@taleweaver/core";

type InlineBoxModel = Pick<
  UsedStyle,
  "boxSizing" | "borderInlineStartWidth" | "paddingInlineStart" | "paddingInlineEnd" | "borderInlineEndWidth"
>;

/**
 * The content edge's inline offset in the box's own border-box frame: its
 * inline-start border + padding (CSS 2.1 §8). Its children (lines, blocks,
 * floats, markers) are positioned from here.
 */
export function contentInlineStart(us: InlineBoxModel): number {
  return us.borderInlineStartWidth + us.paddingInlineStart;
}

/** Border box − content box on the inline axis: both borders and both paddings. */
export function inlineDecoration(us: InlineBoxModel): number {
  return us.borderInlineStartWidth + us.paddingInlineStart + us.paddingInlineEnd + us.borderInlineEndWidth;
}

/**
 * A specified inline size as the box's border-box size (css-box-sizing §3):
 * under `content-box` the number is the content width, so the padding and
 * borders add to it; under `border-box` it already includes them.
 */
export function borderBoxInlineSize(specified: number, us: InlineBoxModel): number {
  return us.boxSizing === "border-box" ? specified : specified + inlineDecoration(us);
}
