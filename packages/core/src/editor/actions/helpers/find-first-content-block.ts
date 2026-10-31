import { iterateLeafBlocksInDocumentOrder } from "../../../state";
import type { Document, BlockId } from "../../../state";

/**
 * Find the first content-bearing leaf block in the document (the first
 * block in document order whose `inlineContent !== null`). Returns null
 * if no such block exists (e.g., a fully-empty document with only
 * containers — shouldn't happen with the standard empty-document
 * factory, which always seeds one paragraph).
 */
export function findFirstContentBlock(document: Document): BlockId | null {
  // Cycle-safe leaf walk (a block with `inlineContent !== null` is always a
  // leaf, so filtering to leaves first finds the identical first hit). Replaces
  // an unbounded `firstLeafBlock` + `while (cursor = nextBlockInDocOrder(...))`
  // sweep that could spin forever on a malformed two-parents topology — the
  // same footgun fixed in the render-pass doc-order queries.
  for (const block of iterateLeafBlocksInDocumentOrder(document)) {
    if (block.inlineContent !== null) return block.id;
  }
  return null;
}
