/** The rectangle of cells a table command acts on (N7): a cell selection's, or the selected cell's own. */
import type { BlockId } from "../../block";
import type { Document, FlowState } from "../../document/types";
import { emptyCellParagraphId } from "../../ids";
import { cellMarkAt, cellOf, cellSelectionOf } from "../../position/cell-selection";
import { isCellSelection, isTextSelection, samePosition } from "../../position/model-position";
import { paragraphLayout } from "../../position/paragraph-layout";
import type { CommandContext } from "../command-context";
import { type CellAt, cellAt, selectedCell } from "./table-at";

/** A grid slot: [row, col]. */
export type Slot = readonly [number, number];

/** A rectangle of grid slots, inclusive. */
export interface Box {
  readonly r0: number;
  readonly r1: number;
  readonly c0: number;
  readonly c1: number;
}

/** A rectangle of a table: `c` locates the table (its anchor cell), `box` the slots. */
export interface CellRect {
  readonly c: CellAt;
  readonly box: Box;
}

/** The slots of one cell (clipped spans). */
export const boxOf = (c: CellAt): Box => ({ r0: c.row, r1: c.row + c.rowSpan - 1, c0: c.col, c1: c.col + c.colSpan - 1 });

/**
 * The selection's rectangle: a cell selection's, or a text selection's whose ends are in different cells (ProseMirror
 * `normalizeSelection`), grown until no cell crosses its edge (GDocs); else the selected cell's ({@link selectedCell}).
 * Null for anything else.
 */
export function selectedRect(ctx: CommandContext): CellRect | null {
  const d = ctx.version;
  const sel = ctx.selection;
  let ends: [BlockId, BlockId] | null = null;
  if (isCellSelection(sel)) ends = [sel.anchor, sel.head];
  else if (isTextSelection(sel) && !samePosition(sel.anchor, sel.focus)) {
    const a = cellOf(d, sel.anchor.blockId);
    const f = cellOf(d, sel.focus.blockId);
    if (a !== null && f !== null && a !== f) ends = [a, f];
  }
  if (ends === null) {
    const c = selectedCell(ctx);
    return c === null ? null : { c, box: boxOf(c) };
  }
  const cs = cellSelectionOf(d, ends[0], ends[1]);
  const fs = cs === null ? null : flowOfCell(d, cs.anchor);
  const a = cs === null || fs === null ? null : cellAt(d, fs, cs.anchor);
  const h = cs === null || fs === null ? null : cellAt(d, fs, cs.head);
  if (a === null || h === null) return null;
  const [x, y] = [boxOf(a), boxOf(h)];
  return { c: a, box: grown(a, [Math.min(x.r0, y.r0), Math.min(x.c0, y.c0)], [Math.max(x.r1, y.r1), Math.max(x.c1, y.c1)]) };
}

/** The flow of cell `id` (real or virtual). */
function flowOfCell(d: Document, id: BlockId): FlowState | null {
  return cellMarkAt(d, id)?.fs ?? paragraphLayout(d, emptyCellParagraphId(id))?.fs ?? null;
}

/** The rectangle `from`–`to` grown until no placed cell (clipped spans) of `c`'s table crosses its edge. */
export function grown(c: CellAt, from: Slot, to: Slot): Box {
  const R = c.form.rows.length;
  let r0 = Math.min(from[0], to[0]);
  let r1 = Math.max(from[0], to[0]);
  let c0 = Math.min(from[1], to[1]);
  let c1 = Math.max(from[1], to[1]);
  for (let grew = true; grew; ) {
    grew = false;
    c.form.rows.forEach((row, i) => {
      for (const p of row.placed) {
        const end = i + Math.min(p.rowSpan, R - i) - 1;
        const right = p.gridCol + p.colSpan - 1;
        if (i > r1 || end < r0 || p.gridCol > c1 || right < c0) continue;
        if (i < r0 || end > r1 || p.gridCol < c0 || right > c1) grew = true;
        r0 = Math.min(r0, i);
        r1 = Math.max(r1, end);
        c0 = Math.min(c0, p.gridCol);
        c1 = Math.max(c1, right);
      }
    });
  }
  return { r0, r1, c0, c1 };
}
