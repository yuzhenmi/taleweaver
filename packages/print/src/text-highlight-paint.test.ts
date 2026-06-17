/**
 * P5/HL: paint highlight color (text background color — a core Google Docs
 * feature, the sibling of text color). The canvas-renderer painted
 * `backgroundColor` for the `block` branch but NOT for the `text-run` branch,
 * so a cascaded/used `backgroundColor` on a run never rendered. These tests pin
 * that a highlight rect is now painted BEHIND the glyphs at full run width ×
 * line height (distinct from the 1px text-decoration rules), in the highlight
 * color, and that `transparent` / undefined paints no such rect.
 */
import { describe, it, expect } from "vitest";
import { paintCanvas } from "./canvas-renderer";
import type { LayoutBox } from "./index";

interface FillRectCall { x: number; y: number; w: number; h: number; fillStyle: string; }
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
    fillRect(this: { fillStyle: string }, x: number, y: number, w: number, h: number) {
      fillRects.push({ x, y, w, h, fillStyle: this.fillStyle });
    },
    fillText() { /* no-op */ },
    measureText: (t: string) => ({ width: t.length * 8 } as TextMetrics),
  };
  return ctx as unknown as SpyCtx;
}

const RUN_WIDTH = 100;
const RUN_HEIGHT = 16;
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

function makeRun(backgroundColor: string): LayoutBox {
  return {
    type: "text-run",
    key: "run",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: RUN_WIDTH, blockSize: RUN_HEIGHT,
    x: 0, y: 0, width: RUN_WIDTH, height: RUN_HEIGHT,
    writingMode: "horizontal-tb", direction: "ltr",
    text: "abc",
    computedStyle: { ...BASE_CS, backgroundColor },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

function paint(box: LayoutBox): SpyCtx {
  const ctx = createSpyCtx();
  paintCanvas(ctx, box, [], [], [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
  return ctx;
}

// A highlight rect: full run width × full line height (distinct from the 1px
// decoration rules). Zero borders ⇒ no other full-height fillRect competes.
const highlightRect = (r: FillRectCall) => r.w === RUN_WIDTH && r.h === RUN_HEIGHT;

describe("text-run highlight (backgroundColor) paint", () => {
  it("paints a full-width, full-height highlight rect in the highlight color", () => {
    const rect = paint(makeRun("#ffff00"))._fillRects.find(highlightRect);
    expect(rect).toBeDefined();
    if (rect === undefined) throw new Error("missing highlight rect");
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.fillStyle).toBe("#ffff00");
  });

  it("transparent backgroundColor paints no highlight rect", () => {
    const rect = paint(makeRun("transparent"))._fillRects.find(highlightRect);
    expect(rect).toBeUndefined();
  });
});
