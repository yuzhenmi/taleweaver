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
import type { TextShaper, ShapedRun } from "@taleweaver/core";
import type { LayoutBox } from "./index";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

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
  for (let i = 0; i < s.length; i++) total += CLUSTER_WIDTH(s.charAt(i));
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
        const w = ctx.measureText(text.charAt(i)).width;
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

function makeTextRun(opts: {
  text: string;
  x?: number;
  width?: number;
  height?: number;
  letterSpacing?: number | "normal";
  wordSpacing?: number | "normal";
  bidiLevel?: number;
}): LayoutBox {
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
    bidiLevel: opts.bidiLevel,
    computedStyle: { ...BASE_CS },
    usedStyle: {
      ...BASE_US,
      letterSpacing: opts.letterSpacing ?? "normal",
      wordSpacing: opts.wordSpacing ?? "normal",
    },
  } as unknown as LayoutBox;
}

function paint(ctx: KernedCtx, box: LayoutBox): void {
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
      const fill = nth(ctx._fills, k, "fill");
      expect(fill.text).toBe(text.charAt(k));
      expect(fill.x).toBeCloseTo(absX + cum, 6);
      cum += CLUSTER_WIDTH(text.charAt(k));
    }

    // The LAST cluster's x is the per-cluster cumulative — which is strictly
    // GREATER than where it would sit inside a kerned whole-string draw.
    const lastFill = nth(ctx._fills, text.length - 1, "fill");
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
    expect(nth(ctx._fills, interior, "fill").x).toBeCloseTo(interiorCaretX, 6);

    // Trailing offset: caret sits at the right edge of the last cluster, which
    // equals the (would-be) origin of a cluster index === text.length.
    const lastDrawn = nth(ctx._fills, text.length - 1, "fill");
    const trailingCaretX = absX + measurer.measureWidth(text, cs);
    expect(lastDrawn.x + ctx.measureText(text.charAt(text.length - 1)).width).toBeCloseTo(trailingCaretX, 6);
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
    expect(nth(ctx._fills, 0, "fill").x).toBeCloseTo(0, 6);
    expect(nth(ctx._fills, 1, "fill").x).toBeCloseTo(8, 6);
    expect(nth(ctx._fills, 2, "fill").x).toBeCloseTo(13, 6);
  });

  it("paint advances include letter-spacing (no glyph/caret drift)", () => {
    // CSS Text 3 §8: letter-spacing adds extra advance after EVERY cluster, so
    // the painted origin of cluster i+1 must include the per-cluster spacing the
    // LAYOUT/shaper added — otherwise glyphs drift from the caret/layout. Here
    // letterSpacing = 5 (numeric px, as in UsedStyle).
    const box = makeTextRun({ text: "ab", x: 0, letterSpacing: 5 });
    paint(ctx, box);

    expect(ctx._fills.map((f) => f.text)).toEqual(["a", "b"]);
    // a@0; b@ measureText("a").width (8) + letterSpacing (5) = 13.
    expect(nth(ctx._fills, 0, "fill").x).toBeCloseTo(0, 6);
    expect(nth(ctx._fills, 1, "fill").x).toBeCloseTo(ctx.measureText("a").width + 5, 6);
  });

  it("paint advances include word-spacing on word separators", () => {
    // word-spacing adds extra advance only on word-separator clusters (U+0020).
    // letterSpacing also applies to every cluster. "a b": a@0, space@(8+2)=10,
    // b@(10 + 5[space width] + 2[letter] + 3[word]) = 20.
    const box = makeTextRun({ text: "a b", x: 0, letterSpacing: 2, wordSpacing: 3 });
    paint(ctx, box);

    expect(ctx._fills.map((f) => f.text)).toEqual(["a", " ", "b"]);
    expect(nth(ctx._fills, 0, "fill").x).toBeCloseTo(0, 6);
    // after "a": width 8 + letter 2 = 10
    expect(nth(ctx._fills, 1, "fill").x).toBeCloseTo(10, 6);
    // after " ": prev 10 + width 5 + letter 2 + word 3 = 20
    expect(nth(ctx._fills, 2, "fill").x).toBeCloseTo(20, 6);
  });
});

// ── P4-C.1 Task 7: intra-run RTL glyph paint (driven by bidiLevel) ───────────
// An odd resolved UAX #9 level paints clusters RIGHT-to-LEFT WITHIN the box.
// The box's physical x/width are already correct from the reorder; this only
// reverses cluster PLACEMENT inside it. The decision signal is `box.bidiLevel`
// (odd ⇒ RTL), NOT `cs.direction` (which stays "ltr" under the physical-
// coordinate contract). Even/undefined ⇒ LTR, byte-identical to the #330 path.
describe("P4-C.1 RTL intra-run cluster paint", () => {
  let ctx: KernedCtx;

  beforeEach(() => {
    ctx = createKernedCtx();
  });

  it("paints an odd-bidiLevel run's clusters RIGHT-to-LEFT (logical-first cluster rightmost)", () => {
    // 4 single-unit clusters, each 8px wide, no kerning between (these are the
    // per-cluster advances; the run width is the per-cluster sum = 32).
    const text = "abcd";
    const absX = 7;
    const width = perClusterSum(text); // 32
    const box = makeTextRun({ text, x: absX, width, bidiLevel: 1 });

    paint(ctx, box);

    // One draw call per cluster, in LOGICAL order (segmentClusters order).
    expect(ctx._fills.length).toBe(text.length);
    expect(ctx._fills.map((f) => f.text)).toEqual(["a", "b", "c", "d"]);

    // RTL placement: logically-first cluster sits at the RIGHT edge; cluster i's
    // LEFT edge = rightEdge − Σadvances(0..=i). With 8px clusters, rightEdge =
    // absX + 32 = 39:  a@(39−8)=31, b@(39−16)=23, c@(39−24)=15, d@(39−32)=7.
    const rightEdge = absX + width;
    const advances = [8, 8, 8, 8];
    let cum = 0;
    for (let k = 0; k < text.length; k++) {
      cum += nth(advances, k, "advance");
      expect(nth(ctx._fills, k, "fill").x).toBeCloseTo(rightEdge - cum, 6);
    }

    // Reversed vs LTR: logically-first cluster is RIGHTMOST, last is LEFTMOST.
    const firstX = nth(ctx._fills, 0, "fill").x;
    const lastX = nth(ctx._fills, text.length - 1, "fill").x;
    expect(firstX).toBeGreaterThan(lastX);

    // The run still spans exactly [absX, absX + width]: leftmost glyph's left
    // edge == absX, and the rightmost glyph's right edge == absX + width.
    expect(lastX).toBeCloseTo(absX, 6);
    expect(firstX + ctx.measureText("a").width).toBeCloseTo(absX + width, 6);
  });

  it("LTR (bidiLevel undefined) is byte-identical to the #330 left-to-right path", () => {
    const text = "abcd";
    const absX = 7;
    const width = perClusterSum(text);
    const ltrBox = makeTextRun({ text, x: absX, width, bidiLevel: undefined });

    paint(ctx, ltrBox);

    // Left-to-right cumulative advances, exactly as the LTR path produces.
    expect(ctx._fills.map((f) => f.text)).toEqual(["a", "b", "c", "d"]);
    let cum = 0;
    for (let k = 0; k < text.length; k++) {
      expect(nth(ctx._fills, k, "fill").x).toBeCloseTo(absX + cum, 6);
      cum += CLUSTER_WIDTH(text.charAt(k));
    }
  });

  it("an EVEN bidiLevel (e.g. 2) is treated as LTR (not reversed)", () => {
    const text = "abcd";
    const absX = 7;
    const width = perClusterSum(text);
    const box = makeTextRun({ text, x: absX, width, bidiLevel: 2 });

    paint(ctx, box);

    let cum = 0;
    for (let k = 0; k < text.length; k++) {
      expect(nth(ctx._fills, k, "fill").x).toBeCloseTo(absX + cum, 6);
      cum += CLUSTER_WIDTH(text.charAt(k));
    }
  });
});
