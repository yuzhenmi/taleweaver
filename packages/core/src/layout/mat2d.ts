import type { Length } from "../styles/length";
import type { TransformFn, TransformOrigin } from "../styles/position";

/**
 * `Mat2D` — a 2×3 affine transform matrix (CSS Transforms 1 / canvas
 * `CanvasRenderingContext2D.transform`). Zero-dependency and pure, like the
 * bidi / line-break tables, so it can be shared by the paint pass (canvas) and
 * the hit-test pass (point inversion) with byte-identical math.
 *
 * The six components map a point `(x, y)` to `(x', y')` as:
 *
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 *
 * which is EXACTLY the convention of `ctx.transform(a, b, c, d, e, f)`
 * (column-major: `a`/`b` the x-basis, `c`/`d` the y-basis, `e`/`f` the
 * translation). Choosing this representation lets the painter's accumulated
 * matrix and the hit-test inverse be derived from the SAME builders, so paint
 * and hit-test never diverge.
 */
export interface Mat2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

/** The identity transform (maps every point to itself). */
export function identity(): Mat2D {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

/**
 * Compose two matrices: `compose(outer, inner)` returns the matrix that applies
 * `inner` FIRST then `outer` — i.e. `outer · inner` in standard matrix-multiply
 * order. This matches how the canvas accumulates transforms: each successive
 * `ctx.translate/rotate/scale` post-multiplies the current matrix, so a point is
 * transformed by the MOST-RECENTLY-applied op first. The painter accumulates
 * `ctx ∘ origin ∘ fn1 ∘ fn2 ∘ … ∘ −origin`; `fromTransformFns` builds the same
 * accumulation with `compose`, so the matrix it returns is identical to the
 * canvas's current transform after the equivalent `ctx` calls.
 */
export function compose(outer: Mat2D, inner: Mat2D): Mat2D {
  // [outer] · [inner], both 2×3 affine (implicit bottom row [0 0 1]).
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

/** A pure translation by `(tx, ty)`. */
export function translate(tx: number, ty: number): Mat2D {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

/**
 * A rotation by `angleRad` radians, clockwise in the canvas's
 * y-down coordinate system (matching `ctx.rotate`).
 */
export function rotate(angleRad: number): Mat2D {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** A scale by `(sx, sy)`. */
export function scale(sx: number, sy: number): Mat2D {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/**
 * Resolve a `Length` to px for transform-translation use. `px`/`em` (em is
 * already cascade-flattened to a numeric px at this point, but the symbolic
 * `{unit:"em"}` form is handled defensively) resolve directly; `percent`
 * resolves against `percentBasis` (the box's own width for tx, height for ty —
 * CSS Transforms 1 §6: translate percentages are relative to the box's own
 * border-box size). A bare `number` is px shorthand.
 */
function resolveTranslateLength(value: Length, percentBasis: number): number {
  if (typeof value === "number") return value;
  switch (value.unit) {
    case "px":
      return value.value;
    case "em":
      // em is cascade-flattened to px before reaching layout; defended here so
      // the resolver is total over the `Length` union without a non-null cast.
      return value.value;
    case "percent":
      return (value.value / 100) * percentBasis;
  }
}

/**
 * Build the cumulative transform matrix for a `transform` list applied ABOUT a
 * transform-origin, in the SAME accumulation order the canvas painter uses:
 *
 *   translate(originX, originY) ∘ fn1 ∘ fn2 ∘ … ∘ translate(−originX, −originY)
 *
 * The `fns` are composed in ARRAY order (the painter applies `ctx.translate/
 * rotate/scale` for each fn in array order; `compose(acc, fnMatrix)`
 * post-multiplies, exactly mirroring the canvas). `originX`/`originY` are the
 * transform-origin in the SAME coordinate frame the matrix operates in (for the
 * painter that is the box's absolute origin; for the hit-test thread the box's
 * accumulated absolute origin). `boxWidth`/`boxHeight` are the box's border-box
 * size, used to resolve any `percent` translate components (CSS Transforms 1 §6).
 *
 * Returns identity when `fns` is empty (the caller guards on `transform.length`
 * so this is a defensive total).
 */
export function fromTransformFns(
  fns: readonly TransformFn[],
  originX: number,
  originY: number,
  boxWidth: number,
  boxHeight: number,
): Mat2D {
  // Start at translate(origin), then post-multiply each fn (array order), then
  // post-multiply translate(−origin) so the transforms pivot about the origin.
  let m = translate(originX, originY);
  for (const fn of fns) {
    m = compose(m, transformFnMatrix(fn, boxWidth, boxHeight));
  }
  m = compose(m, translate(-originX, -originY));
  return m;
}

/** The matrix for a single `TransformFn`. */
function transformFnMatrix(fn: TransformFn, boxWidth: number, boxHeight: number): Mat2D {
  switch (fn.fn) {
    case "translate":
      return translate(
        resolveTranslateLength(fn.tx, boxWidth),
        resolveTranslateLength(fn.ty, boxHeight),
      );
    case "translateX":
      return translate(resolveTranslateLength(fn.tx, boxWidth), 0);
    case "translateY":
      return translate(0, resolveTranslateLength(fn.ty, boxHeight));
    case "rotate":
      return rotate(fn.angleRad);
    case "scale":
      return scale(fn.sx, fn.sy);
  }
}

/**
 * Resolve a `TransformOrigin` to an absolute `(x, y)` pair in the box's frame.
 * `percent` resolves against the box's own width/height (CSS Transforms 1 §6 —
 * `50% 50%` is the box center); `px`/`em` resolve directly. `boxX`/`boxY` are the
 * box's top-left in the target coordinate frame, so the returned origin is in the
 * SAME frame the matrix will operate in.
 */
export function resolveTransformOrigin(
  origin: TransformOrigin,
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number,
): { readonly x: number; readonly y: number } {
  return {
    x: boxX + resolveTranslateLength(origin.x, boxWidth),
    y: boxY + resolveTranslateLength(origin.y, boxHeight),
  };
}

/**
 * Invert a matrix, or `null` when it is singular (`det === 0`, e.g. `scale(0)`).
 * A singular transform collapses the box to zero area; the hit-test maps that
 * `null` to its `"singular"` sentinel and skips the (invisible) line.
 */
export function invert(m: Mat2D): Mat2D | null {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0) return null;
  const invDet = 1 / det;
  // Inverse of the 2×2 linear part, then the inverse translation.
  const a = m.d * invDet;
  const b = -m.b * invDet;
  const c = -m.c * invDet;
  const d = m.a * invDet;
  const e = -(a * m.e + c * m.f);
  const f = -(b * m.e + d * m.f);
  return { a, b, c, d, e, f };
}

/** Apply a matrix to a point, returning the transformed `(x, y)`. */
export function apply(m: Mat2D, x: number, y: number): { readonly x: number; readonly y: number } {
  return {
    x: m.a * x + m.c * y + m.e,
    y: m.b * x + m.d * y + m.f,
  };
}
