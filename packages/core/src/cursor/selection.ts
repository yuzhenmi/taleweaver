/**
 * `Selection` is unified with `Span` from `state/block-position.ts` post-P11
 * cutover. This file is a tiny re-export under the cursor namespace for
 * consumers that import `Selection` from `cursor/selection` historically.
 *
 * The legacy file (with `createSelection`, `createCursor`, `isCollapsed`,
 * `selectionStart`, `selectionEnd` helpers) was deleted; consumers should
 * use `createSpan` from `state/block-position`, `spanStart` / `spanEnd`
 * from `state/block-compare`, and inline-check the collapsed predicate
 * (anchor.blockId === focus.blockId && anchor.offset === focus.offset).
 */
export type { Selection } from "../state/block-position";
