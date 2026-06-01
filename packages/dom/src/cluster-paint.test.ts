/**
 * #330 — caret/glyph drift in long tokens.
 *
 * The canvas shaper (`canvas-shaper.ts`) MEASURES text by summing per-cluster
 * advances (`Σ ctx.measureText(text[i]).width`), and the caret / hit-test /
 * layout all consume those summed advances. But paint historically drew the
 * WHOLE run in one `ctx.fillText(box.text, x, y)`, which the browser lays out
 * with native kerning — so for a proportional font
 * `Σ measureText(clusterᵢ) ≠ measureText(wholeString)`, and the painted glyphs
 * drift from the measured caret, worst at a long token's tail.
 *
 * The fix paints CLUSTER-BY-CLUSTER at the SAME cumulative advances the shaper
 * measures, so painted glyph origins == summed advances == caret x by
 * construction.
 *
 * The standard linear mock (`measureText(s) = s.length * k`) can't reproduce
 * this — per-cluster sum == whole-string. These tests use a KERNED mock whose
 * multi-cluster width is strictly less than the per-cluster sum.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { paintCanvas } from "./canvas-renderer";
import { adaptShaperToMeasurer } from "@taleweaver/core";
import type { LayoutBox, TextShaper, ShapedRun } from "@taleweaver/core";

// ── Per-cluster width model (proportional font, with kerning) ────────────────
// Single clusters have these widths; a multi-cluster string is shaped with 2px
// of kerning REMOVED per inter-cluster join — so the whole-string width is
// strictly less than the sum of per-cluster widths.
const CLUSTER_WIDTH = (ch: string): number => {
  if (ch >= "0" && ch <= "9") return 10; // digits wide
  if (ch === " ") return 5;
  return 8; // letters
};
const KERN_PER_JOIN = 2;

function perClusterSum(s: string): number {
  let total = 0;
  for (let i = 0; i < s.length; i++) total += CLUSTER_WIDTH(s[i]);
  return total;
}

/** Whole-string width with native kerning: per-cluster sum minus the joins. */
function kernedWidth(s: string): number {
  if (s.length <= 1) return perClusterSum(s);
  return perClusterSum(s) - (s.length - 1) * KERN_PER_JOIN;
}

// ── Kerned mock canvas context ───────────────────────────────────────────────
interface FillText { text: string; x: number; y: number; }

interface KernedCtx extends CanvasRenderingContext2D {
  _fills: FillText[];
}

function createKernedCtx(): KernedCtx {
  const fills: FillText[] = [];
  const ctx: Partial<CanvasRenderingContext2D> & { _fills: FillText[] } = {
    _fills: fills,
    canvas: { width: 600, height: 800 } as HTMLCanvasElement,
    font: "",
    textBaseline: "alphabetic",
    fillStyle: "",
    clearRect() { /* no-op */ },
    fillRect() { /* no-op */ },
    fillText(text: string, x: number, y: number) {
      fills.push({ text, x, y });
    },
    // KERNED: single cluster → per-cluster width; multi-cluster → kerned width.
    measureText: (text: string) =>
      ({ width: kernedWidth(text) } as TextMetrics),
  };
  return ctx as unknown as KernedCtx;
}

/** A `TextShaper` that segments per code-unit and measures each via measureText. */
function createKernedShaper(ctx: KernedCtx): TextShaper {
  return {
    shape(text, style): ShapedRun {
      const clusters = [];
      for (let i = 0; i < text.length; i++) {
        const w = ctx.measureText(text[i]).width;
        clusters.push({
          start: i,
          end: i + 1,
          inlineAdvance: w,
          isLigature: false,
          glyphs: [text.charCodeAt(i)],
        });
      }
      return {
        text,
        computedStyle: style,
        clusters,
        ascent: 12,
        descent: 4,
        lineGap: 0,
        minClusterInlineSize: 8,
        unbreakableRunInlineSize: perClusterSum(text),
        breakOpportunities: [],
        bidiLevel: 0,
      };
    },
    measureFontMetrics() {
      return { ascent: 12, descent: 4, lineGap: 0, capHeight: 11, xHeight: 8 };
    },
  };
}

// ── LayoutBox helpers ────────────────────────────────────────────────────────
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
};

function makeTextRun(opts: { text: string; x?: number; width?: number; height?: number }): LayoutBox {
  const h = opts.height ?? 16;
  return {
    type: "text-run",
    key: "run",
    inlineOffset: 0, blockOffset: 0,
    inlineSize: opts.width ?? 100, blockSize: h,
    x: opts.x ?? 0, y: 0,
    width: opts.width ?? 100, height: h,
    writingMode: "horizontal-tb", direction: "ltr",
    text: opts.text,
    computedStyle: { ...BASE_CS },
    usedStyle: { ...BASE_US },
  } as unknown as LayoutBox;
}

function paint(ctx: KernedCtx, box: LayoutBox): void {
  paintCanvas(
    ctx,
    box,
    [],
    { x: 0, y: 0, height: 0 },
    "hidden",
    600,
    800,
    0,
    800,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("#330 cluster-positioned painting", () => {
  let ctx: KernedCtx;
  let measurer: ReturnType<typeof adaptShaperToMeasurer>;

  beforeEach(() => {
    ctx = createKernedCtx();
    measurer = adaptShaperToMeasurer(createKernedShaper(ctx));
  });

  it("paints each cluster at the summed (caret-aligned) advance, not the kerned whole-string offset", () => {
    const text = "Helloworld111";
    const absX = 7;
    const box = makeTextRun({ text, x: absX });

    paint(ctx, box);

    // One draw call per cluster.
    expect(ctx._fills.length).toBe(text.length);

    // Each cluster k is drawn at absX + Σ measureText(prevClusters) — exactly
    // the per-cluster cumulative advance. With the kerned mock this differs from
    // a single fillText(whole) + native kerning would place glyph k at.
    let cum = 0;
    for (let k = 0; k < text.length; k++) {
      const fill = ctx._fills[k];
      expect(fill.text).toBe(text[k]);
      expect(fill.x).toBeCloseTo(absX + cum, 6);
      cum += CLUSTER_WIDTH(text[k]);
    }

    // The LAST cluster's x is the per-cluster cumulative — which is strictly
    // GREATER than where it would sit inside a kerned whole-string draw.
    const lastFill = ctx._fills[text.length - 1];
    const kernedLastOffset = absX + kernedWidth(text.slice(0, text.length - 1));
    expect(lastFill.x).toBeGreaterThan(kernedLastOffset);
  });

  it("aligns painted glyph x with the caret-measure x (measureWidth(prefix)) at interior + trailing offsets", () => {
    const text = "Helloworld111";
    const absX = 7;
    const box = makeTextRun({ text, x: absX });

    paint(ctx, box);

    // The real guard: paint-x of cluster k EQUALS caret x = absX + measureWidth(slice(0,k)).
    // measureWidth sums the SAME per-cluster advances the shaper produces.
    const cs = { ...BASE_CS } as unknown as Parameters<typeof measurer.measureWidth>[1];

    const interior = 9;
    const interiorCaretX = absX + measurer.measureWidth(text.slice(0, interior), cs);
    expect(ctx._fills[interior].x).toBeCloseTo(interiorCaretX, 6);

    // Trailing offset: caret sits at the right edge of the last cluster, which
    // equals the (would-be) origin of a cluster index === text.length.
    const lastDrawn = ctx._fills[text.length - 1];
    const trailingCaretX = absX + measurer.measureWidth(text, cs);
    expect(lastDrawn.x + ctx.measureText(text[text.length - 1]).width).toBeCloseTo(trailingCaretX, 6);
  });

  it("NO-REGRESSION: a single-cluster run paints one fillText at absX", () => {
    const box = makeTextRun({ text: "X", x: 12 });
    paint(ctx, box);
    expect(ctx._fills.length).toBe(1);
    expect(ctx._fills[0]).toMatchObject({ text: "X", x: 12 });
  });

  it("NO-REGRESSION: an empty run paints nothing", () => {
    const box = makeTextRun({ text: "" });
    paint(ctx, box);
    expect(ctx._fills.length).toBe(0);
  });

  it("paints whitespace clusters (spaces have width)", () => {
    const box = makeTextRun({ text: "a b", x: 0 });
    paint(ctx, box);
    expect(ctx._fills.map((f) => f.text)).toEqual(["a", " ", "b"]);
    // a@0, space@8, b@(8+5)=13
    expect(ctx._fills[0].x).toBeCloseTo(0, 6);
    expect(ctx._fills[1].x).toBeCloseTo(8, 6);
    expect(ctx._fills[2].x).toBeCloseTo(13, 6);
  });
});
