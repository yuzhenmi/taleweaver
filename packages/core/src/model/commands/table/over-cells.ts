/** Commands over every cell of a cell selection's rectangle (N7): one plan of each cell's writes. */
import { emptyCellParagraphId, virtualCellId } from "../../ids";
import type { Plan, Write } from "../../plan";
import { paragraphLayout } from "../../position/paragraph-layout";
import type { BlockId } from "../../block";
import type { Document } from "../../document/types";
import { edgeParagraphOf } from "../../position/block-object";
import type { TextSelection } from "../../position/model-position";
import type { CommandContext } from "../command-context";
import { mappedSelection, plan } from "../helpers/build-plan";
import type { Keys } from "../helpers/paragraph-keys";
import { type LeadKeys, insertAt, materialize } from "../helpers/writes";
import { newCellMark } from "../../storage/table-marks";
import type { CellRect } from "./cell-rect";
import { nextMarkId, rowEndPoint, slotsOf } from "./table-at";

/**
 * `perCell` run on every real cell of `rect` (row-major, a select-all of the cell each), as ONE plan; with `virtual`,
 * the rectangle's virtual cells are made real with those keys ({@link realizeVirtual}). The selection maps. Null when
 * nothing is written.
 */
export function overCells(ctx: CommandContext, rect: CellRect, perCell: (ctx: CommandContext) => Plan | null, virtual?: LeadKeys): Plan | null {
  const { c, box } = rect;
  const writes: Write[] = [];
  for (let i = box.r0; i <= box.r1; i++) {
    const row = c.form.rows[i];
    if (row === undefined) return null;
    for (const p of row.placed) {
      if (p.gridCol < box.c0 || p.gridCol > box.c1) continue;
      writes.push(...(perCell({ ...ctx, selection: { kind: "all", container: p.cellId } })?.writes ?? []));
    }
    // A virtual cell holding a row's lead (F2, concurrency only: at slot 0) reads stored paragraphs: a range over them.
    const lead = box.c0 === 0 && slotsOf(row)[0] === undefined ? leadRange(c.d, virtualCellId(nextMarkId(c.form, c.tableId, i), 0)) : null;
    if (lead !== null) writes.push(...(perCell({ ...ctx, selection: lead })?.writes ?? []));
    if (virtual !== undefined) {
      const v = realizeVirtual(rect, i, virtual);
      if (v === null) return null;
      writes.push(...v);
    }
  }
  if (writes.length === 0) return null;
  const base = ctx.version;
  const sel = ctx.selection;
  return plan(base, writes, (after) => mappedSelection(base, sel, after));
}

/**
 * Row `i`'s virtual cells inside `rect` made real with `keys` (empty keys: nothing): its free slots (a covered slot may
 * sit between them) in rank order, made real through the last one inside the rectangle; those outside it get none.
 */
export function realizeVirtual(rect: CellRect, i: number, keys: LeadKeys): Write[] | null {
  const { c, box } = rect;
  const row = c.form.rows[i];
  if (row === undefined) return null;
  const slots = slotsOf(row);
  const free: number[] = [];
  for (let col = 0; col < c.columnCount; col++) if (slots[col] === undefined) free.push(col);
  const last = free.filter((col) => col >= box.c0 && col <= box.c1).at(-1);
  const none = Object.keys(keys.cell ?? {}).length === 0 && Object.keys(keys.para ?? {}).length === 0;
  if (last === undefined || none) return [];
  const id = virtualCellId(nextMarkId(c.form, c.tableId, i), last);
  // The row's lead cell (rank 1; its paragraphs are formatted as a range by overCells): made real with cell keys only,
  // by its `⟨c⟩` at the row's end, which the lead before it joins (F2; `cellLead`'s `firstHolds`: no ¶).
  if (leadRange(c.d, id) !== null) {
    const at = Object.keys(keys.cell ?? {}).length === 0 ? null : rowEndPoint(c, i);
    return at === null ? [] : [insertAt(at, [{ embed: newCellMark(c.form.depth, keys.cell ?? {}), attrs: {} }])];
  }
  const L = paragraphLayout(c.d, emptyCellParagraphId(id));
  const inBox = (rank: number): boolean => {
    const col = free[rank - 1];
    return col !== undefined && col >= box.c0 && col <= box.c1;
  };
  const para: Keys = keys.para ?? {};
  const m = L === null ? null : materialize(L, para, [], undefined, (rank) => (inBox(rank) ? keys : {}));
  return m === null ? null : m.writes;
}

/** A virtual cell `id` holding stored paragraphs (a row's lead): a text range over them; null for an empty one. */
function leadRange(d: Document, id: BlockId): TextSelection | null {
  if (paragraphLayout(d, emptyCellParagraphId(id)) !== null) return null;
  const first = edgeParagraphOf(d, id, 1);
  const last = edgeParagraphOf(d, id, -1);
  const L = last === null ? null : paragraphLayout(d, last);
  return first === null || last === null || L === null ? null : { anchor: { blockId: first, offset: 0 }, focus: { blockId: last, offset: L.length } };
}
