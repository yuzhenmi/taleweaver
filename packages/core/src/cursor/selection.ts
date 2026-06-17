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

/**
 * Caret affinity at a bidi run boundary (P4-C.2 §B). One logical `offset` has
 * TWO visual positions where two leaves meet (`offset == leafA.logEnd ==
 * leafB.logStart`): `"before"` draws at the leaf ENDING at the offset, `"after"`
 * (the default) at the leaf STARTING at it. On a uniform line both pick the same
 * X, so the field is inert there. Threaded from `EditorState.caretAffinity`
 * (view state — never stored in History).
 *
 * This is a pure selection-model type (a 2-value union, geometry-free) so it
 * lives here in the core selection module, NOT in the geometric (print-logical)
 * `line-bidi.ts`. `line-bidi.ts` re-exports it for its bidi/print consumers, and
 * `cursor-position.ts` re-exports it for its existing consumers.
 */
export type CaretAffinity = "before" | "after";

/** A collapsed span (a cursor — anchor === focus, no selected range). */
export function isCollapsed(span: Selection): boolean {
  return positionsEqual(span.anchor, span.focus);
}

/**
 * UNORDERED, affinity-EXCLUDED span equality — the digital controller's idempotency guard
 * (spec C5/F2). Equal iff the two spans cover the SAME endpoint PAIR, regardless of
 * anchor/focus direction: `(anchor≡anchor && focus≡focus) || (anchor≡focus && focus≡anchor)`.
 *
 * Direction-INSENSITIVE is loop-safety-critical: `selectionchange` may report anchor/focus
 * swapped vs the model; an order-sensitive compare would never short-circuit, re-dispatching
 * `SET_SELECTION` forever. Affinity is excluded because a `Span` carries none (affinity is
 * EditorState view-state, never read back from the DOM) — folding it in would likewise never
 * match the affinity-less DOM span.
 */
export function selectionsEqual(a: Selection, b: Selection): boolean {
  return (
    (positionsEqual(a.anchor, b.anchor) && positionsEqual(a.focus, b.focus)) ||
    (positionsEqual(a.anchor, b.focus) && positionsEqual(a.focus, b.anchor))
  );
}
