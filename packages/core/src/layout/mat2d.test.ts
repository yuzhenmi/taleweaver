import { describe, it, expect } from "vitest";
import {
  identity,
  compose,
  translate,
  rotate,
  scale,
  invert,
  apply,
  fromTransformFns,
  resolveTransformOrigin,
  type Mat2D,
} from "./mat2d";
import type { TransformFn } from "../styles/position";

const approx = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-9): void => {
  expect(Math.abs(a.x - b.x)).toBeLessThan(eps);
  expect(Math.abs(a.y - b.y)).toBeLessThan(eps);
};

describe("Mat2D", () => {
  it("identity maps every point to itself", () => {
    const m = identity();
    approx(apply(m, 3, 7), { x: 3, y: 7 });
    approx(apply(m, -2.5, 0), { x: -2.5, y: 0 });
  });

  it("translate shifts a point by (tx, ty)", () => {
    const m = translate(10, -4);
    approx(apply(m, 0, 0), { x: 10, y: -4 });
    approx(apply(m, 5, 5), { x: 15, y: 1 });
  });

  it("rotate(90°) maps (1,0)→(0,1) in y-down canvas coords", () => {
    const m = rotate(Math.PI / 2);
    approx(apply(m, 1, 0), { x: 0, y: 1 });
    approx(apply(m, 0, 1), { x: -1, y: 0 });
  });

  it("scale multiplies each axis", () => {
    const m = scale(2, 3);
    approx(apply(m, 4, 5), { x: 8, y: 15 });
  });

  it("compose applies inner first then outer (matrix-multiply order)", () => {
    // inner: translate(10, 0); outer: scale(2, 2).
    // A point (0,0) → inner → (10,0) → outer → (20,0).
    const m = compose(scale(2, 2), translate(10, 0));
    approx(apply(m, 0, 0), { x: 20, y: 0 });
    // Reversing order changes the result: scale first, then translate.
    const m2 = compose(translate(10, 0), scale(2, 2));
    approx(apply(m2, 0, 0), { x: 10, y: 0 });
    approx(apply(m2, 5, 5), { x: 20, y: 10 });
  });

  it("invert round-trips a non-singular matrix", () => {
    const m = compose(compose(translate(30, 12), rotate(0.7)), scale(1.5, 2.25));
    const inv = invert(m);
    expect(inv).not.toBeNull();
    if (inv === null) return;
    const p = { x: 9, y: -4 };
    const fwd = apply(m, p.x, p.y);
    approx(apply(inv, fwd.x, fwd.y), p);
  });

  it("invert returns null for a singular matrix (scale 0)", () => {
    expect(invert(scale(0, 1))).toBeNull();
    expect(invert(scale(1, 0))).toBeNull();
    expect(invert(scale(0, 0))).toBeNull();
  });

  it("fromTransformFns composes about a non-zero origin (rotate about box center)", () => {
    // A 100×100 box at the origin, rotate 90° about its center (50, 50).
    const fns: TransformFn[] = [{ fn: "rotate", angleRad: Math.PI / 2 }];
    const origin = resolveTransformOrigin(
      { x: { unit: "percent", value: 50 }, y: { unit: "percent", value: 50 } },
      0, 0, 100, 100,
    );
    expect(origin).toEqual({ x: 50, y: 50 });
    const m = fromTransformFns(fns, origin.x, origin.y, 100, 100);
    // The center is a fixed point of a rotation about itself.
    approx(apply(m, 50, 50), { x: 50, y: 50 });
    // Top-left (0,0) rotates 90° clockwise about (50,50) → (100, 0).
    approx(apply(m, 0, 0), { x: 100, y: 0 });
  });

  it("fromTransformFns applies fns in ARRAY order", () => {
    // translateX(40) then scale(2): a point at box-local (0,0) with origin (0,0).
    // Array order = canvas order: ctx.translate(40,0) then ctx.scale(2,1).
    // Point (10,0) → scale → (20,0) → translate → (60,0).
    const fns: TransformFn[] = [
      { fn: "translateX", tx: 40 },
      { fn: "scale", sx: 2, sy: 1 },
    ];
    const m = fromTransformFns(fns, 0, 0, 100, 100);
    approx(apply(m, 10, 0), { x: 60, y: 0 });
  });

  it("fromTransformFns translateX(40) with origin shifts a point right by 40", () => {
    const fns: TransformFn[] = [{ fn: "translateX", tx: 40 }];
    const m = fromTransformFns(fns, 0, 0, 100, 50);
    approx(apply(m, 5, 5), { x: 45, y: 5 });
  });

  it("resolveTransformOrigin resolves px directly and offsets by box origin", () => {
    const o = resolveTransformOrigin(
      { x: { unit: "px", value: 10 }, y: 20 },
      100, 200, 80, 80,
    );
    expect(o).toEqual({ x: 110, y: 220 });
  });

  it("percent translate resolves against the box's own size", () => {
    const fns: TransformFn[] = [{ fn: "translate", tx: { unit: "percent", value: 50 }, ty: { unit: "percent", value: 100 } }];
    const m: Mat2D = fromTransformFns(fns, 0, 0, 200, 40);
    // tx = 50% of 200 = 100; ty = 100% of 40 = 40.
    approx(apply(m, 0, 0), { x: 100, y: 40 });
  });
});
