import type { ComputedStyle, Direction } from "../styles";

export type GlyphId = number;

/**
 * A grapheme cluster in a shaped run. May correspond to multiple codepoints
 * (combining marks, ligatures, emoji ZWJ sequences). The cursor lands at
 * cluster boundaries — never inside a cluster.
 */
export interface Cluster {
  /** Source-text offset range (start inclusive, end exclusive). */
  readonly start: number;
  readonly end:   number;
  /** Inline-axis advance through this cluster (px). */
  readonly inlineAdvance: number;
  /** True if this cluster spans multiple codepoints rendered as one glyph. */
  readonly isLigature: boolean;
  /** Opaque glyph IDs — passed through to the painter. */
  readonly glyphs: readonly GlyphId[];
}

/**
 * A break opportunity in a shaped run. The IFC consults these when
 * choosing line-wrap points. UAX-14 line-break-opportunity-spec is the
 * source of truth for canonical implementations.
 *
 * Plan 3.C reserves the `"hyphen"` kind; the canvas backend does not
 * produce them until a hyphenation backend is wired in (Plan 4 or later).
 */
export interface BreakOpportunity {
  /**
   * UTF-16 code-unit offset where the break can occur (break is BEFORE this
   * offset). This is a code-unit offset into the source text — aligned with the
   * state address space and `Cluster.start`/`end` — NOT a grapheme-ordinal index.
   */
  readonly clusterIndex: number;
  /**
   * The kind of break:
   *  - "hard": forced break (newline, after period if rules say so)
   *  - "soft": regular UAX-14 wrap point
   *  - "hyphen": hyphenation point — IFC inserts hyphen glyph at line end
   */
  readonly kind: "hard" | "soft" | "hyphen";
}

export interface FontMetrics {
  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;
  /** For vertical-align: text-top */
  readonly capHeight: number;
  /** For vertical-align: middle */
  readonly xHeight: number;
}

/**
 * The shaped output of one (text, style, direction) call. Logical-order
 * clusters; bidi reordering happens at line-end in the IFC.
 */
export interface ShapedRun {
  readonly text: string;
  readonly computedStyle: Readonly<ComputedStyle>;

  readonly clusters: readonly Cluster[];

  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;

  /** Widest single cluster (paragraph min-content input). */
  readonly minClusterInlineSize: number;
  /** Total run inline-size with no breaks (max-content sum input). */
  readonly unbreakableRunInlineSize: number;

  /** UAX-14 break opportunities in the run (sorted by clusterIndex). */
  readonly breakOpportunities: readonly BreakOpportunity[];

  /** 0 = LTR, 1 = RTL, etc. (Unicode Bidi Algorithm). */
  readonly bidiLevel: number;
}

export interface TextShaper {
  shape(
    text: string,
    style: Readonly<ComputedStyle>,
    baseDirection: Direction,
  ): ShapedRun;

  measureFontMetrics(style: Readonly<ComputedStyle>): FontMetrics;
}
