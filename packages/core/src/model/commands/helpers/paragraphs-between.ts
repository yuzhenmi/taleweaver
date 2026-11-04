import { BLOCK_TYPES, type BlockId } from "../../block";
import { type ResolvedBlock, resolveBlock } from "../../document/blocks";
import type { Document } from "../../document/types";
import { type ParagraphLayout, paragraphLayout } from "../../position/paragraph-layout";

const inTable = (type: string | undefined): boolean => type === BLOCK_TYPES.tableCell || type === BLOCK_TYPES.tableRow;

/** The block after `b` in reading order: into a table (its rows, cells, paragraphs), out of one, across a section boundary. */
function nextInReadingOrder(d: Document, b: ResolvedBlock): BlockId | null {
  if (b.block.inlineContent === null && b.block.firstChildId !== null) return b.block.firstChildId;
  let cur = b;
  for (;;) {
    if (cur.block.nextSiblingId !== null) return cur.block.nextSiblingId;
    const parent = cur.block.parentId === null ? null : resolveBlock(d, cur.block.parentId);
    if (parent === null) return null;
    // Out of a cell's last paragraph, a row's last cell, a table's last row.
    if (inTable(parent.block.type) || inTable(cur.block.type)) {
      cur = parent;
      continue;
    }
    if (cur.kind !== "block") return null;
    // Across a section boundary: the next non-empty section's first child.
    for (let s = parent.block.nextSiblingId; s !== null; ) {
      const sec = resolveBlock(d, s)?.block;
      const first = sec?.firstChildId;
      if (first !== undefined && first !== null) return first;
      s = sec?.nextSiblingId ?? null;
    }
    return null;
  }
}

/** The paragraphs from `startId` to `endId` in reading order (block objects skipped; a table's paragraphs included). */
export function* paragraphsBetween(d: Document, startId: BlockId, endId: BlockId): Generator<ParagraphLayout> {
  let b = resolveBlock(d, startId);
  while (b !== null) {
    const L = paragraphLayout(d, b.block.id);
    if (L !== null) yield L;
    if (b.block.id === endId) return;
    const nextId = nextInReadingOrder(d, b);
    b = nextId === null ? null : resolveBlock(d, nextId);
  }
}
