/**
 * A row the row splice did not re-read, after its table's column count changed: its real
 * cells keep their records (sibling links patched); its virtual end cells (design: short
 * rows read virtual cells up to the table's width) follow the new width.
 * O(columns).
 */
import { BLOCK_TYPES, type BlockId } from "../block";
import { EMPTY_ATTRS, type Links, containerRecord, entityRecord } from "../derive/records";
import type { RowForm } from "../derive/table/table-form";
import type { Working } from "../derive/working";
import type { TreeKind } from "../document/types";
import { emptyCellParagraphId, virtualCellId } from "../ids";

export function relinkRow(w: Working, tree: TreeKind, row: RowForm, nextMark: BlockId, oldCount: number, columnCount: number): void {
  const rec = w.get(tree, row.id);
  if (rec === undefined) return;
  // Virtual cells at the columns both widths have stay as they are (one at column 0 may hold the row's lead); those
  // past the new width go; those the new width adds are written empty.
  const lo = Math.min(oldCount, columnCount);
  const fill = `${nextMark}/fill`;
  for (let c = rec.firstChildId; c !== null; ) {
    const next = w.get(tree, c)?.nextSiblingId ?? null;
    if (c.startsWith(fill) && Number(c.slice(fill.length)) >= lo) {
      w.del(tree, emptyCellParagraphId(c));
      w.del(tree, c);
    }
    c = next;
  }
  const cells: { id: BlockId; col: number; fresh: boolean }[] = row.placed.map((p) => ({ id: p.cellId, col: p.gridCol, fresh: false }));
  const taken = new Set<number>();
  for (const p of row.placed) for (let c = p.gridCol; c < p.gridCol + p.colSpan; c++) taken.add(c);
  for (let col = 0; col < columnCount; col++) {
    if (row.carryIn[col] === undefined && !taken.has(col)) cells.push({ id: virtualCellId(nextMark, col), col, fresh: col >= lo });
  }
  cells.sort((a, b) => a.col - b.col);
  cells.forEach((cell, i) => {
    const links = { parentId: row.id, prevSiblingId: cells[i - 1]?.id ?? null, nextSiblingId: cells[i + 1]?.id ?? null };
    const b = cell.fresh ? undefined : w.get(tree, cell.id);
    if (b !== undefined) {
      w.put(tree, Object.freeze({ ...b, ...links }));
      return;
    }
    writeVirtualCell(w, tree, cell.id, links);
  });
  w.patch(tree, row.id, { firstChildId: cells[0]?.id ?? null, lastChildId: cells[cells.length - 1]?.id ?? null });
}

/** Write an empty virtual end cell `id` (with `links`) and its `/empty` paragraph. */
export function writeVirtualCell(w: Working, tree: TreeKind, id: BlockId, links: Links): void {
  const para = emptyCellParagraphId(id);
  w.put(tree, containerRecord(id, BLOCK_TYPES.tableCell, EMPTY_ATTRS, links, para, para));
  w.put(tree, entityRecord({ k: "para", id: para, map: null, items: [], footnotes: [] }, { parentId: id, prevSiblingId: null, nextSiblingId: null }));
}
