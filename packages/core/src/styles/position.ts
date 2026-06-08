import type { Length } from "./length";

/**
 * CSS positioning scheme (CSS Positioned Layout 3 §2). `fixed` is kept in the
 * type for symmetry but is treated as `absolute` by layout (the engine paints
 * content-scrolling canvases, so there is no viewport to pin to).
 */
export type Position = "static" | "relative" | "absolute" | "fixed";

/**
 * A single 2D transform function (CSS Transforms 1 §3). The supported set is the
 * word-processor-relevant subset: translation, rotation, and uniform/non-uniform
 * scale. `tx`/`ty` are `Length` (px/percent/em — percent resolves against the
 * box's own size at paint time); `angleRad` is radians; `sx`/`sy` are unitless
 * scale factors.
 */
export type TransformFn =
  | { readonly fn: "translate";  readonly tx: Length; readonly ty: Length }
  | { readonly fn: "translateX"; readonly tx: Length }
  | { readonly fn: "translateY"; readonly ty: Length }
  | { readonly fn: "rotate";     readonly angleRad: number }
  | { readonly fn: "scale";      readonly sx: number; readonly sy: number };

/**
 * The transform origin (CSS Transforms 1 §6). `x`/`y` are `Length` (percent
 * resolves against the box's own width/height); the initial value is
 * 50%/50% (box center).
 */
export interface TransformOrigin {
  readonly x: Length;
  readonly y: Length;
}
