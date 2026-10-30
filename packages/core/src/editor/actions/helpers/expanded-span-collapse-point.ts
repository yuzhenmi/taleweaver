import { resolveBlock, deleteRangeSeam } from "../../../state";
import type { State, Span, Position } from "../../../state";

/**
 * Resolve the collapse point for an expanded (non-collapsed) selection that is
 * about to be deleted/replaced, applying the deletable-span guard shared by
 * DELETE_BACKWARD, DELETE_FORWARD, and SPLIT_NODE.
 *
 * Returns the seam a DIRECT `deleteRange` of the span leaves — the position the
 * caret collapses to after the delete (`deleteRangeSeam`: a cross-block delete
 * removes the crossed ¶s and the END block survives; an object endpoint is removed
 * whole and has no text side) — when the span is deletable, or `null` when the
 * caller must REFUSE (no-op). (A suggesting soft-delete removes nothing: its caret
 * is the clipped span's start / end — `clipSpanToText`.)
 *
 * The span is refused when:
 *   - either endpoint's block does not resolve, OR
 *   - both endpoints are objects and no text block follows the span, OR
 *   - the endpoints live in different blocks AND those blocks have different
 *     parents (a cross-parent span — `deleteRange` throws on it).
 *
 * `resolveBlock` (main → embed → template) is used so a header/footer caret
 * resolves; for a main-tree id the behavior is byte-identical (resolveBlock's
 * first arm is `getBlock`).
 *
 * NOTE: the cross-CONTEXT guard (`isCrossContextSelection`) is SEPARATE and
 * must be checked first at each call site — it catches cross-tree spans whose
 * blocks would otherwise both resolve here. Keeping the two distinct preserves
 * each guard's rationale and the exact refusal order (both just `return
 * editor`, so the order is not observable).
 */
export function expandedSpanCollapsePoint(
  state: State,
  span: Span,
): Position | null {
  const anchorBlock = resolveBlock(state, span.anchor.blockId)?.block ?? null;
  const focusBlock = resolveBlock(state, span.focus.blockId)?.block ?? null;
  if (anchorBlock === null || focusBlock === null) return null;
  // deleteRange throws on cross-parent — refuse with no-op if so.
  if (
    span.anchor.blockId !== span.focus.blockId &&
    anchorBlock.parentId !== focusBlock.parentId
  ) {
    return null;
  }
  return deleteRangeSeam(state, span);
}
