import type * as Y from "yjs";
import type { BlockId } from "../../block";
import { edgeParagraphOf } from "../../position/block-object";
import { emptyCellParagraphId, virtualCellId } from "../../ids";
import type { InsertUnit, Plan, Write } from "../../plan";
import { caretAt } from "../../position/model-position";
import { type StoragePoint, paragraphLayout, terminatorOf } from "../../position/paragraph-layout";
import { pointBefore } from "../../position/storage-points";
import { COL_SPAN_KEY, ROW_SPAN_KEY } from "../../storage/keys";
import { newParagraphMark } from "../../storage/new-items";
import type { CommandContext } from "../command-context";
import { plan } from "../helpers/build-plan";
import { moveUnits } from "../helpers/copy-units";
import { type Keys, diffKeys, scalar } from "../helpers/paragraph-keys";
import { deleteBetween, insertAt, keysWrite, materialize } from "../helpers/writes";
import { type CellAt, cellParagraphAt, nextMarkId, selectedCell, spanValue } from "./table-at";
import { type TableMarks, tableMarks } from "./table-mark-walk";

/** A grid slot: [row, col]. */
export type Slot = readonly [number, number];

/**
 * T6: merge the rectangle `from`–`to` (two corner slots of the selected cell's table), grown until no cell crosses its
 * edge (GDocs). Its head is the cell at its top-left slot (a virtual one is made real). In the head's row the other
 * cells' `⟨c⟩`s go, so their content joins the head in place; an empty one (one ¶, nothing else) loses its ¶ too, and
 * so does an empty head when the row is not all empty (Word: empty cells add nothing). The rows below move their
 * non-empty content, anchors included, row-major, before the head's final ¶ F (r7 F5): a clone of F first ends the
 * head's own last paragraph (unless the head's row is empty), the moved run comes without its last ¶, and F takes that
 * ¶'s keys, so undo never leaves debris after F. The head gets the spans; the caret goes to the merged cell's start.
 * One cell (or one slot) is a no-op, as is a selection outside a table cell; a slot outside the table throws.
 */
export function mergeCells(ctx: CommandContext, from: Slot, to: Slot): Plan | null {
  const c = selectedCell(ctx);
  if (c === null) return null;
  const R = c.form.rows.length;
  for (const [r, col] of [from, to]) {
    if (!Number.isInteger(r) || !Number.isInteger(col) || r < 0 || r >= R || col < 0 || col >= c.columnCount) throw new Error(`model: no slot (${r}, ${col}) in the table`);
  }
  const box = grown(c, from, to);
  const marks = tableMarks(c);
  if (marks === null) return null;
  const rows: OwnCell[][] = [];
  for (let i = box.r0; i <= box.r1; i++) {
    const own = ownCells(c, marks, i, box);
    if (own === null) return null;
    rows.push(own);
  }
  const area = (box.r1 - box.r0 + 1) * (box.c1 - box.c0 + 1);
  const all = rows.flat();
  if (all.length === 0 ? area === 1 : all.length === 1 && all[0]?.slots === area) return null;
  const { d, fs } = c;
  const writes: Write[] = [];
  const spans = { [ROW_SPAN_KEY]: spanValue(box.r1 - box.r0 + 1), [COL_SPAN_KEY]: spanValue(box.c1 - box.c0 + 1) };
  // The rows below: their non-empty content, row-major, and their ranges deleted.
  const run: InsertUnit[] = [];
  let lastMoved: OwnCell | undefined;
  for (const own of rows.slice(1)) {
    const first = own[0];
    const last = own.at(-1);
    if (first === undefined || last === undefined) continue;
    writes.push(...deleteBetween(fs, first.mark, last.stop));
    for (const x of own) {
      if (x.empty) continue;
      run.push(...x.units);
      lastMoved = x;
    }
  }
  // The run's last unit is the last moved cell's final ¶ when it has one: F takes its keys instead.
  const tail = lastMoved?.final ? run.pop() : undefined;
  const lastKeys = lastMoved?.final?.keys ?? null;
  const headRow = rows[0] ?? [];
  const head = headRow[0];
  if (head === undefined || head.col !== box.c0) {
    // A virtual head (its row has no cell from there on): made real with the spans and what the rows below bring.
    const L = paragraphLayout(d, emptyCellParagraphId(virtualCellId(nextMarkId(c.form, c.tableId, box.r0), box.c0)));
    const fresh = Object.fromEntries(Object.entries(spans).filter((e): e is [string, number] => e[1] !== undefined));
    const m = L === null ? null : materialize(L, lastKeys ?? {}, run, undefined, fresh);
    if (m === null) return null;
    writes.push(...m.writes);
  } else {
    writes.push(...keysWrite(head.map, spans));
    const kept = headRow.filter((x) => !x.empty);
    for (const x of headRow.slice(1)) writes.push(...deleteBetween(fs, x.mark, x.empty ? x.stop : { ...x.mark, index: x.mark.index + 1 }));
    if (head.empty && kept.length > 0) writes.push(...deleteBetween(fs, head.start, head.stop));
    if (run.length > 0 || lastKeys !== null) {
      const into = kept.at(-1) ?? head;
      const f = into.final;
      // ponytail: a cell not ending in a ¶ of its own (concurrency only) takes the run after it, without F5.
      if (f === null) writes.push(insertAt(into.stop, tail === undefined ? run : [...run, tail]));
      else {
        writes.push(insertAt(f.at, kept.length > 0 ? [{ embed: newParagraphMark(f.keys), attrs: {} }, ...run] : run));
        if (lastKeys !== null) writes.push(...keysWrite(f.map, diffKeys(f.keys, lastKeys)));
      }
    }
  }
  const sel = ctx.selection;
  return plan(d, writes, (after) => {
    const q = cellParagraphAt(after, fs.holderId, c.tableId, box.r0, box.c0);
    return q === null ? sel : caretAt(q, 0);
  });
}

/** A rectangle of grid slots, inclusive. */
interface Box {
  readonly r0: number;
  readonly r1: number;
  readonly c0: number;
  readonly c1: number;
}

/** The rectangle `from`–`to` grown until no placed cell (clipped spans) crosses its edge. */
function grown(c: CellAt, from: Slot, to: Slot): Box {
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

/** A real cell of the rectangle, in its own row. */
interface OwnCell {
  readonly id: BlockId;
  readonly map: Y.Map<unknown>;
  readonly col: number;
  /** The slots it covers. */
  readonly slots: number;
  /** Before its `⟨c⟩`; its content [start, stop): after the `⟨c⟩` up to its row's next mark. */
  readonly mark: StoragePoint;
  readonly start: StoragePoint;
  readonly stop: StoragePoint;
  readonly units: InsertUnit[];
  /** Its final ¶, when it ends in one of its own. */
  readonly final: FinalMark | null;
  /** Its content is exactly one ¶. */
  readonly empty: boolean;
}

/** Row `i`'s own cells inside the rectangle (contiguous: it is grown), left to right. */
function ownCells(c: CellAt, marks: TableMarks, i: number, box: Box): OwnCell[] | null {
  const R = c.form.rows.length;
  const row = c.form.rows[i];
  if (row === undefined) return null;
  const out: OwnCell[] = [];
  for (const p of row.placed) {
    if (p.gridCol < box.c0 || p.gridCol > box.c1) continue;
    const next = row.cells[row.cells.findIndex((x) => x.cellId === p.cellId) + 1];
    const mark = marks.point(p.cellId);
    const map = marks.map(p.cellId);
    const stop = next === undefined ? marks.rowEnd(i) : marks.point(next.cellId);
    if (mark === null || map === null || stop === null) return null;
    const start = { ...mark, index: mark.index + 1 };
    const units = moveUnits(c.fs, start, stop);
    const final = finalMark(c, p.cellId);
    out.push({ id: p.cellId, map, col: p.gridCol, slots: p.colSpan * Math.min(p.rowSpan, R - i), mark, start, stop, units, final, empty: units.length === 1 && final !== null });
  }
  return out;
}

/** A ¶ map's `p:*` / `m:*` keys. */
function paragraphKeys(m: Y.Map<unknown>): Keys {
  const out: Keys = {};
  m.forEach((v, k) => {
    const s = scalar(v);
    if (s !== undefined && (k.startsWith("p:") || k.startsWith("m:"))) out[k] = s;
  });
  return out;
}

/** A cell's final ¶: its map, its keys, and the point right before it. */
interface FinalMark {
  readonly map: Y.Map<unknown>;
  readonly keys: Keys;
  readonly at: StoragePoint;
}

/** Cell `cellId`'s final ¶; null when the cell does not end in one of its own (a nested table, concurrency only). */
function finalMark(c: CellAt, cellId: BlockId): FinalMark | null {
  const id = edgeParagraphOf(c.d, cellId, -1);
  const L = id === null ? null : paragraphLayout(c.d, id);
  const map = id === null ? null : (terminatorOf(c.d, c.fs, id)?.token.map ?? null);
  const at = L === null ? null : pointBefore(L, L.length);
  if (L === null || L.implicit || L.block.parentId !== cellId || map === null || at === null) return null;
  return { map, keys: paragraphKeys(map), at };
}
