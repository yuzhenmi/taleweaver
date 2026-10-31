import { lastLeafBlock } from "../../../state";
import type { BlockId, Document } from "../../../state";
import { findLastContentBlock } from "./find-last-content-block";

/** Symmetric to `firstBoundaryBlock` for the document END. */
export function lastBoundaryBlock(document: Document, ctxRoot: BlockId): BlockId | null {
  return ctxRoot === document.rootId
    ? findLastContentBlock(document)
    : lastLeafBlock(document, ctxRoot);
}
