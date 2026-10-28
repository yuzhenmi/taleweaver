import type { Mat2D } from "@taleweaver/core";
import { apply, compose, invert } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-box";

/**
 * The ancestor clip of content that hangs past its line (a ¶ glyph, the ¶ selection
 * extension): a table cell's border box (never over a neighbouring cell), a column's
 * span widened to its neighbouring columns' near edges (it hangs freely into the gap),
 * the page box (it hangs into the margin, not past the page). One walk step shared by
 * the line index (`line-flatten.ts`) and the boundary-mark index, both built once per
 * layout.
 */

/** A clip region `[x0, x1) × [y0, y1)` in the content's own (pre-transform) frame. */
export interface Clip {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * The clip of an ancestor ABOVE a transform between it and the content, in its own
 * (pre-`frame`) coordinates: `frame` is the cumulative transform at that ancestor
 * (absent → identity), `inverse` its inverse.
 */
export interface OuterClip extends Clip {
  readonly frame?: Mat2D;
  readonly inverse?: Mat2D | "singular";
}

/**
 * The clip in effect inside a box: `clip` holds the ancestors' clips in the box's own
 * frame; `outer` the ones above a transform (empty when none lies between). A point is
 * visible iff it is inside `clip` and inside every outer clip mapped through its frame.
 */
export interface ClipState {
  readonly clip: Clip;
  readonly outer: readonly OuterClip[];
}

export const UNCLIPPED: Clip = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };

/** The state at a tree root that is not a page (nothing clips). */
export const ROOT_CLIP: ClipState = { clip: UNCLIPPED, outer: [] };

export const intersectClip = (a: Clip, b: Clip): Clip => ({
  x0: Math.max(a.x0, b.x0),
  y0: Math.max(a.y0, b.y0),
  x1: Math.min(a.x1, b.x1),
  y1: Math.min(a.y1, b.y1),
});

/** The state inside a page box (its slots and body): the page box clips. */
export function pageClip(page: { readonly width: number; readonly height: number }): ClipState {
  return { clip: { x0: 0, y0: 0, x1: page.width, y1: page.height }, outer: [] };
}

/**
 * The state for `box`'s children. `box` sits at (`x`, `y`) in the frame of
 * `cumulative` (its ancestors' transform); `child` is the cumulative transform its
 * children paint under (`transformAt`). A transform on `box` turns the clips gathered
 * so far into outer clips (they stay in the ancestors' frame); a table cell adds its
 * border box. Returns `s` itself when nothing changes (no allocation on the common path).
 */
export function childClip(
  box: LayoutBox,
  x: number,
  y: number,
  cumulative: Mat2D | undefined,
  child: Mat2D | undefined,
  s: ClipState,
): ClipState {
  let out = s;
  if (child !== cumulative && s.clip !== UNCLIPPED) {
    const inv = cumulative === undefined ? undefined : (invert(cumulative) ?? "singular");
    out = {
      clip: UNCLIPPED,
      outer: [...s.outer, { ...s.clip, ...(cumulative === undefined ? {} : { frame: cumulative }), ...(inv === undefined ? {} : { inverse: inv }) }],
    };
  }
  if (box.type !== "table-cell") return out;
  return { clip: intersectClip(out.clip, { x0: x, y0: y, x1: x + box.width, y1: y + box.height }), outer: out.outer };
}

/**
 * The state inside column `col` of a multi-column box at (`x`, `y`) (`s` = the
 * multi-column box's {@link childClip}): its own span widened to its neighbouring
 * columns' near edges. The outermost columns are bounded by the page only.
 */
export function columnClip(columns: readonly LayoutBox[], col: LayoutBox, x: number, y: number, s: ClipState): ClipState {
  let x0 = -Infinity;
  let x1 = Infinity;
  let y0 = -Infinity;
  let y1 = Infinity;
  for (const o of columns) {
    if (o === col) continue;
    if (o.x + o.width <= col.x) x0 = Math.max(x0, x + o.x + o.width);
    else if (o.x >= col.x + col.width) x1 = Math.min(x1, x + o.x);
    else if (o.y + o.height <= col.y) y0 = Math.max(y0, y + o.y + o.height);
    else if (o.y >= col.y + col.height) y1 = Math.min(y1, y + o.y);
  }
  return { clip: intersectClip(s.clip, { x0, y0, x1, y1 }), outer: s.outer };
}

/** True iff index-frame (post-transform) point (`x`, `y`) lies inside every outer clip. */
export function insideOuterClips(outer: readonly OuterClip[], x: number, y: number): boolean {
  for (const c of outer) {
    if (c.inverse === "singular") return false;
    const p = c.inverse === undefined ? { x, y } : apply(c.inverse, x, y);
    if (!(p.x >= c.x0 && p.x < c.x1 && p.y >= c.y0 && p.y < c.y1)) return false;
  }
  return true;
}

/** Clamp an unbounded clip edge so it maps through a matrix without NaN (∞ · 0). */
const finite = (v: number): number => Math.max(-1e7, Math.min(1e7, v));

/**
 * The region of `s` in the frame of content painted under the cumulative transform
 * whose inverse is `inverse` (absent → identity; `"singular"` → nothing is visible →
 * null): `s.clip` intersected with each outer clip mapped into that frame. An outer
 * clip maps to its bounding box there — exact for translate / scale / quarter-turn
 * transforms.
 * A rotated outer clip widens to its bounding box: selection rects are axis-aligned and
 * painted pre-transform (the transformed-selection gap, 2.4-positioning), so an exact
 * rotated clip has no rect to apply to until that geometry lands.
 */
export function clipInFrame(s: ClipState, inverse: Mat2D | "singular" | undefined): Clip | null {
  if (s.outer.length === 0) return s.clip;
  if (inverse === "singular") return null;
  let out = s.clip;
  for (const c of s.outer) {
    const m = c.frame === undefined ? inverse : inverse === undefined ? c.frame : compose(inverse, c.frame);
    if (m === undefined) {
      out = intersectClip(out, c);
      continue;
    }
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [x, y] of [[c.x0, c.y0], [c.x1, c.y0], [c.x0, c.y1], [c.x1, c.y1]] as const) {
      const p = apply(m, finite(x), finite(y));
      xs.push(p.x);
      ys.push(p.y);
    }
    out = intersectClip(out, { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
  }
  return out;
}
