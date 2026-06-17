/**
 * Multi-column slice 2 (structural) — the painter descends a `MultiColumnBox`'s
 * `columns` like a plain container, painting NOTHING of its own (no column-rule —
 * that is a later slice). This smoke test drives the real `paintCanvas` →
 * `paintBox` seam with a hand-built tree containing a MultiColumnBox: painting it
 * must not throw, and each column's glyph must land at the column's X offset
 * (confirming the descent reached both columns in order).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { paintCanvas } from "./canvas-renderer";
import type { LayoutBox } from "./index";

interface FillText { text: string; x: number; y: number; }
interface FillRect { x: number; y: number; w: number; h: number; fillStyle: string; }

interface SpyCtx extends CanvasRenderingContext2D {
  _fills: FillText[];
  _rects: FillRect[];
}

function createSpyCtx(width = 600, height = 800): SpyCtx {
  const fills: FillText[] = [];
  const rects: FillRect[] = [];
  const ctx: Partial<CanvasRenderingContext2D> & { _fills: FillText[]; _rects: FillRect[] } = {
    _fills: fills,
    _rects: rects,
    canvas: { width, height } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    clearRect() { /* no-op */ },
    fillRect(x: number, y: number, w: number, h: number) {
      // Capture the live fillStyle so rule rects are distinguishable by color.
      rects.push({ x, y, w, h, fillStyle: ctx.fillStyle as string });
    },
    fillText(text: string, x: number, y: number) {
      fills.push({ text, x, y });
    },
    measureText: (text: string) => ({ width: text.length * 8 } as TextMetrics),
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
  lineHeight: 16,
  writingMode: "horizontal-tb",
};

function makeTextRun(text: string, x: number, y: number): LayoutBox {
  return {
    type: "text-run",
    key: `run-${text}`,
    inlineOffset: 0, blockOffset: 0,
    inlineSize: 16, blockSize: 16,
    x, y, width: 16, height: 16,
    writingMode: "horizontal-tb", direction: "ltr",
    text,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

function makeBlock(key: string, x: number, y: number, children: LayoutBox[]): LayoutBox {
  return {
    type: "block",
    key,
    inlineOffset: x, blockOffset: y,
    inlineSize: 240, blockSize: 400,
    x, y, width: 240, height: 400,
    writingMode: "horizontal-tb", direction: "ltr",
    children,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

interface ColumnRuleLike { width: number; style: string; color: string; }

function makeMultiColumn(columns: LayoutBox[], columnRule: ColumnRuleLike | null = null): LayoutBox {
  return {
    type: "multicolumn",
    key: "mc",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: 500, blockSize: 400,
    x: 0, y: 0, width: 500, height: 400,
    writingMode: "horizontal-tb", direction: "ltr",
    columns,
    columnRule,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

function paint(ctx: SpyCtx, box: LayoutBox): void {
  paintCanvas(ctx, box, [], [], [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
}

describe("multicolumn paint (slice 2 structural)", () => {
  let ctx: SpyCtx;
  beforeEach(() => { ctx = createSpyCtx(); });

  it("descends both columns and paints their glyphs at the column X offsets; does not throw", () => {
    // col0 at inline-offset 0 holds glyph "A"; col1 at inline-offset 260 holds "B".
    const col0 = makeBlock("col0", 0, 0, [makeTextRun("A", 0, 0)]);
    const col1 = makeBlock("col1", 260, 0, [makeTextRun("B", 0, 0)]);
    const mc = makeMultiColumn([col0, col1]);
    const root = makeBlock("root", 0, 0, [mc]);

    expect(() => paint(ctx, root)).not.toThrow();

    const a = ctx._fills.find((f) => f.text === "A");
    const b = ctx._fills.find((f) => f.text === "B");
    // Both columns reached → both glyphs painted.
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // col0's glyph at absolute x = 0; col1's at the column's inline-offset 260.
    expect(a?.x).toBeCloseTo(0, 6);
    expect(b?.x).toBeCloseTo(260, 6);
  });

  it("with columnRule:null paints NO rule rect (only the columns' own fills)", () => {
    const col0 = makeBlock("col0", 0, 0, [makeTextRun("A", 0, 0)]);
    const col1 = makeBlock("col1", 260, 0, [makeTextRun("B", 0, 0)]);
    const mc = makeMultiColumn([col0, col1], null);
    const root = makeBlock("root", 0, 0, [mc]);

    paint(ctx, root);

    // The columns themselves carry no background/border in BASE_US, so no fillRect
    // belongs to the MultiColumnBox arm. A rule rect would sit in the gap (x≈250)
    // with the rule color "#0a0a0a"; assert none exists.
    const ruleRect = ctx._rects.find((r) => r.fillStyle === "#0a0a0a");
    expect(ruleRect).toBeUndefined();
  });

  it("with a solid columnRule draws a rule rect centered in the gap, spanning the box height", () => {
    // col0 at x∈[0,240], col1 at x∈[260,500]. Gap center = (240 + 260)/2 = 250.
    const col0 = makeBlock("col0", 0, 0, [makeTextRun("A", 0, 0)]);
    const col1 = makeBlock("col1", 260, 0, [makeTextRun("B", 0, 0)]);
    const mc = makeMultiColumn([col0, col1], { width: 2, style: "solid", color: "#0a0a0a" });
    const root = makeBlock("root", 0, 0, [mc]);

    paint(ctx, root);

    // The rule must draw EXACTLY ONCE — it is gated to the background phase, so the
    // foreground pass must NOT re-draw it (a missing phase guard double-paints).
    const ruleRects = ctx._rects.filter((r) => r.fillStyle === "#0a0a0a");
    expect(ruleRects.length).toBe(1);
    const ruleRect = ruleRects[0];
    if (ruleRect === undefined) throw new Error("expected rule rect");
    // Centered in the gap: gapCenterX = 250, width 2 ⇒ x = 250 − 1 = 249.
    expect(ruleRect.x).toBeCloseTo(249, 6);
    expect(ruleRect.w).toBeCloseTo(2, 6);
    // Spans the MultiColumnBox's block extent: y = box top (0), height = box height (400).
    expect(ruleRect.y).toBeCloseTo(0, 6);
    expect(ruleRect.h).toBeCloseTo(400, 6);
  });
});
