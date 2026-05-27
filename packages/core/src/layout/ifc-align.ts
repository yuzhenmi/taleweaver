import type { TextAlign } from "../styles";
import type { Direction } from "../styles/writing-mode";

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
      // P2: behaves as start. P3 implements inter-word distribution.
      return 0;
    case "start":
    default:
      return 0;
  }
}
