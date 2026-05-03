import type { Block } from "./block";
import type { BlockId } from "./block-id";
import type { PersistentMap } from "./persistent-map";

/**
 * The full document state. blocks holds the main document tree (reachable
 * from rootId via parent/child links). Embed-referenced sub-trees (footnote
 * bodies) live in a separate map added in a later phase.
 */
export interface State {
  readonly rootId: BlockId;
  readonly blocks: PersistentMap<BlockId, Block>;
}

export function createState(args: {
  rootId: BlockId;
  blocks: PersistentMap<BlockId, Block>;
}): State {
  return Object.freeze({
    rootId: args.rootId,
    blocks: args.blocks,
  });
}

/**
 * Result of every Layer 3 state-mutating operation. The dirtyIds set is
 * produced at write-time by the operation itself, not via post-hoc tree
 * comparison. The rendering pipeline consumes dirtyIds directly to know
 * which blocks need re-rendering.
 */
export interface OperationResult {
  readonly state: State;
  readonly dirtyIds: ReadonlySet<BlockId>;
}
