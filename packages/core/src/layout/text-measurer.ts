import type { ComputedStyle } from "../styles";
import type { TextShaper, ShapedRun, FontMetrics } from "./text-shaper";
import { toBreakOpportunities } from "./text-shaper";
import { createMockShaper } from "./mock-shaper";

/**
 * Narrow legacy interface — width and height only. Layout-internal callers
 * should prefer `TextShaper` directly for correctness with ligatures,
 * complex scripts, and per-cluster positioning. New code should use
 * `TextShaper`; this interface is kept for backwards-compat callers.
 */
export interface TextMeasurer {
  measureWidth(text: string, style: Readonly<ComputedStyle>): number;
  measureHeight(style: Readonly<ComputedStyle>): number;
}

/** Adapt a `TextShaper` to the narrow `TextMeasurer` interface. */
export function adaptShaperToMeasurer(shaper: TextShaper): TextMeasurer {
  return {
    measureWidth(text, style) {
      const run = shaper.shape(text, style, style.direction);
      let total = 0;
      for (const c of run.clusters) total += c.inlineAdvance;
      return total;
    },
    measureHeight(style) {
      const fm = shaper.measureFontMetrics(style);
      return fm.ascent + fm.descent + fm.lineGap;
    },
  };
}

/** Runtime check: does this object implement the `TextShaper` interface? */
export function isTextShaper(value: TextShaper | TextMeasurer): value is TextShaper {
  return typeof (value as TextShaper).shape === "function";
}

/**
 * Adapt a `TextMeasurer` to the `TextShaper` interface.
 * Clusters are per-character (each codepoint is its own cluster) with width
 * derived from the measurer's total width divided by character count.
 * Break opportunities come from the UAX #14 line-break classifier (soft/hard).
 * This adapter is used for backward-compat when callers pass a `TextMeasurer`
 * to APIs that now require a `TextShaper`.
 */
export function measurerToShaper(measurer: TextMeasurer): TextShaper {
  return {
    shape(text: string, style: Readonly<ComputedStyle>): ShapedRun {
      const totalWidth = text.length > 0 ? measurer.measureWidth(text, style) : 0;
      const perCharWidth = text.length > 0 ? totalWidth / text.length : 0;

      const clusters = Array.from({ length: text.length }, (_, i) => ({
        start: i,
        end: i + 1,
        inlineAdvance: perCharWidth,
        isLigature: false,
        glyphs: [text.charCodeAt(i)],
      }));

      // UAX #14 line-break opportunities (default CSS `line-break: normal`),
      // via the single-sourced `toBreakOpportunities` adapter.
      const breakOpportunities = toBreakOpportunities(text);

      const totalHeight = measurer.measureHeight(style);
      const ascent  = totalHeight * 0.8;
      const descent = totalHeight * 0.2;
      const lineGap = totalHeight - ascent - descent;

      return {
        text,
        computedStyle: style,
        clusters,
        ascent,
        descent,
        lineGap,
        minClusterInlineSize: perCharWidth,
        unbreakableRunInlineSize: totalWidth,
        breakOpportunities,
        bidiLevel: 0,
      };
    },

    measureFontMetrics(style: Readonly<ComputedStyle>): FontMetrics {
      const totalHeight = measurer.measureHeight(style);
      const ascent  = totalHeight * 0.8;
      const descent = totalHeight * 0.2;
      return {
        ascent,
        descent,
        lineGap: totalHeight - ascent - descent,
        capHeight: totalHeight * 0.7,
        xHeight:   totalHeight * 0.5,
      };
    },
  };
}

/**
 * Legacy convenience helper for tests: returns a fixed-char-width measurer
 * by adapting a mock shaper.
 */
export function createMockMeasurer(charWidth: number, lineHeight: number): TextMeasurer {
  return adaptShaperToMeasurer(createMockShaper(charWidth, lineHeight));
}
