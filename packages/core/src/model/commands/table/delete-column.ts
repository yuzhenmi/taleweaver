import * as Y from "yjs";
import type { BlockId } from "../../block";
import type { InsertUnit, Plan, Write } from "../../plan";
import { caretAt } from "../../position/model-position";
import type { StoragePoint } from "../../position/paragraph-layout";
import { COLS_KEY, COL_SPAN_KEY } from "../../storage/keys";
import type { CommandContext } from "../command-context";
import { deleteBlockObject } from "../delete-block-object";
import { plan } from "../helpers/build-plan";
import { anchorUnits } from "../helpers/copy-units";
import { deleteBetween, insertAt, keysWrite } from "../helpers/writes";
import { cellParagraphAt, edgePoint, selectedCell, spanValue } from "./table-at";
import { tableMarks } from "./table-mark-walk";

/**
 * T3: delete the columns [j, k) the selected cell spans (GDocs). Each head intersecting them, once in its own row:
 * inside them, its items go (its `⟨c⟩` up to its row's next mark); else its colSpan drops by the overlap. A virtual
 * cell has no items, and a row ending before j is not written. `cols` loses its entries in [j, k). Every anchor of a
 * deleted cell moves, in storage order (GDocs, as deleteRow), to the start of the next surviving real cell's first
 * paragraph in its row, else the end of the last surviving one's last paragraph before it (in its row, else an
 * earlier one's), else the next surviving cell's start in a later row. The caret goes to the same row at column j
 * (what was k), or j − 1 when k is the end. Every column → C10. A no-op outside a table cell.
 */
export function deleteColumn(ctx: CommandContext): Plan | null {
  const c = selectedCell(ctx);
  if (c === null) return null;
  const { d, fs, form } = c;
  const C = c.columnCount;
  const j = c.col;
  const k = c.col + c.colSpan;
  if (j === 0 && k >= C) return deleteBlockObject(ctx, c.tableId);
  const marks = tableMarks(c);
  if (marks === null) return null;
  const writes: Write[] = [];
  /** The last surviving real cell so far (storage order). */
  let kept: BlockId | null = null;
  /** Anchors waiting for the next surviving cell, and where the first of them was (the fallback). */
  let waiting: InsertUnit[] = [];
  let strandedAt: StoragePoint | null = null;
  const place = (at: StoragePoint | null): void => {
    const p = at ?? strandedAt;
    if (waiting.length > 0 && p !== null) writes.push(insertAt(p, waiting));
    waiting = [];
    strandedAt = null;
  };
  for (let i = 0; i < form.rows.length; i++) {
    const row = form.rows[i];
    if (row === undefined) return null;
    for (const [n, p] of row.placed.entries()) {
      const overlap = Math.min(p.gridCol + p.colSpan, k) - Math.max(p.gridCol, j);
      if (overlap < p.colSpan) {
        // A span the grid clipped is written too: once a head clipping it goes, it would grow back past what read.
        const clipped = (row.cells[n]?.colSpan ?? p.colSpan) > p.colSpan;
        const m = overlap > 0 || clipped ? marks.map(p.cellId) : null;
        if (m !== null) writes.push(...keysWrite(m, { [COL_SPAN_KEY]: spanValue(p.colSpan - Math.max(overlap, 0)) }));
        if (waiting.length > 0) place(edgePoint(d, p.cellId, 1));
        kept = p.cellId;
        continue;
      }
      const next = row.cells[n + 1];
      const from = marks.point(p.cellId);
      const to = next === undefined ? marks.rowEnd(i) : marks.point(next.cellId);
      if (from === null || to === null) return null;
      writes.push(...deleteBetween(fs, from, to));
      waiting.push(...anchorUnits(fs, from, to));
      strandedAt ??= from;
    }
    // No surviving cell after them in this row: the last one before them, if any.
    if (waiting.length > 0 && kept !== null) place(edgePoint(d, kept, -1));
  }
  // ponytail: no surviving real cell at all (concurrency only): they stay at the first deletion point.
  place(null);
  const cols = form.map.get(COLS_KEY);
  if (cols instanceof Y.Array && j < cols.length) writes.push({ k: "cols", array: cols, index: j, delete: Math.min(k, cols.length) - j, insert: [] });
  const sel = ctx.selection;
  return plan(d, writes, (after) => {
    // Past the new last column the cell does not read: the loop steps to j − 1.
    for (let col = j; col >= 0; col--) {
      const q = cellParagraphAt(after, fs.holderId, c.tableId, c.row, col);
      if (q !== null) return caretAt(q, 0);
    }
    return sel;
  });
}
