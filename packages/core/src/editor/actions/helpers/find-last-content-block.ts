import { iterateLeafBlocksInDocumentOrder } from "../../../state";
import type { Document, BlockId } from "../../../state";

/**
 * Find the last content-bearing leaf block in the document. Symmetric to
 * `findFirstContentBlock`: the cycle-safe leaf walk yields content leaves in
 * document order, so the LAST one it yields is the answer. (A full forward walk
 * rather than a backward early-exit, but this runs only on Select-All /
 * boundary-expand / document-load, never per-keystroke, and trades a negligible
 * walk for immunity to the malformed-topology hang.)
 */
export function findLastContentBlock(document: Document): BlockId | null {
  let last: BlockId | null = null;
  for (const block of iterateLeafBlocksInDocumentOrder(document)) {
    if (block.inlineContent !== null) last = block.id;
  }
  return last;
}
