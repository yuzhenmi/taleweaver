import type { State, BlockId } from "../state";

/**
 * One document change: the Document it was made from and its raw dirty set, linked to the
 * change before it (`prior`) so a consumer that missed intermediate states (a host that
 * batches dispatches) can still compose the mappings across them. The chain is bounded:
 * `depth` counts it, and `recordChange` trims it once it grows past
 * {@link MAX_CHANGE_CHAIN} (older changes are then unknown, so mapping across that many
 * batched changes degrades to "unknown").
 */
export interface DocumentChange {
  readonly from: State;
  readonly dirtyIds: ReadonlySet<BlockId>;
  readonly prior: DocumentChange | null;
  readonly depth: number;
}

/** Changes kept reachable through `lastChange.prior` (trimmed to half when exceeded). */
export const MAX_CHANGE_CHAIN = 128;

/** Extend `prior` with a new change, trimming the chain when it grows too long (amortized O(1)). */
export function recordChange(prior: DocumentChange | null, from: State, dirtyIds: ReadonlySet<BlockId>): DocumentChange {
  let base = prior;
  if (base !== null && base.depth >= MAX_CHANGE_CHAIN) {
    // Rebuild the most recent half of the chain (copying MAX/2 nodes once per MAX/2 changes).
    const keep: DocumentChange[] = [];
    for (let c: DocumentChange | null = base; c !== null && keep.length < MAX_CHANGE_CHAIN / 2; c = c.prior) keep.push(c);
    base = keep.reduceRight<DocumentChange | null>(
      (acc, c) => ({ from: c.from, dirtyIds: c.dirtyIds, prior: acc, depth: (acc?.depth ?? 0) + 1 }),
      null,
    );
  }
  return { from, dirtyIds, prior: base, depth: (base?.depth ?? 0) + 1 };
}
