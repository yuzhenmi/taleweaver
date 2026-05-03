import type { State } from "./state";
import type { Span } from "./block-position";
import { createSpan } from "./block-position";
import { comparePositions, selectionContextOf } from "./block-compare";

/**
 * Normalize a span so anchor comes before focus in document order.
 * If already normalized, returns the same Span object reference.
 *
 * Precondition: anchor and focus must be in the same selection context.
 * comparePositions throws via compareBlocksInDocOrder if they have no
 * common ancestor (different roots).
 */
export function normalizeSpan(state: State, span: Span): Span {
  if (comparePositions(state, span.anchor, span.focus) <= 0) return span;
  return createSpan(span.focus, span.anchor);
}
