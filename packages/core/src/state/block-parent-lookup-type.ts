import type { BlockId } from "./block-id";

/**
 * Maps a block id to its parent block id (or `null` for a root). A pure
 * structural query over the document tree — core-logical, NOT layout geometry.
 * Lives in `state/` so editor + layout both import it without an editor→layout
 * edge (the factory `makeBlockParentLookup` builds one from `State`).
 */
export type BlockParentLookup = (blockId: BlockId) => BlockId | null;
