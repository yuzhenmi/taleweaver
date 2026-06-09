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
import type { LayoutBox } from "@taleweaver/core";

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

function makeMultiColumn(columns: LayoutBox[]): LayoutBox {
  return {
    type: "multicolumn",
    key: "mc",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: 500, blockSize: 400,
    x: 0, y: 0, width: 500, height: 400,
    writingMode: "horizontal-tb", direction: "ltr",
    columns,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

function paint(ctx: SpyCtx, box: LayoutBox): void {
  paintCanvas(ctx, box, [], [], { x: 0, y: 0, height: 0 }, "hidden", 600, 800, 0, 800);
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
});
