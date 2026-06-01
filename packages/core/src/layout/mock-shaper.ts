import type { ComputedStyle } from "../styles";
import type { Direction } from "../styles/writing-mode";
import type {
  TextShaper, ShapedRun, Cluster, BreakOpportunity, FontMetrics,
} from "./text-shaper";

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
