import { getBlock, type Block, type Document } from "@taleweaver/core";

/**
 * The block whose children are a break-less document's body blocks: its final
 * section (the root's children are sections only).
 */
export function finalSection(document: Document): Block | null {
  const root = getBlock(document, document.rootId);
  return root === null || root.lastChildId === null ? null : getBlock(document, root.lastChildId);
}
