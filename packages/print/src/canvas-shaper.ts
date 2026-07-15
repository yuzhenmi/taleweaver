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
import { needsNativeComplexShaping } from "./complex-script";

/**
 * Canvas-based TextShaper. Default backend bundled with `@taleweaver/print`.
 *
 * Limitations vs a HarfBuzz backend:
 *   - Grapheme segmentation is UAX #29; when complex-script shaping is needed
 *     (Arabic-family scripts), the backend delegates glyph shaping to the browser
 *     by measuring the whole run and distributing advances back to clusters. This
 *     preserves contextual forms but is still an approximation for per-cluster
 *     carets compared with a real shaping engine.
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
    // Segment via the shared helper so shaper and renderer stay in lockstep.
    let start = 0;
    const segmented = segmentClusters(text);
    // Native complex shaping path (Arabic-family scripts): when spacing is
    // `normal`, renderer paints this run in one fillText call. To keep
    // caret/hit-test aligned with that painted run, derive each cluster advance
    // from prefix deltas of the NATIVE shaped width:
    //   adv(i) = width(text[0..i]) - width(text[0..i-1]).
    // This captures contextual joining effects much better than proportional
    // redistribution of isolated-cluster widths.
    const useNativeComplexRun =
      needsNativeComplexShaping(text) && letterPx === 0 && wordPx === 0;
    const nativeClusterAdvances: number[] = [];
    if (useNativeComplexRun) {
      let prefix = "";
      let prev = 0;
      for (const c of segmented) {
        prefix += c;
        const current = ctx.measureText(prefix).width;
        nativeClusterAdvances.push(Math.max(0, current - prev));
        prev = current;
      }
    }

    for (let i = 0; i < segmented.length; i++) {
      const c = segmented[i];
      if (c === undefined) continue;
      // U+00AD SOFT HYPHEN is a zero-advance format char (Cf): it renders nothing
      // and adds no width unless it is the chosen line-end break (where the IFC
      // shapes a "-" glyph separately). `ctx.measureText("­")` is browser/
      // font-dependent (often the width of a rendered hyphen), so we force 0 here
      // to match real shapers (HarfBuzz zero-advances default-ignorable Cf chars)
      // and keep word widths invariant to embedded soft hyphens (hyphenation).
      const raw = c === "\u00AD"
        ? 0
        : useNativeComplexRun
          ? (nativeClusterAdvances[i] ?? 0)
          : ctx.measureText(c).width;
      const w = raw + clusterSpacing(c, letterPx, wordPx);
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
