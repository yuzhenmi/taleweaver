/**
 * P5 / #393: paint text decorations as an independent-flag set. A run carries
 * two booleans — `underline` and `lineThrough` (CSS text-decoration-line ∋
 * underline / line-through) — and the canvas-renderer paints each independently
 * with two separate `if`s (NOT mutually-exclusive). These tests pin: underline
 * draws a rule below the baseline; line-through draws a rule ABOVE the underline
 * (through the middle of the text); BOTH flags draw BOTH rules at once (Google
 * Docs parity); neither flag draws nothing.
 *
 * Geometry is asserted RELATIVELY (strike y < underline y) to avoid coupling to
 * the exact half-leading math; the strike's existence + full-width 1px shape +
 * above-underline position are the load-bearing facts.
 */
import { describe, it, expect } from "vitest";
import { paintCanvas } from "./canvas-renderer";
import type { LayoutBox } from "./index";

interface FillRectCall { x: number; y: number; w: number; h: number; }
interface SpyCtx extends CanvasRenderingContext2D { _fillRects: FillRectCall[]; }

function createSpyCtx(): SpyCtx {
  const fillRects: FillRectCall[] = [];
  const ctx: Partial<CanvasRenderingContext2D> & { _fillRects: FillRectCall[] } = {
    _fillRects: fillRects,
    canvas: { width: 600, height: 800 } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    clearRect() { /* no-op */ },
    fillRect(x: number, y: number, w: number, h: number) {
      fillRects.push({ x, y, w, h });
    },
    fillText() { /* no-op */ },
    measureText: (t: string) => ({ width: t.length * 8 } as TextMetrics),
  };
  return ctx as unknown as SpyCtx;
}

const RUN_WIDTH = 100;
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
};
const BASE_US = {
  paddingBlockStart: 0, paddingBlockEnd: 0, paddingInlineStart: 0, paddingInlineEnd: 0,
  borderBlockStartWidth: 0, borderBlockEndWidth: 0, borderInlineStartWidth: 0, borderInlineEndWidth: 0,
  borderBlockStartStyle: "none", borderBlockEndStyle: "none", borderInlineStartStyle: "none", borderInlineEndStyle: "none",
  borderBlockStartColor: "black", borderBlockEndColor: "black", borderInlineStartColor: "black", borderInlineEndColor: "black",
  direction: "ltr", lineHeight: 20, writingMode: "horizontal-tb",
};

function makeRun(deco: { underline?: boolean; lineThrough?: boolean }): LayoutBox {
  return {
    type: "text-run",
    key: "run",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: RUN_WIDTH, blockSize: 16,
    x: 0, y: 0, width: RUN_WIDTH, height: 16,
    writingMode: "horizontal-tb", direction: "ltr",
    text: "abc",
    computedStyle: {
      ...BASE_CS,
      underline: deco.underline ?? false,
      lineThrough: deco.lineThrough ?? false,
    },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

function paint(box: LayoutBox): SpyCtx {
  const ctx = createSpyCtx();
  paintCanvas(ctx, box, [], [], [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
  return ctx;
}

// A decoration rule: 1px tall, full run width. (Transparent bg + zero borders ⇒
// no other fillRect competes.)
const decoRule = (r: FillRectCall) => r.h === 1 && r.w === RUN_WIDTH;

describe("text-decoration paint", () => {
  it("line-through paints exactly one strike rule", () => {
    const rules = paint(makeRun({ lineThrough: true }))._fillRects.filter(decoRule);
    expect(rules).toHaveLength(1);
  });

  it("underline paints exactly one rule", () => {
    const rules = paint(makeRun({ underline: true }))._fillRects.filter(decoRule);
    expect(rules).toHaveLength(1);
  });

  it("neither flag paints no decoration rule", () => {
    const rule = paint(makeRun({}))._fillRects.find(decoRule);
    expect(rule).toBeUndefined();
  });

  it("the strike sits ABOVE the underline (through the middle of the text)", () => {
    const strike = paint(makeRun({ lineThrough: true }))._fillRects.find(decoRule);
    const underline = paint(makeRun({ underline: true }))._fillRects.find(decoRule);
    expect(strike).toBeDefined();
    expect(underline).toBeDefined();
    if (strike === undefined || underline === undefined) throw new Error("missing rule");
    expect(strike.y).toBeLessThan(underline.y);
  });

  it("#393: underline + lineThrough paints BOTH rules at once", () => {
    // The two flags are independent (Google Docs / CSS text-decoration-line is a
    // SET). RED before #393: the renderer used `if … else if`, so a run carrying
    // both decorations only ever drew one. Now two separate `if`s draw both.
    const rules = paint(makeRun({ underline: true, lineThrough: true }))._fillRects.filter(decoRule);
    expect(rules).toHaveLength(2);
    // And they sit at distinct y's: the strike (mid-em) above the underline.
    const ys = rules.map((r) => r.y).sort((a, b) => a - b);
    const [y0, y1] = ys;
    if (y0 === undefined || y1 === undefined) throw new Error("expected two decoration y's");
    expect(y0).toBeLessThan(y1);
  });
});
