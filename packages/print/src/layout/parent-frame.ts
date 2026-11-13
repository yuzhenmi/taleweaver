import type { Direction } from "@taleweaver/core";
import type { LayoutContext } from "./layout-context";

/**
 * The frame a box is positioned in: its parent's BORDER box (Blink's
 * `ConvertToPhysical(parentWM, parentDir, parent border-box size, …)`). A box's
 * logical offsets run from the parent's border-box inline-start edge in the
 * parent's direction; its physical inline coordinate mirrors against the
 * parent's border-box inline size. The box's own direction only lays out its
 * content (CSS 2.1 §10.3.3: a block sits at its containing block's start).
 */
export interface ParentFrame {
  readonly direction: Direction;
  readonly inlineSize: number;
}

/** A root box's frame: the area it is laid out in, in its own direction. */
export function rootFrame(ctx: LayoutContext): ParentFrame {
  return { direction: ctx.direction, inlineSize: ctx.containingInlineSize };
}

/**
 * The frame of a page's children — body (or multicol box), header / footer /
 * footnote slots: the page box. Every page child is placed through it, so its
 * logical inline offset (the page's inline-start margin) mirrors in RTL.
 */
export function pageFrame(direction: Direction, pageInlineSize: number): ParentFrame {
  return { direction, inlineSize: pageInlineSize };
}
