import type { Document } from "../state/document";
import { resolveBlock } from "../state/document";
import type { BlockId } from "../state/block-id";
import type { BlockParentLookup } from "../state/block-parent-lookup-type";

/**
 * Build the layout layer's parent-lookup capability from editor `Document`. Unknown
 * ids return `null` (NOT a throw) — `resolveBlock` returns `null` for an unknown
 * id, matching the guard in resolveNestedMainTreeBlockPage (cursor-position.ts).
 */
export function makeBlockParentLookup(document: Document): BlockParentLookup {
  return (id: BlockId) => resolveBlock(document, id)?.block.parentId ?? null;
}
