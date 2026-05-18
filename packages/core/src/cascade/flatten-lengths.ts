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

function flattenLineHeight(v: number | ComputedLength | Length, fontSize: number): number | ComputedLength {
  if (typeof v === "number") return v;
  return flattenLength(v, fontSize);
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
