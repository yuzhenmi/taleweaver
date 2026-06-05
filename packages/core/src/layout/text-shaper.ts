import type { ComputedStyle, Direction } from "../styles";
import { lineBreakOpportunities, type LineBreakOptions } from "./uax14";

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
 * choosing line-wrap points. The `"soft"` and `"hard"` kinds are produced by
 * the conformant UAX #14 line-break classifier (both the mock and canvas
 * backends call it). The `"hyphen"` kind remains reserved for a future
 * hyphenation backend — no backend produces it yet.
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

/**
 * Canonical adapter from the UAX #14 classifier's `LineBreakPoint[]` to the
 * shaper's `BreakOpportunity[]`. Single-sources the conversion so every shaper
 * backend (mock, canvas, and the legacy measurer adapter) produces identical
 * break kinds: the classifier's mandatory breaks become `"hard"`, the rest
 * `"soft"`. `clusterIndex` is the UTF-16 code-unit offset (break is BEFORE it).
 * The `"hyphen"` kind is never produced here — it comes from a hyphenation
 * backend, which is not yet wired.
 *
 * Defaults to `cjBreakable: true` (CSS `line-break: normal` — the editor
 * default, CJ small-kana breakable). Pass `options` to select a different
 * `line-break` mode.
 */
export function toBreakOpportunities(
  text: string,
  options: LineBreakOptions = { cjBreakable: true },
): BreakOpportunity[] {
  return lineBreakOpportunities(text, options).map((p): BreakOpportunity => ({
    clusterIndex: p.index,
    kind: p.mandatory ? "hard" : "soft",
  }));
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
