import type { ComputedStyle, WritingMode, Direction } from "../styles";
import type { IntrinsicSizesCache } from "./intrinsic-sizes";
import { createIntrinsicSizesCache } from "./intrinsic-sizes";

/**
 * Layout context for a node being laid out. Carries the writing-mode,
 * direction, and containing-block sizes inherited from the parent.
 *
 * Each FC reads `ctx.writingMode` / `ctx.direction` for axis interpretation
 * and `ctx.containingInlineSize` for percent / shrink-to-fit resolution.
 *
 * When recursing into a child, build the child's context via
 * `makeChildContext(ctx, parentCs, contentInlineSize, contentBlockSize)`.
 */
export interface LayoutContext {
  readonly writingMode: WritingMode;
  readonly direction:   Direction;
  readonly containingInlineSize: number;
  readonly containingBlockSize:  number | "indefinite";
  /** Shared per-render-node cache for intrinsic sizes, reused across the whole layout pass. */
  readonly intrinsicCache: IntrinsicSizesCache;
}

/**
 * Build a layout context for a child being laid out within a parent box.
 *
 * @param parent the parent's layout context (the parent box's containing block).
 * @param parentCs the parent's computed style — provides writing-mode + direction
 *   for the child (CSS: writing-mode and direction are inherited).
 * @param contentInlineSize the parent's content area inline-size; the child's
 *   containing block has this as its inline-size.
 * @param contentBlockSize the parent's content area block-size, if known.
 *   Pass `"indefinite"` if the parent has auto block-size.
 */
export function makeChildContext(
  parent: LayoutContext,
  parentCs: ComputedStyle,
  contentInlineSize: number,
  contentBlockSize: number | "indefinite",
): LayoutContext {
  return {
    writingMode: parentCs.writingMode,
    direction:   parentCs.direction,
    containingInlineSize: contentInlineSize,
    containingBlockSize:  contentBlockSize,
    intrinsicCache: parent.intrinsicCache,
  };
}

/**
 * Build a layout context for the document root from its computed style.
 * The root has no parent, so `containingInlineSize` is the viewport / page
 * inline-size and `containingBlockSize` is `"indefinite"`.
 */
export function makeRootContext(
  rootCs: ComputedStyle,
  containerInlineSize: number,
): LayoutContext {
  return {
    writingMode: rootCs.writingMode,
    direction:   rootCs.direction,
    containingInlineSize: containerInlineSize,
    containingBlockSize:  "indefinite",
    intrinsicCache: createIntrinsicSizesCache(),
  };
}
