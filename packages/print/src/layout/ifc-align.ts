import type { TextAlign } from "@taleweaver/core";
import type { Direction } from "@taleweaver/core";

/**
 * Compute the LOGICAL inline-axis offset to ADD to a line's `lineInlineCursor`
 * (the line's logical inline-start position) so its content is aligned per
 * `textAlign` within the line's available inline size.
 *
 * The result is a LOGICAL inline-start delta — the distance from the line's
 * inline-start edge. The physical left/right resolution is handled downstream
 * by `logicalToPhysical` (the box factory mirrors the inline axis under RTL).
 * So:
 *   - start → 0      (content stays at the inline-start edge)
 *   - end   → gap    (content pushed to the inline-end edge)
 *   - center → gap/2 (content centered)
 *   - justify → 0    (P2: start-equivalent; P3 implements distribution)
 *
 * This is direction-INDEPENDENT in the logical inline axis. The `direction`
 * argument is retained for the pure-function contract (and a future content-
 * sized line-box model where alignment is resolved physically), but in the
 * current line-box model the inline-start delta is the same for ltr and rtl —
 * `logicalToPhysical` flips it to the correct physical edge. This keeps
 * untouched (start-aligned) content byte-identical under both directions.
 *
 * @param lineInlineSize available inline width of the line (float-adjusted).
 * @param contentWidth   laid-out content width, trailing whitespace already
 *                       excluded by the caller.
 * @param textAlign      the block's resolved `textAlign`.
 * @param direction      the inline base direction (reserved; see above).
 * @returns a non-negative offset; 0 when content fills (or overflows) the line.
 */
export function computeAlignmentOffset(
  lineInlineSize: number,
  contentWidth: number,
  textAlign: TextAlign,
  _direction: Direction,
): number {
  const gap = Math.max(0, lineInlineSize - contentWidth);
  if (gap === 0) return 0;
  switch (textAlign) {
    case "center":
      return gap / 2;
    case "end":
      return gap;
    case "justify":
      // Justify does NOT shift the line; it widens interior inter-word spaces
      // (see `computeJustifyExpansions`). The line's inline-start stays at the
      // float-start, so the alignment offset is 0.
      return 0;
    case "start":
    default:
      return 0;
  }
}

/**
 * P3 — distribute a justification `gap` across `spaceCount` interior inter-word
 * spaces. Returns a per-space added width whose SUM is EXACTLY the non-negative
 * clamped gap (no sub-pixel drift). Each space starts at `floor(gap / N)`; the
 * integer remainder `floor(gap) − floor(gap/N)·N` is spread one whole unit at a
 * time across the LEADING spaces, and a final RECONCILIATION step folds any
 * residual (whole or fractional) into the FIRST space so the array sum equals
 * the clamped gap exactly. The remainder therefore always lands on the leading
 * spaces, so `out[0] >= out[last]`.
 *
 * "Exactly" matters: a naive `gap / N` per space accumulates floating-point
 * error so the last glyph misses the right edge by a fraction of a pixel on
 * some line widths. The reconciliation guarantees the last non-trailing glyph's
 * right edge == lineInlineSize regardless of floating-point rounding — including
 * fractional gaps that are near-integer multiples of `spaceCount`, where an
 * epsilon-based remainder count could otherwise over- or under-distribute.
 *
 * The mock-shaper / integral-advance fonts used in tests give an integer `gap`;
 * real fractional advances still sum exactly because the reconciliation corrects
 * the first element by the measured `clampedGap − actualSum` difference.
 *
 * @param gap        non-negative slack to fill (`lineInlineSize − contentWidth`).
 *                   A negative gap (content overflows) clamps to all-zero.
 * @param spaceCount number of INTERIOR inter-word spaces to widen.
 * @returns an array of length `spaceCount`; `[]` when `spaceCount === 0`.
 */
export function computeJustifyExpansions(gap: number, spaceCount: number): number[] {
  if (spaceCount <= 0) return [];
  const clampedGap = Math.max(0, gap);
  const base = Math.floor(clampedGap / spaceCount);
  // Whole-unit remainder distributed across the LEADING spaces (integer-gap
  // case). For fractional gaps this captures the whole part; the fractional
  // leftover is absorbed by the reconciliation below.
  const wholeRemainder = Math.floor(clampedGap) - base * spaceCount;
  const out = new Array<number>(spaceCount);
  for (let i = 0; i < spaceCount; i++) {
    out[i] = i < wholeRemainder ? base + 1 : base;
  }
  // RECONCILIATION: fold the exact residual into the first space so the array
  // sum is EXACTLY clampedGap, independent of floating-point rounding in the
  // base/remainder arithmetic. This is the load-bearing exactness guarantee.
  const actualSum = out.reduce((s, v) => s + v, 0);
  // `spaceCount > 0` (guarded above) ⇒ `out` has length ≥ 1, so `out[0]` is
  // always present; the throw is unreachable and documents the invariant.
  if (actualSum !== clampedGap) {
    const first = out[0];
    if (first === undefined) throw new Error("ifc-align: empty expansions array (unreachable)");
    out[0] = first + (clampedGap - actualSum);
  }
  return out;
}
