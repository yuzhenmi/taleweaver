import { firstLeafBlock } from "../../../state";
import type { BlockId, Document } from "../../../state";
import { findFirstContentBlock } from "./find-first-content-block";

/**
 * The first boundary block within `ctxRoot`. Main body → the first
 * CONTENT-bearing leaf (`findFirstContentBlock`, which skips container-only
 * leaves). A footnote/header/footer body → the first leaf within that body
 * (`firstLeafBlock`). Mirrors `handleSelectAll`.
 */
export function firstBoundaryBlock(document: Document, ctxRoot: BlockId): BlockId | null {
  return ctxRoot === document.rootId
    ? findFirstContentBlock(document)
    : firstLeafBlock(document, ctxRoot);
}
