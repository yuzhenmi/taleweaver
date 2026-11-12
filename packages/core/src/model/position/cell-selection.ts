/** Storage reads behind a {@link CellSelection} (N7): its cells' marks, and the cell a point or a paragraph is in. */
import type { BlockId } from "../block";
import { BLOCK_TYPES } from "../block";
import { peekBlock, resolveBlock } from "../document/blocks";
import type { Document, FlowState } from "../document/types";
import { emptyCellParagraphId, virtualCellId, virtualCellParagraphOf } from "../ids";
import type { CellSelection } from "./model-position";
import { type StoragePoint, flowOfBlock, paragraphLayout, terminatorOf } from "./paragraph-layout";
import { pointOf } from "./storage-points";

/** Real cell `id`'s `⟨c⟩`: its flow and the point right before it; null for a virtual cell or a non-cell. */
export function cellMarkAt(d: Document, id: BlockId): { fs: FlowState; point: StoragePoint } | null {
  const b = resolveBlock(d, id);
  if (b === null || b.block.type !== BLOCK_TYPES.tableCell) return null;
  const fs = flowOfBlock(d, b.block, b.kind);
  const t = fs === undefined ? null : terminatorOf(d, fs, id);
  const point = fs === undefined || t === null ? null : pointOf(fs, t);
  return fs === undefined || point === null ? null : { fs, point };
}

/** The paragraph a virtual end cell `id` reads (its one implicit paragraph); null when `id` is no virtual cell. */
export function virtualCellParagraph(d: Document, id: BlockId): BlockId | null {
  const p = emptyCellParagraphId(id);
  return peekBlock(d, id)?.type === BLOCK_TYPES.tableCell && cellMarkAt(d, id) === null && paragraphLayout(d, p) !== null ? p : null;
}

/** The nearest table cell holding block `id` (itself when it is one); null outside tables. */
export function cellOf(d: Document, id: BlockId): BlockId | null {
  for (let x: BlockId | null = id; x !== null; ) {
    const b = resolveBlock(d, x);
    if (b === null) return null;
    if (b.block.type === BLOCK_TYPES.tableCell) return x;
    x = b.block.parentId;
  }
  return null;
}

/** The table cell `id` is a cell of. */
export const tableOfCell = (d: Document, id: BlockId): BlockId | null => {
  const row = peekBlock(d, id)?.parentId ?? null;
  return row === null ? null : (peekBlock(d, row)?.parentId ?? null);
};

/**
 * Cells `a` and `b` as one CellSelection: each lifted to its enclosing cell until both are cells of one table (the
 * innermost such pair: ProseMirror takes cells at one depth); null when no table holds both.
 */
export function cellSelectionOf(d: Document, a: BlockId, b: BlockId): CellSelection | null {
  const lift = (id: BlockId): BlockId[] => {
    const out: BlockId[] = [];
    for (let c: BlockId | null = cellOf(d, id); c !== null; ) {
      out.push(c);
      const t = tableOfCell(d, c);
      const up = t === null ? null : (peekBlock(d, t)?.parentId ?? null);
      c = up === null ? null : cellOf(d, up);
    }
    return out;
  };
  const bs = lift(b);
  for (const x of lift(a)) {
    const t = tableOfCell(d, x);
    const y = bs.find((c) => tableOfCell(d, c) === t);
    if (t !== null && y !== undefined) return { kind: "cells", anchor: x, head: y };
  }
  return null;
}

/**
 * Implicit paragraph `stored` (a virtual cell's, `/empty`, `/after`…) at storage point `at`, where `found` is what the
 * point resolves to (several implicit paragraphs share one point: a row's virtual cells resolve to the first). It is
 * `stored` while that reads at `at`; a virtual cell: its column of its row, named after its stored next mark or (re-created
 * by an undo / redo: a new id) the one `found` names, else the nearest column left of it that reads. Null: none reads.
 */
export function implicitAt(d: Document, stored: BlockId, found: BlockId, at: { readonly piece: unknown; readonly index: number }): BlockId | null {
  const reads = (id: BlockId): boolean => {
    const head = paragraphLayout(d, id)?.head;
    return head != null && head.piece === at.piece && head.index === at.index;
  };
  const v = virtualCellParagraphOf(stored);
  if (v === null) return reads(stored) ? stored : null;
  for (const mark of [v.mark, virtualCellParagraphOf(found)?.mark]) {
    for (let col = v.col; mark !== undefined && col >= 0; col--) {
      const id = emptyCellParagraphId(virtualCellId(mark, col));
      if (reads(id)) return id;
    }
  }
  return null;
}
