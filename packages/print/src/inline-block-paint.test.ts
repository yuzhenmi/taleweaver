/**
 * Inline-block paint gap.
 *
 * `paintBox` had cases for `page`, `text-run`, `marker`, `block`, `line`,
 * `inline`, `table`, `table-row`, `table-cell` — but NO `inline-block` case.
 * An `InlineBlockBox` fell through to the silent `// Plan 2/3 types: skip`
 * exit and was NEVER painted. Consequence: footnote call-markers (the
 * superscript number built as an inline-block `ElementBox`) and ALL
 * inline-block content laid out correctly but never reached the screen.
 *
 * These tests build a layout tree containing an `inline-block` box whose
 * descendant `text-run` carries a known glyph ("1") and assert paint emits a
 * `fillText("1", …)` for it (absent before the fix). A sibling plain
 * `text-run` guards that the new dispatch case didn't disturb the existing
 * chain (no-regression).
 *
 * JSDOM does not implement CanvasRenderingContext2D — we use a spy-stub that
 * records fillText (text + x + y).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { paintCanvas } from "./canvas-renderer";
import type { LayoutBox } from "./index";

// ── Canvas mock (records fillText text+x+y) ──────────────────────────────────
interface FillText { text: string; x: number; y: number; }

interface SpyCtx extends CanvasRenderingContext2D {
  _fills: FillText[];
}

function createSpyCtx(width = 600, height = 800): SpyCtx {
  const fills: FillText[] = [];
  const ctx: Partial<CanvasRenderingContext2D> & { _fills: FillText[] } = {
    _fills: fills,
    canvas: { width, height } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    clearRect() { /* no-op */ },
    fillRect() { /* no-op */ },
    fillText(text: string, x: number, y: number) {
      fills.push({ text, x, y });
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
  lineHeight: 20,
  writingMode: "horizontal-tb",
};

function makeTextRun(opts: { text: string; x: number; y: number; width?: number; height?: number }): LayoutBox {
  const h = opts.height ?? 16;
  return {
    type: "text-run",
    key: "run",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: opts.width ?? 100, blockSize: h,
    x: opts.x, y: opts.y,
    width: opts.width ?? 100, height: h,
    writingMode: "horizontal-tb", direction: "ltr",
    text: opts.text,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

function makeLine(opts: { x: number; y: number; width: number; height: number; children: LayoutBox[] }): LayoutBox {
  return {
    type: "line",
    key: "line",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: opts.width, blockSize: opts.height,
    x: opts.x, y: opts.y,
    width: opts.width, height: opts.height,
    writingMode: "horizontal-tb", direction: "ltr",
    children: opts.children,
    baseline: opts.height,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

/** An inline-block box positioned at (x, y), containing a line → text-run. */
function makeInlineBlock(opts: { x: number; y: number; width: number; height: number; glyph: string }): LayoutBox {
  const run = makeTextRun({ text: opts.glyph, x: 0, y: 0, width: opts.width, height: opts.height });
  const line = makeLine({ x: 0, y: 0, width: opts.width, height: opts.height, children: [run] });
  return {
    type: "inline-block",
    key: "ib",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: opts.width, blockSize: opts.height,
    x: opts.x, y: opts.y,
    width: opts.width, height: opts.height,
    writingMode: "horizontal-tb", direction: "ltr",
    children: [line],
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

function makeBlock(opts: { children: LayoutBox[] }): LayoutBox {
  return {
    type: "block",
    key: "block",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: 200, blockSize: 100,
    x: 0, y: 0,
    width: 200, height: 100,
    writingMode: "horizontal-tb", direction: "ltr",
    children: opts.children,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

function paint(ctx: SpyCtx, box: LayoutBox): void {
  paintCanvas(
    ctx,
    box,
    [],
    [],
    [], [], { x: 0, y: 0, height: 0 },
    "hidden",
    600,
    800,
    0,
    800,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("inline-block painting", () => {
  let ctx: SpyCtx;

  beforeEach(() => {
    ctx = createSpyCtx();
  });

  it("paints an inline-block's descendant text-run glyph (was never painted before the fix)", () => {
    // A footnote call-marker is an inline-block carrying a superscript glyph.
    // The inline-block sits at a raised y (superscript) within its line.
    const ib = makeInlineBlock({ x: 50, y: 4, width: 10, height: 12, glyph: "1" });
    const root = makeBlock({ children: [ib] });

    paint(ctx, root);

    const texts = ctx._fills.map((f) => f.text);
    expect(texts).toContain("1");
  });

  it("paints the inline-block glyph at the raised (inline-block-y-implied) position", () => {
    const ibY = 4;
    const ib = makeInlineBlock({ x: 50, y: ibY, width: 10, height: 12, glyph: "1" });
    const root = makeBlock({ children: [ib] });

    paint(ctx, root);

    const fill = ctx._fills.find((f) => f.text === "1");
    expect(fill).toBeDefined();
    // absX = block.x(0) + ib.x(50) + line.x(0) + run.x(0) = 50.
    expect(fill?.x).toBeCloseTo(50, 6);
    // The text-run paints at absY (= 0 + ibY + 0 + 0) plus the line's
    // half-leading. With box.height 12 and fontSize 16 the half-leading is
    // negative, but the glyph's y must reflect the inline-block's raised y
    // (ibY), proving the inline-block subtree was traversed at its own offset.
    const expectedBaseline = ibY + (12 - 16) / 2;
    expect(fill?.y).toBeCloseTo(expectedBaseline, 6);
  });

  it("NO-REGRESSION: a sibling plain text-run still paints", () => {
    const ib = makeInlineBlock({ x: 50, y: 4, width: 10, height: 12, glyph: "1" });
    const plain = makeTextRun({ text: "body", x: 0, y: 30, width: 32, height: 16 });
    const root = makeBlock({ children: [plain, ib] });

    paint(ctx, root);

    // Text runs paint cluster-by-cluster (#330), so "body" is drawn as the
    // clusters ["b","o","d","y"] — join them back to assert the whole word.
    const joined = ctx._fills.map((f) => f.text).join("");
    // Both the inline-block marker and the plain run paint.
    expect(joined).toContain("1");
    expect(joined).toContain("body");
  });
});
