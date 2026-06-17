import type { State } from "../state/state";
import { resolveBlock } from "../state/state";
import type { BlockId } from "../state/block-id";
import type { BlockParentLookup } from "../state/block-parent-lookup-type";

/**
 * Build the layout layer's parent-lookup capability from editor `State`. Unknown
 * ids return `null` (NOT a throw) — `resolveBlock` returns `null` for an unknown
 * id, matching the guard in resolveNestedMainTreeBlockPage (cursor-position.ts).
 */
export function makeBlockParentLookup(state: State): BlockParentLookup {
  return (id: BlockId) => resolveBlock(state, id)?.block.parentId ?? null;
}
