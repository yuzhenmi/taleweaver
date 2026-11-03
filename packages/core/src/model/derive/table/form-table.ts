/**
 * RT2–RT4 (tables continuous-text design §2 + its amendments): a parsed table (RT1,
 * `parse-tables.ts`) → its grid. Total: any parse forms a rectangular grid; nothing is
 * rewritten.
 *   - RT2: spans read as integers ≥ 1 (else 1); the §17.5 forming with clipping
 *     (`table-grid/`). Column count = the widest row, at most {@link TABLE_COLUMN_CAP}
 *     (Word's): spans clip to it, and a cell whose slot would be past it joins the cell
 *     before it in its row (its content appended), so a row reads at most that many cells.
 *   - Virtual end cells: every free slot of a row reads a 1×1 empty cell
 *     `${nextMark}/fill<col>` (next mark = the following `⟨r⟩` / `⟧`; `⟦` for the last
 *     row of an unclosed table), made real by its first edit.
 *   - F1: every row is a row, also with no cell. F2: a table's / row's LEAD (content
 *     before its first row / cell) joins the cell at that row's grid slot 0 (prepended to
 *     a cell starting there, appended to a head covering it). A table with no cell has no
 *     rows; its leads read right after it.
 *   - A cell holding nothing reads one empty paragraph `${cell}/empty`.
 *   - RT3: `cols[i].w` is grid column i's weight (valid: finite > 0); a missing / invalid
 *     one is the mean of the valid ones; normalised to sum 1; none valid → auto (null).
 *   - RT4: the largest leading run of `header` rows no span crosses.
 */
import * as Y from "yjs";
import type { BlockId } from "../../block";
import { emptyCellParagraphId, virtualCellId } from "../../ids";
import { COLS_KEY, COL_SPAN_KEY, HEADER_KEY, ROW_SPAN_KEY, WIDTH_KEY } from "../../storage/keys";
import { TABLE_COLUMN_CAP } from "../../storage/limits";
import { type Carry, EMPTY_CARRY, type GridCell, placeRow } from "../../../table-grid/assign-table-grid";
import { type BlockEntity, type Entity, isBlockEntity } from "../entities";
import { type RowForm, type TableForm, columnCountOf, headerCountOf } from "./table-form";

export interface ParsedCell {
  readonly id: BlockId;
  readonly map: Y.Map<unknown>;
  readonly ents: Entity[];
}

export interface ParsedRow {
  readonly id: BlockId;
  readonly map: Y.Map<unknown>;
  /** Content between the `⟨r⟩` and its first `⟨c⟩`. */
  readonly lead: Entity[];
  readonly cells: ParsedCell[];
}

export interface ParsedTable {
  readonly id: BlockId;
  readonly map: Y.Map<unknown>;
  /** Content between the `⟦` and its first `⟨r⟩`. */
  readonly lead: Entity[];
  readonly rows: ParsedRow[];
}

export interface FormedCell {
  readonly id: BlockId;
  /** The `⟨c⟩`, or null for a virtual end cell. */
  readonly map: Y.Map<unknown> | null;
  readonly rowSpan: number;
  readonly colSpan: number;
  /** Never empty. */
  readonly ents: readonly BlockEntity[];
}

export interface FormedRow {
  readonly id: BlockId;
  readonly map: Y.Map<unknown>;
  readonly cells: readonly FormedCell[];
}

export interface FormedTable {
  /** Empty when the table has no cell. */
  readonly rows: readonly FormedRow[];
  readonly headerCount: number;
  readonly widths: readonly number[] | null;
}

const spanOf = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 1 ? v : 1);

const isWeight = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** RT3 over `n` grid columns. */
function widthsOf(map: Y.Map<unknown>, n: number): readonly number[] | null {
  const cols = map.get(COLS_KEY);
  const ws: unknown[] = [];
  for (let i = 0; i < n; i++) {
    const e: unknown = cols instanceof Y.Array && i < cols.length ? cols.get(i) : undefined;
    ws.push(e instanceof Y.Map ? e.get(WIDTH_KEY) : undefined);
  }
  const valid = ws.filter(isWeight);
  if (valid.length === 0) return null;
  const mean = valid.reduce((s, w) => s + w, 0) / valid.length;
  const filled = ws.map((w) => (isWeight(w) ? w : mean));
  const total = filled.reduce((s, w) => s + w, 0);
  return Object.freeze(filled.map((w) => w / total));
}

/** A cell placed in its row (real, or virtual with no map). */
interface Slot {
  readonly id: BlockId;
  readonly map: Y.Map<unknown> | null;
  readonly col: number;
  readonly rowSpan: number;
  readonly colSpan: number;
}

const blocks = (es: readonly Entity[]): BlockEntity[] => es.filter(isBlockEntity);

/** Form rows `rows` (RT2, {@link placeRow}): their forms, from `carryIn` down. */
export function formRows(rows: readonly ParsedRow[], carryIn: Carry): { forms: RowForm[]; slots: (readonly (BlockId | undefined)[])[]; carryOut: Carry } {
  const forms: RowForm[] = [];
  const slots: (readonly (BlockId | undefined)[])[] = [];
  let carry = carryIn;
  for (const r of rows) {
    const input: GridCell[] = r.cells.map((c) => ({ cellId: c.id, rowSpan: spanOf(c.map.get(ROW_SPAN_KEY)), colSpan: spanOf(c.map.get(COL_SPAN_KEY)) }));
    const pr = placeRow(carry, input, TABLE_COLUMN_CAP);
    forms.push({ id: r.id, carryIn: carry, placed: pr.placed, width: pr.width });
    slots.push(pr.slots);
    carry = pr.carryOut;
  }
  return { forms, slots, carryOut: carry };
}

/** The stored form of a table of rows `rows` (with their `forms`). */
export function tableForm(rows: readonly ParsedRow[], forms: readonly RowForm[], depth: number, closeId: BlockId | null): TableForm {
  const widthCount: number[] = new Array<number>(TABLE_COLUMN_CAP + 1).fill(0);
  for (const f of forms) widthCount[f.width] = (widthCount[f.width] ?? 0) + 1;
  let rawHeaderRun = 0;
  while (rawHeaderRun < rows.length && rows[rawHeaderRun]?.map.get(HEADER_KEY) === true) rawHeaderRun++;
  return { depth, closeId, rows: forms, rowIndex: new Map(forms.map((f, i) => [f.id, i])), widthCount, rawHeaderRun };
}

/**
 * Form `t` (of nesting depth `depth`), closed by its `⟧` `closeId` (null: by `[S]` / `<end>`).
 * `trailing`: its leads when it has no cell (they read right after it).
 */
export function formTable(t: ParsedTable, closeId: BlockId | null, depth: number): { formed: FormedTable; trailing: Entity[]; form: TableForm } {
  const { forms, slots } = formRows(t.rows, EMPTY_CARRY);
  const form = tableForm(t.rows, forms, depth, closeId);
  const columnCount = columnCountOf(form);
  if (columnCount === 0) {
    return { formed: { rows: [], headerCount: 0, widths: null }, trailing: [...t.lead, ...t.rows.flatMap((r) => r.lead)], form };
  }
  const occupancy = slots.map((row) => Array.from({ length: columnCount }, (_, col) => row[col] ?? null));
  const grid = {
    cells: forms.flatMap((f, i) => f.placed.map((p) => ({ ...p, gridRow: i, rowSpan: Math.min(p.rowSpan, forms.length - i) }))),
    occupancy,
  };
  const placed = new Map(grid.cells.map((g) => [g.cellId, g]));
  // Cell contents by id (real cells: their entities; virtual ones: filled below).
  const ents = new Map<BlockId, BlockEntity[]>();
  for (const r of t.rows) for (const c of r.cells) ents.set(c.id, blocks(c.ents));
  const rowCells: Slot[][] = t.rows.map((r, i) => {
    const out: Slot[] = [];
    for (const c of r.cells) {
      const g = placed.get(c.id);
      if (g !== undefined) {
        out.push({ id: c.id, map: c.map, col: g.gridCol, rowSpan: g.rowSpan, colSpan: g.colSpan });
        continue;
      }
      // Past the width cap: its content joins the cell before it in the row (or the head covering the row's slot 0).
      const into = out[out.length - 1]?.id ?? grid.occupancy[i]?.[0];
      if (into !== undefined && into !== null) ents.get(into)?.push(...(ents.get(c.id) ?? []));
    }
    const nextMark = t.rows[i + 1]?.id ?? closeId ?? t.id;
    (grid.occupancy[i] ?? []).forEach((owner, col) => {
      if (owner !== null) return;
      const id = virtualCellId(nextMark, col);
      out.push({ id, map: null, col, rowSpan: 1, colSpan: 1 });
      ents.set(id, []);
    });
    return out.sort((a, b) => a.col - b.col);
  });
  // F2: each row's lead (the first row's after the table's) joins the cell at its slot 0.
  t.rows.forEach((r, i) => {
    const lead = blocks(i === 0 ? [...t.lead, ...r.lead] : r.lead);
    if (lead.length === 0) return;
    const owner = grid.occupancy[i]?.[0] ?? rowCells[i]?.[0]?.id;
    const own = owner === undefined || owner === null ? undefined : ents.get(owner);
    if (own === undefined) return;
    const startsHere = rowCells[i]?.some((c) => c.id === owner) === true;
    if (startsHere) own.unshift(...lead);
    else own.push(...lead);
  });
  const rows: FormedRow[] = t.rows.map((r, i) => ({
    id: r.id,
    map: r.map,
    cells: (rowCells[i] ?? []).map((c) => {
      const own = ents.get(c.id) ?? [];
      return {
        id: c.id,
        map: c.map,
        rowSpan: c.rowSpan,
        colSpan: c.colSpan,
        ents: own.length > 0 ? own : [{ k: "para", id: emptyCellParagraphId(c.id), map: null, items: [], footnotes: [] }],
      };
    }),
  }));
  return { formed: { rows, headerCount: headerCountOf(form), widths: widthsOf(t.map, columnCount) }, trailing: [], form };
}
