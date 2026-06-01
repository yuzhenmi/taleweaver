/**
 * `Selection` is unified with `Span` from `state/block-position.ts` post-P11
 * cutover. This file is the cursor-namespace re-export plus a couple of
 * small derived predicates so consumers don't hand-roll them.
 *
 * - `Selection` — re-exported alias for `Span`.
 * - `isCollapsed(span)` — true iff anchor === focus (a cursor, not an
 *   extended selection). E-B / 2026-05-23 audit centralized this: the
 *   action handlers and the dom controller previously hand-rolled
 *   the predicate at ~14 sites with two equivalent forms (anchor.blockId
 *   === focus.blockId && anchor.offset === focus.offset, OR via
 *   positionsEqual). Use this helper instead.
 *
 * For other span manipulations, use `createSpan` from
 * `state/block-position`, `spanStart` / `spanEnd` from
 * `state/block-compare`, and `positionsEqual` from `state/block-position`.
 */
import { positionsEqual } from "../state";
import type { Selection } from "../state";

export type { Selection } from "../state";

/** A collapsed span (a cursor — anchor === focus, no selected range). */
export function isCollapsed(span: Selection): boolean {
  return positionsEqual(span.anchor, span.focus);
}
