/** The rectangle of cells a table command acts on (N7): a cell selection's, or the selected cell's own. */
import type { BlockId } from "../../block";
import type { Document, FlowState } from "../../document/types";
import { emptyCellParagraphId } from "../../ids";
import { cellMarkAt, cellOf, cellSelectionOf } from "../../position/cell-selection";
import { isCellSelection, isTextSelection, samePosition } from "../../position/model-position";
import { paragraphLayout } from "../../position/paragraph-layout";
import { edgeParagraphOf } from "../../position/block-object";
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

/** A rectangle of a table: `c` locates the table (its anchor cell), `box` the slots; `one`: it is one cell's own. */
export interface CellRect {
  readonly c: CellAt;
  readonly box: Box;
  readonly one: boolean;
}

/** The slots of one cell (clipped spans). */
export const boxOf = (c: CellAt): Box => ({ r0: c.row, r1: c.row + c.rowSpan - 1, c0: c.col, c1: c.col + c.colSpan - 1 });

/**
 * The selection's rectangle: a cell selection's, or a text selection's whose ends are in different cells (ProseMirror
 * `normalizeSelection`), grown until no cell crosses its edge (GDocs); else the selected cell's ({@link selectedCell}).
 * Null for anything else.
 */
export function selectedRect(ctx: CommandContext): CellRect | null {
  const cells = cellsRect(ctx);
  if (cells !== null) return cells;
  const c = selectedCell(ctx);
  return c === null ? null : { c, box: boxOf(c), one: true };
}

/** A cell selection's two cells, or a text selection's whose ends are in different cells; null for any other selection. */
function cellEnds(ctx: CommandContext): [BlockId, BlockId] | null {
  const d = ctx.version;
  const sel = ctx.selection;
  if (isCellSelection(sel)) return [sel.anchor, sel.head];
  if (!isTextSelection(sel) || samePosition(sel.anchor, sel.focus)) return null;
  const a = cellOf(d, sel.anchor.blockId);
  const f = cellOf(d, sel.focus.blockId);
  return a !== null && f !== null && a !== f ? [a, f] : null;
}

/**
 * The rectangle of a cell selection, or of a text selection whose ends are in different cells (one table holding both
 * after lifting, {@link cellSelectionOf}); null for any other selection: a caret, a range in one cell, or a text range
 * that lifts to one cell (from a cell's text into a table nested in it: a range of that cell, not a cell selection).
 * Commands that act on content (formatting, delete, typing) act per cell over it.
 */
export function cellsRect(ctx: CommandContext): CellRect | null {
  const d = ctx.version;
  const ends = cellEnds(ctx);
  if (ends === null) return null;
  const cs = cellSelectionOf(d, ends[0], ends[1]);
  if (cs !== null && cs.anchor === cs.head && !isCellSelection(ctx.selection)) return null;
  const fs = cs === null ? null : flowOfCell(d, cs.anchor);
  const a = cs === null || fs === null ? null : cellAt(d, fs, cs.anchor);
  const h = cs === null || fs === null ? null : cellAt(d, fs, cs.head);
  if (a === null || h === null) return null;
  const [x, y] = [boxOf(a), boxOf(h)];
  const box = grown(a, [Math.min(x.r0, y.r0), Math.min(x.c0, y.c0)], [Math.max(x.r1, y.r1), Math.max(x.c1, y.c1)]);
  return { c: a, box, one: box.r0 === x.r0 && box.r1 === x.r1 && box.c0 === x.c0 && box.c1 === x.c1 };
}

/** The flow of cell `id` (real or virtual; a virtual one holding a row's lead reads paragraphs of its own). */
function flowOfCell(d: Document, id: BlockId): FlowState | null {
  const first = edgeParagraphOf(d, id, 1);
  return cellMarkAt(d, id)?.fs ?? paragraphLayout(d, emptyCellParagraphId(id))?.fs ?? (first === null ? null : (paragraphLayout(d, first)?.fs ?? null));
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
