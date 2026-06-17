/**
 * POSITIONING slice 5 — `transform` paint application.
 *
 * A `transform`-bearing box paints under a saved canvas matrix: the painter does
 * `ctx.save()`, multiplies the box's transform (built about its transform-origin
 * via the SAME core `fromTransformFns` math the hit-test uses), paints the box +
 * descendants, then `ctx.restore()`. This test drives the real `paintCanvas` →
 * `paintBox` seam with a spy ctx that (a) records the save/transform/restore call
 * ORDER and (b) maintains a transform-matrix stack so a recorded `fillText`
 * reports the SCREEN-space (post-transform) glyph position — proving a translated
 * box's glyph lands at the shifted painted spot.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { paintCanvas } from "./canvas-renderer";
import type { TransformFn, TransformOrigin } from "@taleweaver/core";
import type { LayoutBox } from "./index";

// ── Canvas mock with a transform stack ───────────────────────────────────────
interface Mat { a: number; b: number; c: number; d: number; e: number; f: number; }
const ID: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
function mul(o: Mat, i: Mat): Mat {
  return {
    a: o.a * i.a + o.c * i.b,
    b: o.b * i.a + o.d * i.b,
    c: o.a * i.c + o.c * i.d,
    d: o.b * i.c + o.d * i.d,
    e: o.a * i.e + o.c * i.f + o.e,
    f: o.b * i.e + o.d * i.f + o.f,
  };
}
function applyPt(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

interface FillText { text: string; x: number; y: number; }

interface SpyCtx extends CanvasRenderingContext2D {
  _fills: FillText[];      // SCREEN-space glyph positions (matrix applied)
  _calls: string[];        // ordered save/transform/restore log
}

function createSpyCtx(width = 600, height = 800): SpyCtx {
  const fills: FillText[] = [];
  const calls: string[] = [];
  let cur: Mat = { ...ID };
  const stack: Mat[] = [];
  const ctx: Partial<CanvasRenderingContext2D> & { _fills: FillText[]; _calls: string[] } = {
    _fills: fills,
    _calls: calls,
    canvas: { width, height } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    save() { calls.push("save"); stack.push({ ...cur }); },
    restore() {
      calls.push("restore");
      const m = stack.pop();
      if (m !== undefined) cur = m;
    },
    transform(a: number, b: number, c: number, d: number, e: number, f: number) {
      calls.push("transform");
      cur = mul(cur, { a, b, c, d, e, f });
    },
    clearRect() { /* no-op */ },
    fillRect() { /* no-op */ },
    fillText(text: string, x: number, y: number) {
      const p = applyPt(cur, x, y);
      fills.push({ text, x: p.x, y: p.y });
    },
    measureText: (text: string) => ({ width: text.length * 8 } as TextMetrics),
  };
  return ctx as unknown as SpyCtx;
}

// ── LayoutBox helpers ────────────────────────────────────────────────────────
const BASE_CS = {
  backgroundColor: "transparent",
  color: "black",
  fontFamily: "sans-serif",
  fontSize: 16,
  fontWeight: "normal",
  fontStyle: "normal",
  underline: false,
  lineThrough: false,
  direction: "ltr",
  // Positioning defaults (slice-1 cascade defaults) so the box is well-formed.
  position: "static",
  transform: [] as readonly TransformFn[],
  transformOrigin: { x: { unit: "percent", value: 50 }, y: { unit: "percent", value: 50 } } as TransformOrigin,
  opacity: 1,
  zIndex: "auto",
};

const BASE_US = {
  paddingBlockStart: 0, paddingBlockEnd: 0,
  paddingInlineStart: 0, paddingInlineEnd: 0,
  borderBlockStartWidth: 0, borderBlockEndWidth: 0,
  borderInlineStartWidth: 0, borderInlineEndWidth: 0,
  borderBlockStartStyle: "none", borderBlockEndStyle: "none",
  borderInlineStartStyle: "none", borderInlineEndStyle: "none",
  borderBlockStartColor: "black", borderBlockEndColor: "black",
  borderInlineStartColor: "black", borderInlineEndColor: "black",
  direction: "ltr",
  lineHeight: 16,
  writingMode: "horizontal-tb",
};

function makeTextRun(opts: { text: string; x: number; y: number; width?: number; height?: number }): LayoutBox {
  const h = opts.height ?? 16;
  return {
    type: "text-run",
    key: `run-${opts.text}`,
    inlineOffset: 0, blockOffset: 0,
    inlineSize: opts.width ?? 16, blockSize: h,
    x: opts.x, y: opts.y,
    width: opts.width ?? 16, height: h,
    writingMode: "horizontal-tb", direction: "ltr",
    text: opts.text,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

function makeBlock(opts: {
  key: string;
  x: number; y: number; width: number; height: number;
  children: LayoutBox[];
  transform?: readonly TransformFn[];
  transformOrigin?: TransformOrigin;
}): LayoutBox {
  const cs = {
    ...BASE_CS,
    ...(opts.transform !== undefined ? { transform: opts.transform } : {}),
    ...(opts.transformOrigin !== undefined ? { transformOrigin: opts.transformOrigin } : {}),
  };
  return {
    type: "block",
    key: opts.key,
    inlineOffset: opts.x, blockOffset: opts.y,
    inlineSize: opts.width, blockSize: opts.height,
    x: opts.x, y: opts.y,
    width: opts.width, height: opts.height,
    writingMode: "horizontal-tb", direction: "ltr",
    children: opts.children,
    computedStyle: cs,
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

function paint(ctx: SpyCtx, box: LayoutBox): void {
  paintCanvas(ctx, box, [], [], [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
}

const TOP_LEFT_ORIGIN: TransformOrigin = {
  x: { unit: "px", value: 0 },
  y: { unit: "px", value: 0 },
};

describe("transform paint application", () => {
  let ctx: SpyCtx;
  beforeEach(() => { ctx = createSpyCtx(); });

  it("a translateX(40) box paints save → transform → restore, glyph shifted +40", () => {
    const run = makeTextRun({ text: "T", x: 0, y: 0 });
    const box = makeBlock({
      key: "tx", x: 10, y: 20, width: 100, height: 16,
      children: [run],
      transform: [{ fn: "translateX", tx: 40 }],
      transformOrigin: TOP_LEFT_ORIGIN,
    });
    const root = makeBlock({ key: "root", x: 0, y: 0, width: 200, height: 100, children: [box] });

    paint(ctx, root);

    // Order: a save precedes a transform precedes the eventual restore.
    const iSave = ctx._calls.indexOf("save");
    const iTransform = ctx._calls.indexOf("transform");
    const iRestore = ctx._calls.lastIndexOf("restore");
    expect(iSave).toBeGreaterThanOrEqual(0);
    expect(iTransform).toBeGreaterThan(iSave);
    expect(iRestore).toBeGreaterThan(iTransform);

    // The glyph: box-local (10, 20) for box origin + run.x(0) = (10, 20), then
    // translateX(40) → screen (50, 20). half-leading 0 (height==fontSize).
    const fill = ctx._fills.find((f) => f.text === "T");
    expect(fill).toBeDefined();
    expect(fill?.x).toBeCloseTo(50, 6);
    expect(fill?.y).toBeCloseTo(20, 6);
  });

  it("an untransformed box pushes NO save/transform/restore (zero overhead)", () => {
    const run = makeTextRun({ text: "P", x: 0, y: 0 });
    const box = makeBlock({ key: "plain", x: 5, y: 5, width: 100, height: 16, children: [run] });
    const root = makeBlock({ key: "root", x: 0, y: 0, width: 200, height: 100, children: [box] });

    paint(ctx, root);

    expect(ctx._calls).not.toContain("save");
    expect(ctx._calls).not.toContain("transform");
    expect(ctx._calls).not.toContain("restore");
    const fill = ctx._fills.find((f) => f.text === "P");
    expect(fill?.x).toBeCloseTo(5, 6);
    expect(fill?.y).toBeCloseTo(5, 6);
  });

  it("transformOrigin default = box CENTER: rotate 90° about the center", () => {
    // A 40×40 box at (0,0), glyph at its top-left (0,0). Rotating 90° clockwise
    // about the center (20,20): the top-left (0,0) maps to (40, 0).
    const run = makeTextRun({ text: "C", x: 0, y: 0 });
    const box = makeBlock({
      key: "rot", x: 0, y: 0, width: 40, height: 40,
      children: [run],
      transform: [{ fn: "rotate", angleRad: Math.PI / 2 }],
      // default transformOrigin (50%/50% from BASE_CS) = center.
    });
    const root = makeBlock({ key: "root", x: 0, y: 0, width: 200, height: 200, children: [box] });

    paint(ctx, root);

    const fill = ctx._fills.find((f) => f.text === "C");
    expect(fill).toBeDefined();
    expect(fill?.x).toBeCloseTo(40, 5);
    expect(fill?.y).toBeCloseTo(0, 5);
  });

  it("a transform LIST composes in ARRAY order (translateX(40) then scale(2))", () => {
    // origin top-left. Array order = canvas order: translateX(40), then scale(2,1).
    // A glyph at box-local (10, 0): scale → (20,0) → translateX(40) → (60, 0),
    // plus box origin (0,0). (Painter applies fns in array order; the matrix mirrors.)
    const run = makeTextRun({ text: "L", x: 10, y: 0 });
    const box = makeBlock({
      key: "list", x: 0, y: 0, width: 100, height: 16,
      children: [run],
      transform: [{ fn: "translateX", tx: 40 }, { fn: "scale", sx: 2, sy: 1 }],
      transformOrigin: TOP_LEFT_ORIGIN,
    });
    const root = makeBlock({ key: "root", x: 0, y: 0, width: 200, height: 100, children: [box] });

    paint(ctx, root);

    const fill = ctx._fills.find((f) => f.text === "L");
    expect(fill).toBeDefined();
    expect(fill?.x).toBeCloseTo(60, 5);
    expect(fill?.y).toBeCloseTo(0, 5);
  });

  it("nested transforms compose (outer translateX(100) ∘ inner translateX(10))", () => {
    const run = makeTextRun({ text: "N", x: 0, y: 0 });
    const inner = makeBlock({
      key: "inner", x: 0, y: 0, width: 50, height: 16, children: [run],
      transform: [{ fn: "translateX", tx: 10 }], transformOrigin: TOP_LEFT_ORIGIN,
    });
    const outer = makeBlock({
      key: "outer", x: 0, y: 0, width: 100, height: 16, children: [inner],
      transform: [{ fn: "translateX", tx: 100 }], transformOrigin: TOP_LEFT_ORIGIN,
    });
    const root = makeBlock({ key: "root", x: 0, y: 0, width: 400, height: 100, children: [outer] });

    paint(ctx, root);

    const fill = ctx._fills.find((f) => f.text === "N");
    expect(fill).toBeDefined();
    expect(fill?.x).toBeCloseTo(110, 6);  // 0 + 100 + 10
    expect(fill?.y).toBeCloseTo(0, 6);
  });
});
