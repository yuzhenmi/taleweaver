/**
 * Footnote separator rule: REMOVED (user directive — deliberate deviation from
 * Google Docs). The layout no longer emits a `footnoteSeparator` box, and the
 * canvas-renderer no longer paints a rule even if one is present. These tests
 * pin that NO short rule is drawn for a `footnoteSeparator`-tagged block box.
 *
 * JSDOM has no CanvasRenderingContext2D — we use a spy-stub recording fillRect.
 */
import { describe, it, expect } from "vitest";
import { paintPage } from "./canvas-renderer";
import type { LayoutBox } from "./index";

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
  underline: false,
  lineThrough: false,
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
  direction: "ltr", lineHeight: 20, writingMode: "horizontal-tb",
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
    footnoteSlot: null,
  } as unknown as LayoutBox;
}

// The rule is short (capped at 144 = ~1.5in) and 1px tall — uniquely identifiable
// among any page-background / border fillRects (none here: transparent bg, 0 borders).
const isRule = (r: FillRectCall) => r.h === 1 && r.w === 144;

describe("footnote separator rule is NOT painted (removed by user directive)", () => {
  it("LTR: draws no short rule for a footnoteSeparator box", () => {
    const ctx = createSpyCtx();
    paintPage(ctx, makePage(makeSeparator("ltr")), [], [], [], [], null, "hidden");
    expect(ctx._fillRects.find(isRule)).toBeUndefined();
  });

  it("RTL: draws no short rule for a footnoteSeparator box", () => {
    const ctx = createSpyCtx();
    paintPage(ctx, makePage(makeSeparator("rtl")), [], [], [], [], null, "hidden");
    expect(ctx._fillRects.find(isRule)).toBeUndefined();
  });
});
