/**
 * P5: paint `text-decoration: line-through` (strikethrough — a core Google Docs
 * feature, Ctrl+Shift+X). The canvas-renderer painted `underline` but had no
 * `line-through` branch, so the cascaded/used `textDecoration: "line-through"`
 * never rendered. These tests pin that a strike rule is now painted, positioned
 * ABOVE the underline (through the middle of the text), and that `none` paints
 * no decoration rule.
 *
 * Geometry is asserted RELATIVELY (strike y < underline y) to avoid coupling to
 * the exact half-leading math; the strike's existence + full-width 1px shape +
 * above-underline position are the load-bearing facts.
 */
import { describe, it, expect } from "vitest";
import { paintCanvas } from "./canvas-renderer";
import type { LayoutBox } from "@taleweaver/core";

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
  textDecoration: "none",
  direction: "ltr",
};
const BASE_US = {
  paddingBlockStart: 0, paddingBlockEnd: 0, paddingInlineStart: 0, paddingInlineEnd: 0,
  borderBlockStartWidth: 0, borderBlockEndWidth: 0, borderInlineStartWidth: 0, borderInlineEndWidth: 0,
  borderBlockStartStyle: "none", borderBlockEndStyle: "none", borderInlineStartStyle: "none", borderInlineEndStyle: "none",
  borderBlockStartColor: "black", borderBlockEndColor: "black", borderInlineStartColor: "black", borderInlineEndColor: "black",
  direction: "ltr", lineHeight: 20,
};

function makeRun(textDecoration: "none" | "underline" | "line-through"): LayoutBox {
  return {
    type: "text-run",
    key: "run",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: RUN_WIDTH, blockSize: 16,
    x: 0, y: 0, width: RUN_WIDTH, height: 16,
    writingMode: "horizontal-tb", direction: "ltr",
    text: "abc",
    computedStyle: { ...BASE_CS, textDecoration },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

function paint(box: LayoutBox): SpyCtx {
  const ctx = createSpyCtx();
  paintCanvas(ctx, box, [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
  return ctx;
}

// A decoration rule: 1px tall, full run width. (Transparent bg + zero borders ⇒
// no other fillRect competes.)
const decoRule = (r: FillRectCall) => r.h === 1 && r.w === RUN_WIDTH;

describe("text-decoration paint", () => {
  it("line-through paints a strike rule (was never painted)", () => {
    const strike = paint(makeRun("line-through"))._fillRects.find(decoRule);
    expect(strike).toBeDefined();
  });

  it("none paints no decoration rule", () => {
    const rule = paint(makeRun("none"))._fillRects.find(decoRule);
    expect(rule).toBeUndefined();
  });

  it("the strike sits ABOVE the underline (through the middle of the text)", () => {
    const strike = paint(makeRun("line-through"))._fillRects.find(decoRule);
    const underline = paint(makeRun("underline"))._fillRects.find(decoRule);
    expect(strike).toBeDefined();
    expect(underline).toBeDefined();
    if (strike === undefined || underline === undefined) throw new Error("missing rule");
    expect(strike.y).toBeLessThan(underline.y);
  });
});
