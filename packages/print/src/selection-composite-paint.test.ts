/**
 * #397: the translucent selection tint must composite OVER content backgrounds
 * (text-run highlights from SET_HIGHLIGHT, block background colors) and UNDER
 * the text glyphs — matching Google Docs / the browser.
 *
 * The renderer paints in two phases: a BACKGROUND walk (highlights, block
 * backgrounds, borders, images) → the selection rects → a FOREGROUND walk
 * (glyphs, text decorations) → the cursor. These tests pin the paint ORDER by
 * recording the canvas op stream (fillRect + fillText) and asserting:
 *   highlight fillRect  <  selection fillRect  <  glyph fillText.
 *
 * Before the fix, the selection rect was painted FIRST (before paintBox), so
 * the run's highlight fillRect overpainted the selection → it was invisible on
 * highlighted/background text.
 */
import { describe, it, expect } from "vitest";
import { paintCanvas, paintPage } from "./canvas-renderer";
import type { LayoutBox, SelectionRect } from "./index";

type Op =
  | { kind: "fillRect"; x: number; y: number; w: number; h: number; fillStyle: string }
  | { kind: "fillText"; text: string; x: number; y: number; fillStyle: string };

interface SpyCtx extends CanvasRenderingContext2D {
  _ops: Op[];
}

function createSpyCtx(): SpyCtx {
  const ops: Op[] = [];
  const ctx: Partial<CanvasRenderingContext2D> & { _ops: Op[] } = {
    _ops: ops,
    canvas: { width: 600, height: 800 } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    clearRect() {
      /* no-op */
    },
    fillRect(this: { fillStyle: string }, x: number, y: number, w: number, h: number) {
      ops.push({ kind: "fillRect", x, y, w, h, fillStyle: this.fillStyle });
    },
    fillText(this: { fillStyle: string }, text: string, x: number, y: number) {
      ops.push({ kind: "fillText", text, x, y, fillStyle: this.fillStyle });
    },
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

const SELECTION_FILL = "rgba(59, 130, 246, 0.3)";

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

const SEL: SelectionRect[] = [
  { x: 0, y: 0, width: RUN_WIDTH, height: RUN_HEIGHT, pageIndex: 0 },
];

function paint(box: LayoutBox, selection: SelectionRect[]): SpyCtx {
  const ctx = createSpyCtx();
  paintCanvas(ctx, box, selection, [], [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
  return ctx;
}

// The highlight rect: full run width × full line height (distinct from the 1px
// decoration rules); painted in the highlight color.
const isHighlight = (o: Op): boolean =>
  o.kind === "fillRect" && o.w === RUN_WIDTH && o.h === RUN_HEIGHT && o.fillStyle === "#ffff00";
const isSelection = (o: Op): boolean =>
  o.kind === "fillRect" && o.fillStyle === SELECTION_FILL;
const isGlyph = (o: Op): boolean => o.kind === "fillText";

describe("selection composites over content backgrounds (#397)", () => {
  it("paints highlight BEFORE selection BEFORE glyphs on highlighted text", () => {
    const ops = paint(makeRun("#ffff00"), SEL)._ops;
    const hi = ops.findIndex(isHighlight);
    const sel = ops.findIndex(isSelection);
    const glyph = ops.findIndex(isGlyph);

    expect(hi).toBeGreaterThanOrEqual(0);
    expect(sel).toBeGreaterThanOrEqual(0);
    expect(glyph).toBeGreaterThanOrEqual(0);

    // highlight (content background) is BEHIND the selection tint...
    expect(hi).toBeLessThan(sel);
    // ...which is BEHIND the glyphs.
    expect(sel).toBeLessThan(glyph);
  });

  it("plain-text selection still paints selection BEFORE glyphs", () => {
    const ops = paint(makeRun("transparent"), SEL)._ops;
    const sel = ops.findIndex(isSelection);
    const glyph = ops.findIndex(isGlyph);
    expect(sel).toBeGreaterThanOrEqual(0);
    expect(glyph).toBeGreaterThanOrEqual(0);
    expect(sel).toBeLessThan(glyph);
  });
});

// ── paintPage path (production paginated path, via the editor controller) ─────

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;

const BASE_LINE_US = { ...BASE_US, lineHeight: RUN_HEIGHT };

/** A PageBox → BlockBox → LineBox → highlighted TextRunBox at page-local (0,0). */
function makeHighlightedPage(backgroundColor: string): LayoutBox {
  const run = makeRun(backgroundColor);
  const line: LayoutBox = {
    type: "line",
    key: "line",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: RUN_WIDTH, blockSize: RUN_HEIGHT,
    x: 0, y: 0, width: RUN_WIDTH, height: RUN_HEIGHT,
    writingMode: "horizontal-tb", direction: "ltr",
    baseline: 12, ownerBlockId: "owner", inlineStartOffset: 0,
    children: [run],
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_LINE_US },
  } as unknown as LayoutBox;
  const block: LayoutBox = {
    type: "block",
    key: "block",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: RUN_WIDTH, blockSize: RUN_HEIGHT,
    x: 0, y: 0, width: RUN_WIDTH, height: RUN_HEIGHT,
    writingMode: "horizontal-tb", direction: "ltr",
    children: [line],
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
  return {
    type: "page",
    key: "page-0",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: PAGE_WIDTH, blockSize: PAGE_HEIGHT,
    x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT,
    writingMode: "horizontal-tb", direction: "ltr",
    children: [block],
    pageIndex: 0,
    headerSlot: null, footerSlot: null, footnoteSlot: null,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

// Selection rect in PAGE-LOCAL coords (paintPage consumes selection rects as-is,
// after the controller has filtered them by pageIndex).
const PAGE_SEL: SelectionRect[] = [
  { x: 0, y: 0, width: RUN_WIDTH, height: RUN_HEIGHT, pageIndex: 0 },
];

// The page's white-bg pre-pass: full page rect in white.
const isWhitePageBg = (o: Op): boolean =>
  o.kind === "fillRect" && o.w === PAGE_WIDTH && o.h === PAGE_HEIGHT && o.fillStyle === "white";

describe("selection composites over content backgrounds — paintPage path (#397)", () => {
  it("paints page-bg + highlight BEFORE selection BEFORE glyphs on highlighted text", () => {
    const ctx = createSpyCtx();
    paintPage(ctx, makeHighlightedPage("#ffff00"), PAGE_SEL, [], [], [], null, "hidden");
    const ops = ctx._ops;

    const whiteBg = ops.findIndex(isWhitePageBg);
    const hi = ops.findIndex(isHighlight);
    const sel = ops.findIndex(isSelection);
    const glyph = ops.findIndex(isGlyph);

    expect(whiteBg).toBeGreaterThanOrEqual(0);
    expect(hi).toBeGreaterThanOrEqual(0);
    expect(sel).toBeGreaterThanOrEqual(0);
    expect(glyph).toBeGreaterThanOrEqual(0);

    // White page bg is the pre-pass, painted before everything else.
    expect(whiteBg).toBeLessThan(hi);
    // Highlight (content background) is BEHIND the selection tint...
    expect(hi).toBeLessThan(sel);
    // ...which is BEHIND the glyphs.
    // (Under the pre-#397 single-walk order the selection rect was painted
    // FIRST — before paintBox — so `sel < hi` and this would be RED.)
    expect(sel).toBeLessThan(glyph);
  });

  it("plain-text selection still paints selection BEFORE glyphs (paintPage)", () => {
    const ctx = createSpyCtx();
    paintPage(ctx, makeHighlightedPage("transparent"), PAGE_SEL, [], [], [], null, "hidden");
    const ops = ctx._ops;
    const sel = ops.findIndex(isSelection);
    const glyph = ops.findIndex(isGlyph);
    expect(sel).toBeGreaterThanOrEqual(0);
    expect(glyph).toBeGreaterThanOrEqual(0);
    expect(sel).toBeLessThan(glyph);
  });
});
