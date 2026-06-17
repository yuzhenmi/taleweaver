import type { ComputedStyle, UsedStyle } from "@taleweaver/core";
import type { ComputedLength, ComputedLengthOrAuto } from "@taleweaver/core";

/**
 * Resolve a `ComputedLength` to numeric pixels at layout time.
 *
 * @param value the computed-length value (number, percent, or "auto")
 * @param containingInlineSize the inline-size of the containing block in
 *   pixels. Used to resolve `percent`. For block-axis percents, the caller
 *   should pass the containing block's BLOCK-axis size; CSS allows percent
 *   block-sizes to resolve only when the containing block has a definite
 *   block-size, otherwise they fall back to `auto` (handled by caller).
 * @param fallbackForAuto the value to use when input is `"auto"`. Caller
 *   provides FC-specific fallback (block: containing inline-size; etc.).
 */
export function resolveUsedLength(
  value: ComputedLengthOrAuto,
  containingInlineSize: number,
  fallbackForAuto: number,
): number {
  if (value === "auto") return fallbackForAuto;
  if (typeof value === "number") return value;
  // percent
  return (value.value / 100) * containingInlineSize;
}

/** Resolve a `ComputedLength | "normal"` slot (letter/word-spacing). `"normal"` stays as-is. */
export function resolveUsedLengthOrNormal(
  value: ComputedLength | "normal",
  containingInlineSize: number,
): number | "normal" {
  if (value === "normal") return "normal";
  if (typeof value === "number") return value;
  return (value.value / 100) * containingInlineSize;
}

/** Resolve a `ComputedLength | "none"` slot (max-size). `"none"` → +∞. */
export function resolveUsedLengthOrNone(
  value: ComputedLength | "none",
  containingInlineSize: number,
): number {
  if (value === "none") return Number.POSITIVE_INFINITY;
  if (typeof value === "number") return value;
  return (value.value / 100) * containingInlineSize;
}

/**
 * Compute a `UsedStyle` from `ComputedStyle` and the containing block's
 * inline-size. Resolves margin/padding/border/typography to numeric values.
 * Sizing fields (inlineSize/blockSize/min-size/max-size) are NOT produced here —
 * they live on LayoutBox as the authoritative source.
 *
 * @param containingBlockSize the block-axis size of the containing block in
 *   pixels, or `"indefinite"` when the containing block has no definite
 *   block-size (e.g., the document root, or any block whose size is
 *   content-derived). Plumbed for forward-compat: in v1 all percent properties
 *   on `UsedStyle` resolve against the inline axis (CSS spec for
 *   margin/padding/textIndent in horizontal-tb), so this parameter is unused
 *   today. Future schema additions (e.g., `block-size: 50%`) will consume it.
 */
export function computeUsedStyle(
  cs: ComputedStyle,
  containingInlineSize: number,
  containingBlockSize: number | "indefinite",
  fallbackForAutoMargin: number = 0,
): UsedStyle {
  // Plan 3.D: containingBlockSize is plumbed for future block-axis-percent
  // resolution. In v1, all percent properties on UsedStyle resolve against
  // the inline axis (per CSS for margin/padding/textIndent/etc. in
  // horizontal-tb), so containingBlockSize is currently unused. Future
  // schema additions (e.g., block-size: 50%) will consume it.
  void containingBlockSize;
  return {
    display: cs.display,
    writingMode: cs.writingMode,
    direction: cs.direction,

    boxSizing: cs.boxSizing,

    marginBlockStart:  resolveUsedLength(cs.marginBlockStart,  containingInlineSize, fallbackForAutoMargin),
    marginBlockEnd:    resolveUsedLength(cs.marginBlockEnd,    containingInlineSize, fallbackForAutoMargin),
    marginInlineStart: resolveUsedLength(cs.marginInlineStart, containingInlineSize, fallbackForAutoMargin),
    marginInlineEnd:   resolveUsedLength(cs.marginInlineEnd,   containingInlineSize, fallbackForAutoMargin),

    paddingBlockStart:  resolveUsedLength(cs.paddingBlockStart,  containingInlineSize, 0),
    paddingBlockEnd:    resolveUsedLength(cs.paddingBlockEnd,    containingInlineSize, 0),
    paddingInlineStart: resolveUsedLength(cs.paddingInlineStart, containingInlineSize, 0),
    paddingInlineEnd:   resolveUsedLength(cs.paddingInlineEnd,   containingInlineSize, 0),

    borderBlockStartWidth:  cs.borderBlockStartWidth,
    borderBlockEndWidth:    cs.borderBlockEndWidth,
    borderInlineStartWidth: cs.borderInlineStartWidth,
    borderInlineEndWidth:   cs.borderInlineEndWidth,
    borderBlockStartStyle:  cs.borderBlockStartStyle,
    borderBlockEndStyle:    cs.borderBlockEndStyle,
    borderInlineStartStyle: cs.borderInlineStartStyle,
    borderInlineEndStyle:   cs.borderInlineEndStyle,
    borderBlockStartColor:  cs.borderBlockStartColor,
    borderBlockEndColor:    cs.borderBlockEndColor,
    borderInlineStartColor: cs.borderInlineStartColor,
    borderInlineEndColor:   cs.borderInlineEndColor,

    backgroundColor: cs.backgroundColor,

    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    underline: cs.underline,
    lineThrough: cs.lineThrough,
    // C-B (#166): line-height resolution per CSS Inline Layout.
    //   - unitless number → ratio × own fontSize (the most common author form).
    //   - percent ComputedLength → resolve against OWN fontSize, NOT the
    //     containing-block inline size. This corrects a long-standing
    //     bug where `resolveUsedLength(cs.lineHeight, containingInlineSize, 0)`
    //     would treat `lineHeight: 150%` as 150% of the page width.
    //   - bare px (post-flatten ComputedLength other than percent): pass
    //     through. Currently unreachable under the C-B input restriction —
    //     cascade refuses px line-height — but kept as a safety branch.
    lineHeight:
      typeof cs.lineHeight === "number"
        ? cs.lineHeight * cs.fontSize
        : cs.lineHeight.unit === "percent"
          ? (cs.lineHeight.value / 100) * cs.fontSize
          : cs.lineHeight.value,
    color: cs.color,

    whiteSpace: cs.whiteSpace,
    verticalAlign: cs.verticalAlign,

    textAlign: cs.textAlign,
    textIndent: resolveUsedLength(cs.textIndent, containingInlineSize, 0),
    textWrap: cs.textWrap,
    hyphens: cs.hyphens,
    language: cs.language,
    hyphenateLimitChars: cs.hyphenateLimitChars,
    overflowWrap: cs.overflowWrap,
    letterSpacing: resolveUsedLengthOrNormal(cs.letterSpacing, containingInlineSize),
    wordSpacing: resolveUsedLengthOrNormal(cs.wordSpacing, containingInlineSize),
    textTransform: cs.textTransform,
    fontFeatureSettings: cs.fontFeatureSettings,
    tabStops: cs.tabStops,
    defaultTabStop: cs.defaultTabStop,

    float: cs.float,
    clear: cs.clear,

    breakBefore: cs.breakBefore,
    breakAfter: cs.breakAfter,
    breakInside: cs.breakInside,

    widows: cs.widows,
    orphans: cs.orphans,

    listStyleType: cs.listStyleType,
    listStylePosition: cs.listStylePosition,
  };
}
