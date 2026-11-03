import { type BlockId, BLOCK_TYPES } from "../../block";
import { resolveBlock } from "../../document/blocks";
import type { Document } from "../../document/types";
import { type ParagraphLayout, paragraphLayout } from "../../position/paragraph-layout";

/** The paragraphs from `startId` to `endId` in reading order (block objects skipped). */
export function* paragraphsBetween(d: Document, startId: BlockId, endId: BlockId): Generator<ParagraphLayout> {
  let b = resolveBlock(d, startId);
  while (b !== null) {
    const L = paragraphLayout(d, b.block.id);
    if (L !== null) yield L;
    if (b.block.id === endId) return;
    let nextId = b.block.nextSiblingId;
    const parent = b.kind === "block" && b.block.parentId !== null ? d.trees.block.get(b.block.parentId) : undefined;
    if (nextId === null && parent?.type === BLOCK_TYPES.section) {
      // Across a section boundary: the next non-empty section's first child (a cell's story ends at the cell).
      for (let s = parent.nextSiblingId; s !== null && nextId === null; ) {
        const sec = resolveBlock(d, s)?.block;
        nextId = sec?.firstChildId ?? null;
        s = sec?.nextSiblingId ?? null;
      }
    }
    b = nextId === null ? null : resolveBlock(d, nextId);
  }
}
