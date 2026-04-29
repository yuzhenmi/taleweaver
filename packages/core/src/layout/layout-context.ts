import type { ComputedStyle, WritingMode, Direction } from "../styles";
import type { IntrinsicSizesCache } from "./intrinsic-sizes";
import { createIntrinsicSizesCache } from "./intrinsic-sizes";
import type { FloatEnvironment } from "./float-context";
import { createFloatEnvironment } from "./float-context";
import { establishesNewBFC } from "./bfc-establishment";
import type { IFCStateCache } from "./ifc-state";
import { createIFCStateCache } from "./ifc-state";

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
  /** Shared per-paragraph cache for IFC wrap state (tokens + lines), reused across the whole layout pass. */
  readonly ifcStateCache: IFCStateCache;
  /**
   * The nearest ancestor BFC's float environment. Floats are registered here
   * and siblings query it to wrap text around them.
   *
   * `makeRootContext` always creates a fresh `FloatEnvironment` (the root is
   * always a BFC root). `makeChildContext` creates a fresh env when the child
   * establishes a new BFC (`establishesNewBFC`), and inherits the parent's env
   * otherwise — so floats rise to the containing BFC.
   */
  readonly floatEnv: FloatEnvironment;
  /**
   * `true` when this context was created for a box that is a BFC root — i.e.
   * the `floatEnv` is owned exclusively by this box (not shared with the
   * parent). BFC roots must enclose their floats in their content height.
   *
   * Set by `makeRootContext` (always true) and by `makeChildContext` when
   * `establishesNewBFC(childCs)` is true.
   */
  readonly isBFCRoot: boolean;
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
  // If the child establishes a new BFC, give it a fresh float environment so
  // that floats inside it don't leak to the parent's BFC. Otherwise, inherit
  // the parent's env so that floats inside non-BFC blocks rise to the nearest
  // ancestor BFC.
  const isBFCRoot = establishesNewBFC(parentCs);
  const floatEnv = isBFCRoot
    ? createFloatEnvironment()
    : parent.floatEnv;

  return {
    writingMode: parentCs.writingMode,
    direction:   parentCs.direction,
    containingInlineSize: contentInlineSize,
    containingBlockSize:  contentBlockSize,
    intrinsicCache: parent.intrinsicCache,
    ifcStateCache: parent.ifcStateCache,
    floatEnv,
    isBFCRoot,
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
    ifcStateCache: createIFCStateCache(),
    // The document root is always a BFC root; it always gets a fresh float env.
    floatEnv: createFloatEnvironment(),
    isBFCRoot: true,
  };
}
