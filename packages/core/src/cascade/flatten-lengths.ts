import type { ComputedStyle } from "../styles";
import type { Length, ComputedLength, ComputedLengthOrAuto, IntrinsicSizingKeyword } from "../styles/length";
import { INITIAL_COMPUTED_STYLE } from "../styles/property-meta";
import { resolveLength } from "./resolve-length";

/**
 * Resolve em-relative lengths to px using the style's own fontSize, then
 * propagate the resolved fontSize back into the returned ComputedStyle.
 * Percent values pass through (cascade has no container width here);
 * intrinsic sizing keywords (`min-content`, etc.) pass through.
 *
 * Used by both the legacy renderer (via `cascadePass`) and the new
 * renderer (per Decisions B / G).
 */
export function flattenLengths(cs: ComputedStyle): ComputedStyle {
  // 1. Resolve fontSize first — needed by all subsequent em-resolutions.
  const fontSize = resolveFontSize(cs);

  // 2. Build a new computed style with em-resolved lengths.
  return {
    ...cs,
    fontSize,
    inlineSize:    flattenSizingValue(cs.inlineSize, fontSize),
    blockSize:     flattenSizingValue(cs.blockSize, fontSize),
    minInlineSize: flattenSizingOrIntrinsic(cs.minInlineSize, fontSize),
    minBlockSize:  flattenSizingOrIntrinsic(cs.minBlockSize, fontSize),
    maxInlineSize: flattenSizingOrNone(cs.maxInlineSize, fontSize),
    maxBlockSize:  flattenSizingOrNone(cs.maxBlockSize, fontSize),

    marginBlockStart:  flattenLengthOrAuto(cs.marginBlockStart, fontSize),
    marginBlockEnd:    flattenLengthOrAuto(cs.marginBlockEnd, fontSize),
    marginInlineStart: flattenLengthOrAuto(cs.marginInlineStart, fontSize),
    marginInlineEnd:   flattenLengthOrAuto(cs.marginInlineEnd, fontSize),

    paddingBlockStart:  flattenLength(cs.paddingBlockStart, fontSize),
    paddingBlockEnd:    flattenLength(cs.paddingBlockEnd, fontSize),
    paddingInlineStart: flattenLength(cs.paddingInlineStart, fontSize),
    paddingInlineEnd:   flattenLength(cs.paddingInlineEnd, fontSize),

    lineHeight: flattenLineHeight(cs.lineHeight, fontSize),

    letterSpacing: flattenLengthOrNormal(cs.letterSpacing, fontSize),
    wordSpacing:   flattenLengthOrNormal(cs.wordSpacing, fontSize),
    textIndent:    flattenLength(cs.textIndent, fontSize),

    // Positioning insets — `LengthOrAuto`, flattened exactly like margins
    // (em→px against own fontSize; percent stays symbolic; auto passes
    // through). Use-site resolution against the containing block happens in
    // later positioning slices, NOT here.
    insetBlockStart:  flattenLengthOrAuto(cs.insetBlockStart, fontSize),
    insetBlockEnd:    flattenLengthOrAuto(cs.insetBlockEnd, fontSize),
    insetInlineStart: flattenLengthOrAuto(cs.insetInlineStart, fontSize),
    insetInlineEnd:   flattenLengthOrAuto(cs.insetInlineEnd, fontSize),
  };
}

function isIntrinsicKeyword(v: unknown): v is IntrinsicSizingKeyword {
  return v === "min-content" || v === "max-content" || v === "fit-content";
}

function flattenLength(v: ComputedLength | Length, fontSize: number): ComputedLength {
  if (typeof v === "number") return v;
  if (v.unit === "percent") return v;
  if (v.unit === "px") return v.value;
  // unit === "em" — should not appear in ComputedStyle inputs, but handle defensively
  return resolveLength(v as Length, fontSize);
}

function flattenLengthOrAuto(v: ComputedLengthOrAuto | Length | "auto", fontSize: number): ComputedLengthOrAuto {
  if (v === "auto") return "auto";
  return flattenLength(v, fontSize);
}

/** Pass through the "normal" keyword (letter-spacing, word-spacing); otherwise flatten as Length. */
function flattenLengthOrNormal(
  v: ComputedLength | Length | "normal",
  fontSize: number,
): ComputedLength | "normal" {
  if (v === "normal") return "normal";
  return flattenLength(v, fontSize);
}

/** Pass through intrinsic keywords; otherwise flatten as LengthOrAuto. */
function flattenSizingValue(
  v: ComputedLengthOrAuto | Length | "auto" | IntrinsicSizingKeyword,
  fontSize: number,
): ComputedLengthOrAuto | IntrinsicSizingKeyword {
  if (isIntrinsicKeyword(v)) return v;
  return flattenLengthOrAuto(v, fontSize);
}

/** Pass through intrinsic keywords; otherwise flatten as Length (for min-* sizing). */
function flattenSizingOrIntrinsic(
  v: ComputedLength | Length | IntrinsicSizingKeyword,
  fontSize: number,
): ComputedLength | IntrinsicSizingKeyword {
  if (isIntrinsicKeyword(v)) return v;
  return flattenLength(v, fontSize);
}

/** Pass through intrinsic keywords and "none"; otherwise flatten as Length (for max-* sizing). */
function flattenSizingOrNone(
  v: ComputedLength | Length | "none" | IntrinsicSizingKeyword,
  fontSize: number,
): ComputedLength | "none" | IntrinsicSizingKeyword {
  if (v === "none") return "none";
  if (isIntrinsicKeyword(v)) return v;
  return flattenLength(v, fontSize);
}

/**
 * Flatten a `lineHeight` value per CSS Inline Layout semantics, restricted
 * to the input forms a word-processor engine supports (per the C-B
 * decision in 2026-05-23-line-height-disambiguation-design.md):
 *
 * - **unitless `number`**: passes through. This is a RATIO of the
 *   element's own fontSize; the ratio is the COMPUTED value and
 *   inherits as a ratio. Used-value resolution (in layout) multiplies
 *   by own fontSize.
 * - **em `Length`**: converts to a unitless ratio of the same value.
 *   Per CSS, `1.5em` line-height semantically equals "multiply by own
 *   fontSize" — the same as a unitless ratio of `1.5`. Treating em as
 *   syntactic sugar for unitless is spec-faithful (and the only way
 *   to preserve the inherit-as-ratio property since em resolution at
 *   cascade time would collapse to plain px and lose the ratio
 *   semantics).
 * - **percent `ComputedLength`**: passes through. Used-value resolves
 *   percent against own fontSize (NOT containing-block).
 * - **px `Length`**: NOT SUPPORTED. Document authors don't use px
 *   line-height; the engine restricts the input vocabulary to keep
 *   the ComputedStyle.lineHeight type unambiguous (a plain number
 *   always means a unitless ratio, never a literal px). Dev mode
 *   warns; production falls back to the initial unitless ratio.
 */
function flattenLineHeight(v: number | ComputedLength | Length, fontSize: number): number | ComputedLength {
  if (typeof v === "number") return v;
  if (v.unit === "em") return v.value;
  if (v.unit === "percent") return v;
  // unit === "px" — unsupported under the C-B input restriction.
  // Warn in dev so authors who hit this notice; production silently falls
  // back to the initial unitless ratio. The `process` and `console`
  // globals are read defensively because the engine compiles for
  // browsers (no Node `process` is guaranteed; `console` is normally
  // there but typed as the lib's `console` interface).
  const g = globalThis as {
    process?: { env?: { NODE_ENV?: string } };
    console?: { warn(...args: unknown[]): void };
  };
  const isDev = g.process?.env?.NODE_ENV !== "production";
  if (isDev && g.console !== undefined) {
    g.console.warn(
      `flattenLineHeight: px-specified lineHeight is not supported (got ${JSON.stringify(v)}); ` +
      `falling back to the initial unitless ratio. Use a unitless ratio (e.g. 1.5) or percent instead.`,
    );
  }
  // fontSize is unused on this branch — kept in the signature for parallelism
  // with the other helpers.
  void fontSize;
  return INITIAL_COMPUTED_STYLE.lineHeight;
}

function resolveFontSize(cs: ComputedStyle): number {
  const v: unknown = cs.fontSize;

  if (typeof v === "number") return v;

  // Composition may produce Length object values before flattening.
  // Type-guard the shape to safely access properties without unsafe casts.
  if (typeof v === "object" && v !== null && "unit" in v) {
    const lv = v as { unit: string; value: number };
    if (lv.unit === "px") return lv.value;
    if (lv.unit === "em") {
      // Document root case: no parent fontSize, use the initial.
      return lv.value * INITIAL_COMPUTED_STYLE.fontSize;
    }
  }

  return INITIAL_COMPUTED_STYLE.fontSize;
}
