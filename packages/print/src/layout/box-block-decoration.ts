import type { UsedStyle } from "@taleweaver/core";

type BlockBoxModel = Pick<
  UsedStyle,
  "boxSizing" | "borderBlockStartWidth" | "paddingBlockStart" | "paddingBlockEnd" | "borderBlockEndWidth"
>;

/**
 * The content edge's block offset in the box's own border-box frame: its
 * block-start border + padding (CSS 2.1 §8). Its first child starts here.
 */
export function contentBlockStart(us: BlockBoxModel): number {
  return us.borderBlockStartWidth + us.paddingBlockStart;
}

/** What the box adds after its content on the block axis: end padding + end border. */
export function blockEndDecoration(us: BlockBoxModel): number {
  return us.paddingBlockEnd + us.borderBlockEndWidth;
}

/**
 * A specified block size as the box's border-box size (css-box-sizing §3):
 * under `content-box` the number is the content height, so the padding and
 * borders add to it; under `border-box` it already includes them, and the
 * content is floored at 0 (never smaller than the padding + borders).
 */
export function borderBoxBlockSize(specified: number, us: BlockBoxModel): number {
  const deco = contentBlockStart(us) + blockEndDecoration(us);
  return us.boxSizing === "border-box" ? Math.max(specified, deco) : specified + deco;
}
