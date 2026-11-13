import type { LayoutBox } from "./layout-box";

/**
 * A float box: a block box carrying `float` (a block float, or a wrapped inline
 * image's box under its paragraph). Painters lift these into the float layer of
 * their stacking context (CSS 2.1 Appendix E step 4). Lines and runs copy their
 * block's style, so the box type is checked first.
 */
export function isFloatBox(box: LayoutBox): boolean {
  const f = box.computedStyle.float;
  return box.type === "block" && f !== undefined && f !== "none";
}
