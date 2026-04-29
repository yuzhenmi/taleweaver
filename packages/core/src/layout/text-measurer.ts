import type { ComputedStyle } from "../styles";
import type { TextShaper } from "./text-shaper";
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

/**
 * Legacy convenience helper for tests: returns a fixed-char-width measurer
 * by adapting a mock shaper.
 */
export function createMockMeasurer(charWidth: number, lineHeight: number): TextMeasurer {
  return adaptShaperToMeasurer(createMockShaper(charWidth, lineHeight));
}
