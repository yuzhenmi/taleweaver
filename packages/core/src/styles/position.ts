import type { Length } from "./length";
import type { ComputedStyle } from "./computed-style";

/**
 * CSS positioning scheme (CSS Positioned Layout 3 §2). `fixed` is intentionally
 * absent: viewport-anchored positioning is meaningless in a paginated document
 * (the engine paints content-scrolling canvases, so there is no viewport to pin
 * to). Per-page repeated content — running heads, watermarks — is the
 * page-template system's job, not CSS `fixed`.
 */
export type Position = "static" | "relative" | "absolute";

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

/**
 * Whether a box is a CSS stacking context (CSS 2.2 §9.9 / Positioned Layout 3).
 * Two-valued: `"self"` when the box establishes its own stacking context,
 * absent (`undefined`) otherwise — "none" is the field's absence (simpler than
 * a three-valued enum; the painter detects boundaries by reading children's
 * role). A stacking context paints ATOMICALLY (its whole subtree, its own §E.2
 * walk) at its z-position in the parent context.
 */
export type StackingContextRole = "self";

/**
 * Compute a box's `StackingContextRole` from its `ComputedStyle`. A box
 * establishes a stacking context (`"self"`) when ANY of these CSS triggers hold:
 *
 *   - it is POSITIONED (`position !== "static"`) AND has a non-`auto` `z-index`
 *     (CSS 2.2 §9.9.1 — `z-index` is ignored on a static box, so the position
 *     gate is load-bearing);
 *   - `opacity < 1` (CSS Color 4 / Compositing — an opacity group);
 *   - `transform` is non-empty (CSS Transforms 1 §6).
 *
 * The opacity and transform triggers are forward-compat for the opacity /
 * transform slices: their computed defaults (`1` / `[]`) make them inert today,
 * but including them keeps the predicate complete so those slices need no
 * change here. Returns `undefined` ("none") for the overwhelmingly common
 * unpositioned / auto-z / fully-opaque / untransformed box.
 */
export function computeStackingContextRole(
  cs: Readonly<ComputedStyle>,
): StackingContextRole | undefined {
  if (cs.position !== "static" && cs.zIndex !== "auto") return "self";
  if (cs.opacity < 1) return "self";
  if (cs.transform.length > 0) return "self";
  return undefined;
}
