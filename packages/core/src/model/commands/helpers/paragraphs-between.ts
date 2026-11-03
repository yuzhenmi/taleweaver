import type { BlockId } from "../../block";
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
    if (nextId === null && b.kind === "block" && b.block.parentId !== null) {
      // Across a section boundary: the next non-empty section's first child.
      for (let s = resolveBlock(d, b.block.parentId)?.block.nextSiblingId ?? null; s !== null && nextId === null; ) {
        const sec = resolveBlock(d, s)?.block;
        nextId = sec?.firstChildId ?? null;
        s = sec?.nextSiblingId ?? null;
      }
    }
    b = nextId === null ? null : resolveBlock(d, nextId);
  }
}
