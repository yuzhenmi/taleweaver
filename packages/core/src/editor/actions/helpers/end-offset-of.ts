import { inlineContentLength, resolveBlock } from "../../../state";
import type { BlockId, Document } from "../../../state";

/**
 * The end (last) offset of `blockId` — its inline-content length, or 0 for a
 * container leaf with no inline content. Resolved tree-aware via `resolveBlock`
 * so a footnote/header/footer body block is read from its own tree. Returns null
 * if the block is unresolvable.
 */
export function endOffsetOf(document: Document, blockId: BlockId): number | null {
  const resolved = resolveBlock(document, blockId);
  if (resolved === null) return null;
  return resolved.block.inlineContent === null
    ? 0
    : inlineContentLength(resolved.block.inlineContent);
}
