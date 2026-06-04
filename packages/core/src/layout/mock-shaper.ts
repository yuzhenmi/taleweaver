import type { ComputedStyle } from "../styles";
import type { Direction } from "../styles/writing-mode";
import type {
  TextShaper, ShapedRun, Cluster, BreakOpportunity, FontMetrics,
} from "./text-shaper";

/**
 * Shared break-opportunity logic for the mock shapers: hard break at `\n`/`\r`;
 * soft break before any whitespace cluster past index 0. Sorted by clusterIndex.
 * Kept in one place so the fixed-width and variable-width mocks can't drift.
 */
function computeBreakOpportunities(text: string): BreakOpportunity[] {
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
  return breakOpportunities;
}

/**
 * Mock shaper for tests: each codepoint is one cluster of fixed width;
 * soft breaks at whitespace; hard breaks at \n / \r.
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
    const clusters: Cluster[] = [];
    for (let i = 0; i < text.length; i++) {
      clusters.push({
        start: i,
        end:   i + 1,
        inlineAdvance: charWidth,
        isLigature:    false,
        glyphs: [text.charCodeAt(i)],
      });
    }

    const breakOpportunities = computeBreakOpportunities(text);

    return {
      text,
      computedStyle: style,
      clusters,
      ascent:  fontMetrics.ascent,
      descent: fontMetrics.descent,
      lineGap: fontMetrics.lineGap,
      minClusterInlineSize:     text.length === 0 ? 0 : charWidth,
      unbreakableRunInlineSize: text.length * charWidth,
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
 * Variable-width mock shaper for tests: each codepoint is one cluster whose
 * width is looked up per character via `widthByChar` (defaulting to
 * `defaultWidth` for chars not in the map). Unlike `createMockShaper` (uniform
 * cluster widths), this lets a test produce a run whose FIRST cluster is not
 * the widest — exercising the `restMin` form of the text-indent intrinsic rule
 * (which `widestCluster + indent` would get wrong).
 *
 * Soft breaks at whitespace; hard breaks at \n / \r (same as createMockShaper).
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
    const clusters: Cluster[] = [];
    let total = 0;
    let widest = 0;
    for (let i = 0; i < text.length; i++) {
      const w = widthOf(text[i]);
      clusters.push({
        start: i,
        end:   i + 1,
        inlineAdvance: w,
        isLigature:    false,
        glyphs: [text.charCodeAt(i)],
      });
      total += w;
      if (w > widest) widest = w;
    }

    const breakOpportunities = computeBreakOpportunities(text);

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
