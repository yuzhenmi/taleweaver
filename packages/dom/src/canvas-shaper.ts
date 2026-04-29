import type {
  ComputedStyle,
  Direction,
  TextShaper,
  ShapedRun,
  Cluster,
  BreakOpportunity,
  FontMetrics,
} from "@taleweaver/core";
import { buildCssFontString } from "./font-config";

/**
 * Canvas-based TextShaper. Default backend bundled with `@taleweaver/dom`.
 *
 * Limitations vs a HarfBuzz backend:
 *   - Each codepoint is one cluster (no ligature detection).
 *   - Break opportunities use a simple whitespace + hard-break heuristic
 *     (full UAX-14 deferred).
 *   - Bidi level is uniform per shaped run (0 or 1 based on baseDirection).
 *     Mixed-direction text is not bidi-resolved at the cluster level.
 *
 * For production use with complex scripts (Arabic, Devanagari) or
 * real ligature support, consumers should use a HarfBuzz-backed shaper.
 */
export function createCanvasShaper(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): TextShaper {
  const rawCtx = (canvas as HTMLCanvasElement).getContext("2d");
  if (!rawCtx) {
    throw new Error("createCanvasShaper: failed to get 2D context");
  }
  const ctx: CanvasRenderingContext2D = rawCtx;

  function setFont(style: Readonly<ComputedStyle>): void {
    ctx.font = buildCssFontString(style);
  }

  function measureFontMetricsImpl(style: Readonly<ComputedStyle>): FontMetrics {
    setFont(style);
    // Use the canvas measureText API to get approximate metrics.
    // ctx.measureText("Hg") provides actualBoundingBoxAscent/Descent on
    // recent browsers; fall back to font-size heuristics if not available.
    const m = ctx.measureText("Hg");
    const ascent = m.actualBoundingBoxAscent ?? style.fontSize * 0.8;
    const descent = m.actualBoundingBoxDescent ?? style.fontSize * 0.2;
    const lineHeight =
      typeof style.lineHeight === "number"
        ? style.lineHeight < 4
          ? style.lineHeight * style.fontSize
          : style.lineHeight
        : style.fontSize * 1.2;
    const lineGap = Math.max(0, lineHeight - ascent - descent);
    // x-height heuristic: measure "x"
    const xHeight =
      ctx.measureText("x").actualBoundingBoxAscent ?? style.fontSize * 0.5;
    // cap-height heuristic: measure "H"
    const capHeight =
      ctx.measureText("H").actualBoundingBoxAscent ?? style.fontSize * 0.7;
    return { ascent, descent, lineGap, capHeight, xHeight };
  }

  function shape(
    text: string,
    style: Readonly<ComputedStyle>,
    baseDirection: Direction,
  ): ShapedRun {
    setFont(style);

    const clusters: Cluster[] = [];
    let max = 0;
    let total = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const w = ctx.measureText(c).width;
      clusters.push({
        start: i,
        end: i + 1,
        inlineAdvance: w,
        isLigature: false,
        glyphs: [c.charCodeAt(0)],
      });
      total += w;
      if (w > max) max = w;
    }

    const breakOpportunities: BreakOpportunity[] = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === "\n" || c === "\r") {
        breakOpportunities.push({ clusterIndex: i, kind: "hard" });
      } else if (i > 0 && /\s/.test(c)) {
        breakOpportunities.push({ clusterIndex: i, kind: "soft" });
      }
    }
    breakOpportunities.sort((a, b) => a.clusterIndex - b.clusterIndex);

    const fm = measureFontMetricsImpl(style);

    return {
      text,
      computedStyle: style,
      clusters,
      ascent: fm.ascent,
      descent: fm.descent,
      lineGap: fm.lineGap,
      minClusterInlineSize: max,
      unbreakableRunInlineSize: total,
      breakOpportunities,
      bidiLevel: baseDirection === "rtl" ? 1 : 0,
    };
  }

  function measureFontMetrics(style: Readonly<ComputedStyle>): FontMetrics {
    return measureFontMetricsImpl(style);
  }

  return { shape, measureFontMetrics };
}
