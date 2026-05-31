/**
 * DOM audit bug: the footnote separator rule never painted.
 *
 * `virtual-layout-tree` emits the slot's separator as a `block` LayoutBox
 * carrying `metadata.footnoteSeparator: true` (FOOTNOTE_SEPARATOR_HEIGHT tall,
 * full content width). The canvas-renderer's block branch handled `image` and
 * `horizontalLine` metadata but had NO `footnoteSeparator` case, so the rule
 * Google Docs draws above footnotes was invisible. These tests pin that paintBox
 * draws a short rule for such a box (LTR at the inline-start, RTL at the right).
 *
 * JSDOM has no CanvasRenderingContext2D — we use a spy-stub recording fillRect.
 */
import { describe, it, expect } from "vitest";
import { paintPage } from "./canvas-renderer";
import type { LayoutBox } from "@taleweaver/core";

interface FillRectCall { x: number; y: number; w: number; h: number; }
interface SpyCtx extends CanvasRenderingContext2D { _fillRects: FillRectCall[]; }

function createSpyCtx(width = 600, height = 800): SpyCtx {
  const fillRects: FillRectCall[] = [];
  const ctx: Partial<CanvasRenderingContext2D> & { _fillRects: FillRectCall[] } = {
    _fillRects: fillRects,
    canvas: { width, height } as HTMLCanvasElement,
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

const BASE_CS = {
  backgroundColor: "transparent",
  color: "black",
  fontFamily: "sans-serif",
  fontSize: 16,
  fontWeight: "normal",
  fontStyle: "normal",
  textDecoration: "none",
  borderBlockStartStyle: "none",
  borderBlockEndStyle: "none",
  borderInlineStartStyle: "none",
  borderInlineEndStyle: "none",
  borderBlockStartColor: "black",
  borderBlockEndColor: "black",
  borderInlineStartColor: "black",
  borderInlineEndColor: "black",
  direction: "ltr",
};
const BASE_US = {
  paddingBlockStart: 0, paddingBlockEnd: 0, paddingInlineStart: 0, paddingInlineEnd: 0,
  borderBlockStartWidth: 0, borderBlockEndWidth: 0, borderInlineStartWidth: 0, borderInlineEndWidth: 0,
  borderBlockStartStyle: "none", borderBlockEndStyle: "none", borderInlineStartStyle: "none", borderInlineEndStyle: "none",
  borderBlockStartColor: "black", borderBlockEndColor: "black", borderInlineStartColor: "black", borderInlineEndColor: "black",
  direction: "ltr", lineHeight: 20,
};

const SEP_HEIGHT = 13; // FOOTNOTE_SEPARATOR_HEIGHT
const SEP_Y = 700;
const SEP_WIDTH = 456;

function makeSeparator(direction: "ltr" | "rtl"): LayoutBox {
  return {
    type: "block",
    key: "footnote-sep-0",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: SEP_WIDTH, blockSize: SEP_HEIGHT,
    x: 0, y: SEP_Y, width: SEP_WIDTH, height: SEP_HEIGHT,
    writingMode: "horizontal-tb", direction,
    computedStyle: { ...BASE_CS, direction }, usedStyle: { ...BASE_US, direction },
    metadata: { footnoteSeparator: true },
    children: [],
  } as unknown as LayoutBox;
}

function makePage(child: LayoutBox): LayoutBox {
  return {
    type: "page",
    key: "page-0",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: 600, blockSize: 800,
    x: 0, y: 0, width: 600, height: 800,
    writingMode: "horizontal-tb", direction: "ltr",
    computedStyle: { ...BASE_CS }, usedStyle: { ...BASE_US },
    children: [child],
    pageIndex: 0,
    headerSlot: null,
    footerSlot: null,
  } as unknown as LayoutBox;
}

// The rule is short (capped at 144 = ~1.5in) and 1px tall — uniquely identifiable
// among any page-background / border fillRects (none here: transparent bg, 0 borders).
const isRule = (r: FillRectCall) => r.h === 1 && r.w === 144;

describe("footnote separator paints a short rule (DOM audit bug)", () => {
  it("LTR: draws the rule at the inline-start (left), at the box's vertical center", () => {
    const ctx = createSpyCtx();
    paintPage(ctx, makePage(makeSeparator("ltr")), [], null, "hidden");
    const rule = ctx._fillRects.find(isRule);
    expect(rule).toBeDefined();
    if (rule === undefined) throw new Error("footnote separator rule not painted");
    expect(rule.x).toBe(0);
    expect(rule.y).toBeCloseTo(SEP_Y + SEP_HEIGHT / 2 - 0.5);
  });

  it("RTL: anchors the rule at the inline-start (right edge)", () => {
    const ctx = createSpyCtx();
    paintPage(ctx, makePage(makeSeparator("rtl")), [], null, "hidden");
    const rule = ctx._fillRects.find(isRule);
    expect(rule).toBeDefined();
    if (rule === undefined) throw new Error("footnote separator rule not painted");
    expect(rule.x).toBe(SEP_WIDTH - 144);
  });
});
