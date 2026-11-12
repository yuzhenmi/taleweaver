/**
 * The end-decoration reserve a box inherits for its LAST in-flow child (bfc
 * and fit-core in lockstep; carried on `FragmentationContext`). If that child
 * completes on this fragmentainer, the ancestors that complete with it must
 * still fit: their end padding + border, plus any end margin enclosed by one
 * of them. A margin that collapses through to the break truncates (CSS
 * Fragmentation §5.2) and is never reserved.
 */
export interface CompleteReserve {
  /** End decorations (and enclosed margins) of the completing ancestors. */
  readonly reserve: number;
  /** The pending end margin: enclosed by a completing ancestor, or collapsing through. */
  readonly margin: number;
  /** True when a completing ancestor's end decoration encloses `margin`. */
  readonly enclosed: boolean;
}

export const NO_RESERVE: CompleteReserve = { reserve: 0, margin: 0, enclosed: false };

/** The space a completing box must leave after its content. */
export function reserveTotal(r: CompleteReserve): number {
  return r.reserve + (r.enclosed ? r.margin : 0);
}

/**
 * The reserve a box (`parent`, with block-end decoration `parentEndDeco`)
 * hands its last in-flow child whose end margin is `childMarginEnd`. A
 * decorated end bounds the margins: the parent's pending enclosed margin and
 * its decoration become reserve, the child's margin is now enclosed. An
 * undecorated end passes the parent's reserve on unchanged.
 */
export function lastChildReserve(parent: CompleteReserve, parentEndDeco: number, childMarginEnd: number): CompleteReserve {
  return parentEndDeco > 0
    ? { reserve: reserveTotal(parent) + parentEndDeco, margin: childMarginEnd, enclosed: true }
    // ponytail: the engine drops a last child's end margin at a box with no end
    // decoration (bfc `noBottomBoundary`, a CSS 8.3.1 gap), so it is not
    // reserved; when BM5 makes it collapse through, this becomes
    // `{ ...parent, margin: Math.max(childMarginEnd, parent.margin) }`.
    : parent;
}
