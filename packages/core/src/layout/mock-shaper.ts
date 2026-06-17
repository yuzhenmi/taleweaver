import type { ComputedStyle } from "../styles";
import type { Direction } from "../styles/writing-mode";
import type {
  TextShaper, ShapedRun, Cluster, FontMetrics,
} from "./text-shaper";
import { toBreakOpportunities } from "./text-shaper";
import { resolveSpacingPx, clusterSpacing } from "./text-spacing";
import { graphemeClusters } from "./graphemes";

/**
 * Mock shaper for tests: each UAX #29 grapheme cluster is one cluster of fixed
 * width; break opportunities from the UAX #14 classifier (soft/hard).
 */
export function createMockShaper(charWidth: number, lineHeight: number): TextShaper {
  const ascent  = lineHeight * 0.8;
  const descent = lineHeight * 0.2;
  const fontMetrics: FontMetrics = {
    ascent,
    descent,
    // Ensure ascent + descent + lineGap === lineHeight exactly (no fp drift).
    lineGap: lineHeight - ascent - descent,
    capHeight: lineHeight * 0.7,
    xHeight:   lineHeight * 0.5,
  };

  function shape(
    text: string,
    style: Readonly<ComputedStyle>,
    baseDirection: Direction,
  ): ShapedRun {
    const letterPx = resolveSpacingPx(style.letterSpacing);
    const wordPx   = resolveSpacingPx(style.wordSpacing);
    const clusters: Cluster[] = [];
    let total = 0;
    let widest = 0;
    let start = 0;
    for (const g of graphemeClusters(text)) {
      // One BASE width per grapheme (not per code unit) + per-cluster spacing.
      // Single-code-unit graphemes (ASCII/BMP) keep `charWidth + clusterSpacing(g)`,
      // byte-identical to the old per-code-unit path.
      //
      // U+00AD SOFT HYPHEN is a zero-advance format char (Cf): it renders nothing
      // and adds no width unless it is the chosen line-end break, where the IFC
      // shapes a "-" glyph separately. Real shapers zero default-ignorable Cf
      // chars; matching that here makes a word measure the same with or without
      // its embedded soft hyphens (hyphenation slice 1).
      const adv = g === "­" ? 0 : charWidth + clusterSpacing(g, letterPx, wordPx);
      clusters.push({
        start,
        end:   start + g.length,
        inlineAdvance: adv,
        isLigature:    false,
        glyphs: [g.charCodeAt(0)],
      });
      total += adv;
      if (adv > widest) widest = adv;
      start += g.length;
    }

    const breakOpportunities = toBreakOpportunities(text);

    return {
      text,
      computedStyle: style,
      clusters,
      ascent:  fontMetrics.ascent,
      descent: fontMetrics.descent,
      lineGap: fontMetrics.lineGap,
      minClusterInlineSize:     text.length === 0 ? 0 : widest,
      unbreakableRunInlineSize: total,
      breakOpportunities,
      bidiLevel: baseDirection === "rtl" ? 1 : 0,
    };
  }

  function measureFontMetrics(_style: Readonly<ComputedStyle>): FontMetrics {
    return fontMetrics;
  }

  return { shape, measureFontMetrics };
}

/**
 * Variable-width mock shaper for tests: each UAX #29 grapheme cluster is one
 * cluster whose width is looked up via `widthByChar` keyed by the grapheme's
 * first code unit (defaulting to `defaultWidth` for chars not in the map; a
 * multi-code-unit grapheme's first unit is a lone high surrogate → default).
 * Unlike `createMockShaper` (uniform
 * cluster widths), this lets a test produce a run whose FIRST cluster is not
 * the widest — exercising the `restMin` form of the text-indent intrinsic rule
 * (which `widestCluster + indent` would get wrong).
 *
 * Break opportunities from the UAX #14 classifier (same as createMockShaper).
 */
export function createVariableMockShaper(
  widthByChar: Readonly<Record<string, number>>,
  lineHeight: number,
  defaultWidth = 0,
): TextShaper {
  const ascent  = lineHeight * 0.8;
  const descent = lineHeight * 0.2;
  const fontMetrics: FontMetrics = {
    ascent,
    descent,
    lineGap: lineHeight - ascent - descent,
    capHeight: lineHeight * 0.7,
    xHeight:   lineHeight * 0.5,
  };

  const widthOf = (ch: string): number => widthByChar[ch] ?? defaultWidth;

  function shape(
    text: string,
    style: Readonly<ComputedStyle>,
    baseDirection: Direction,
  ): ShapedRun {
    const letterPx = resolveSpacingPx(style.letterSpacing);
    const wordPx   = resolveSpacingPx(style.wordSpacing);
    const clusters: Cluster[] = [];
    let total = 0;
    let widest = 0;
    let start = 0;
    for (const g of graphemeClusters(text)) {
      // widthByChar keys are single UTF-16 code units; a multi-code-unit grapheme's
      // g[0] is its first code unit (a lone high surrogate for astral graphemes) and
      // falls to defaultWidth — the map cannot encode grapheme-string keys (S1 ok).
      // U+00AD SOFT HYPHEN is a zero-advance format char (see createMockShaper).
      // `graphemeClusters` only yields nonempty clusters, so `g[0]` is always a
      // defined code unit; `?? ""` is an unreachable, behavior-preserving
      // default (`widthOf("")` → `widthByChar[""] ?? defaultWidth` = defaultWidth,
      // matching the lone-surrogate/unknown-key path the cluster would already hit).
      const adv = g === "­" ? 0 : widthOf(g[0] ?? "") + clusterSpacing(g, letterPx, wordPx);
      clusters.push({
        start,
        end:   start + g.length,
        inlineAdvance: adv,
        isLigature:    false,
        glyphs: [g.charCodeAt(0)],
      });
      total += adv;
      if (adv > widest) widest = adv;
      start += g.length;
    }

    const breakOpportunities = toBreakOpportunities(text);

    return {
      text,
      computedStyle: style,
      clusters,
      ascent:  fontMetrics.ascent,
      descent: fontMetrics.descent,
      lineGap: fontMetrics.lineGap,
      minClusterInlineSize:     text.length === 0 ? 0 : widest,
      unbreakableRunInlineSize: total,
      breakOpportunities,
      bidiLevel: baseDirection === "rtl" ? 1 : 0,
    };
  }

  function measureFontMetrics(_style: Readonly<ComputedStyle>): FontMetrics {
    return fontMetrics;
  }

  return { shape, measureFontMetrics };
}
