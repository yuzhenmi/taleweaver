import type {
  ComputedStyle,
  Direction,
  TextShaper,
  ShapedRun,
  Cluster,
  BreakOpportunity,
  FontMetrics,
} from "@taleweaver/core";
import { resolveSpacingPx, clusterSpacing, toBreakOpportunities } from "@taleweaver/core";
import { buildCssFontString } from "./font-config";
import { segmentClusters } from "./text-clusters";

/**
 * Canvas-based TextShaper. Default backend bundled with `@taleweaver/print`.
 *
 * Limitations vs a HarfBuzz backend:
 *   - Each UAX #29 grapheme cluster is one cluster (combining marks, surrogate
 *     pairs, ZWJ sequences, regional-indicator flags each form one cluster) with
 *     per-cluster `measureText` metrics — no HarfBuzz shaping / ligature detection.
 *   - Break opportunities come from the conformant UAX #14 line-break
 *     classifier (soft/hard kinds); the `hyphen` kind stays reserved for a
 *     future hyphenation backend.
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
    // CSS letter-/word-spacing: resolve once, then add per-cluster extra advance
    // (letter-spacing on every cluster + word-spacing on word separators). The
    // `normal`-identity contract means default styles add 0 (see text-spacing.ts).
    const letterPx = resolveSpacingPx(style.letterSpacing);
    const wordPx = resolveSpacingPx(style.wordSpacing);
    // Segment via the shared helper so the renderer (which paints each cluster
    // at the matching cumulative advance, #330) can never diverge from how the
    // shaper measured. v1 clusters are single code units.
    let start = 0;
    for (const c of segmentClusters(text)) {
      // U+00AD SOFT HYPHEN is a zero-advance format char (Cf): it renders nothing
      // and adds no width unless it is the chosen line-end break (where the IFC
      // shapes a "-" glyph separately). `ctx.measureText("­")` is browser/
      // font-dependent (often the width of a rendered hyphen), so we force 0 here
      // to match real shapers (HarfBuzz zero-advances default-ignorable Cf chars)
      // and keep word widths invariant to embedded soft hyphens (hyphenation).
      const w = c === "­" ? 0 : ctx.measureText(c).width + clusterSpacing(c, letterPx, wordPx);
      clusters.push({
        start,
        end: start + c.length,
        inlineAdvance: w,
        isLigature: false,
        glyphs: [c.charCodeAt(0)],
      });
      total += w;
      if (w > max) max = w;
      start += c.length;
    }

    // UAX #14 line-break opportunities (default CSS `line-break: normal`),
    // via the single-sourced `toBreakOpportunities` adapter in core.
    const breakOpportunities: BreakOpportunity[] = toBreakOpportunities(text);

    const fm = measureFontMetricsImpl(style);

    return {
      text,
      computedStyle: style,
      clusters,
      ascent: fm.ascent,
      descent: fm.descent,
      lineGap: fm.lineGap,
      minClusterInlineSize: text.length === 0 ? 0 : max,
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
