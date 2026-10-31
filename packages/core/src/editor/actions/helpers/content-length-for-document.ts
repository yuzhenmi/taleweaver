import { resolveBlock, inlineContentLength } from "../../../state";
import type { BlockId, Document } from "../../../state";

/** Content length of a leaf block over a bare `Document` (the `objectMoveSelection` variant). */
export function contentLengthForDocument(document: Document, blockId: BlockId): number {
  const block = resolveBlock(document, blockId)?.block ?? null;
  if (block === null || block.inlineContent === null) return 0;
  return inlineContentLength(block.inlineContent);
}
