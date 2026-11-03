/**
 * RT1 (tables continuous-text design §2, F1–F3, F6): a flow's tokens → the entities of
 * its top container, tables parsed from their bracket of marks. One left-to-right pass
 * with a stack of open tables; each open container groups its own tokens (R1 / R2,
 * {@link Grouper}).
 *   - A mark binds by its depth `d` (Word `itap`, F3): `⟦` opens a table iff `d` is the
 *     number of open tables and below {@link TABLE_DEPTH_CAP}; `⟨r⟩` / `⟨c⟩` / `⟧` bind
 *     to the open table of depth `d`, closing deeper open tables first. A `⟨c⟩` before
 *     its table's first `⟨r⟩` has no row to open. Any other mark is INERT: it is dropped,
 *     so the content around it reads as if it were absent (and its flow's segments read it
 *     as an inert unit of a run, `inert-marks.ts`, so positions agree).
 *   - `⟨r⟩` closes the current row and opens one (F1: a row also with no cell); `⟨c⟩`
 *     closes the current cell and opens one in the current row; `⟧` closes the table.
 *   - `[S]` and `<end>` close every open table.
 *   - A container's content not ended by a ¶ is debris of the mark closing it (F6),
 *     `${mark}/pre` (`${holder}/end` at `<end>`).
 * A closed table is formed (RT2–RT4, `form-table.ts`) and becomes a block object of the
 * container it opened in.
 */
import type { BlockId } from "../../block";
import { holdsFlows, isSectionBreak } from "../../scan/kinds";
import { type Token, depthOf, roleOf } from "../../scan/tokens";
import { TABLE_DEPTH_CAP } from "../../storage/limits";
import { type Entity, Grouper } from "../entities";
import { type ParsedCell, type ParsedRow, type ParsedTable, formTable } from "./form-table";
import type { TableForm } from "./table-form";

interface Open {
  readonly table: ParsedTable;
  /** The open container: the table's lead, a row's lead or a cell. */
  grouper: Grouper;
  row: ParsedRow | null;
}

export interface ParseResult {
  readonly ents: Entity[];
  readonly inert: Set<BlockId>;
  /** The forms of the tables closed in the sequence, by `⟦` id. */
  readonly tables: Map<BlockId, TableForm>;
  /** Blocks stored in a cell-less table's bracket (its leads) that read after it, outside it. */
  readonly leadsAfter: Set<BlockId>;
}

/**
 * The entities of the flow `holderId` whose tokens are `tokens` (its whole reading order),
 * the ids of its INERT marks and the forms of its tables (by `⟦` id).
 */
export function parseFlow(tokens: Iterable<Token>, holderId: BlockId): ParseResult {
  const r = parseRegion(tokens, holderId, { depth: 0, end: null });
  if (r === null) throw new Error("model: an unseeded parse cannot fail");
  return r;
}

/** Where a region's token sequence ends (see {@link parseRegion}). */
export type RegionEnd =
  /** At its last token (a terminator that is no table mark). */
  | undefined
  /** At `<end>`. */
  | null
  /** Just before a table mark (not in the sequence) of stored depth `d`: a `⟦` (`opens`) or another mark. */
  | { readonly id: BlockId; readonly opens: boolean; readonly d: number | null };

export interface RegionSeed {
  /** The tables open around the region: its container's nesting depth. */
  readonly depth: number;
  readonly end: RegionEnd;
  readonly withItems?: boolean;
  /** The block object just before the region, if any (its implicit paragraph's base). */
  readonly objectBefore?: BlockId | null;
}

/**
 * RT1 over a REGION of a flow: tokens read inside one container nested in `seed.depth`
 * open tables. Null when the region is not balanced there — a mark binds to one of the
 * enclosing tables, an `[S]` / `<end>` would close them, or a table opened in the region
 * stays open past its end where the whole read would bind differently. Otherwise the
 * entities read exactly as in a whole-flow parse (with the same seed's containers).
 */
export function parseRegion(tokens: Iterable<Token>, holderId: BlockId, seed: RegionSeed): ParseResult | null {
  const base = seed.depth;
  const top = new Grouper(holderId, [], seed.withItems ?? true, seed.objectBefore ?? null);
  const inert = new Set<BlockId>();
  const tables = new Map<BlockId, TableForm>();
  const leadsAfter = new Set<BlockId>();
  // Index i < base: an enclosing table (not this parse's); the region's own tables above.
  const stack: (Open | null)[] = new Array<Open | null>(base).fill(null);
  const current = (): Grouper => (stack.length > base ? (stack[stack.length - 1]?.grouper ?? top) : top);
  const close = (closer: BlockId | null, closeId: BlockId | null): void => {
    const o = stack.pop();
    if (o === undefined || o === null) return;
    o.grouper.finish(closer);
    const { formed, trailing, form } = formTable(o.table, closeId, stack.length);
    tables.set(o.table.id, form);
    const parent = current();
    const t = o.table;
    parent.pushObject({ k: "table", id: t.id, map: t.map, after: closeId ?? t.id, formed }, closeId ?? t.id, true);
    parent.pushEntities(trailing);
    for (const e of trailing) leadsAfter.add(e.id);
  };
  for (const t of tokens) {
    if (t.k === "run" || (!holdsFlows(t.k) && !isSectionBreak(t.k))) {
      current().push(t);
      continue;
    }
    if (!holdsFlows(t.k)) {
      if (base > 0) return null;
      while (stack.length > 0) close(t.id, null);
      top.push(t);
      continue;
    }
    const d = depthOf(t);
    if (d === null) {
      inert.add(t.id);
      continue;
    }
    const role = roleOf(t);
    if (role === "open") {
      if (d !== stack.length || d >= TABLE_DEPTH_CAP) {
        inert.add(t.id);
        continue;
      }
      const table: ParsedTable = { id: t.id, map: t.map, lead: [], rows: [] };
      stack.push({ table, grouper: new Grouper(holderId, table.lead), row: null });
      continue;
    }
    if (d < base && role !== null) return null;
    const o = stack[d];
    if (o === undefined || o === null || role === null || (role === "newCell" && o.row === null)) {
      inert.add(t.id);
      continue;
    }
    while (stack.length > d + 1) close(t.id, null);
    if (role === "close") {
      close(t.id, t.id);
    } else if (role === "newRow") {
      o.grouper.finish(t.id);
      const row: ParsedRow = { id: t.id, map: t.map, lead: [], cells: [] };
      o.table.rows.push(row);
      o.row = row;
      o.grouper = new Grouper(holderId, row.lead);
    } else if (o.row !== null) {
      o.grouper.finish(t.id);
      const cell: ParsedCell = { id: t.id, map: t.map, ents: [] };
      o.row.cells.push(cell);
      o.grouper = new Grouper(holderId, cell.ents);
    }
  }
  const end = seed.end;
  if (end === undefined) {
    if (stack.length > base) return null;
  } else if (end === null) {
    if (base > 0) return null;
    while (stack.length > 0) close(null, null);
    top.finish(null);
  } else {
    // The mark must read as it did: a `⟦` opening a table in the container (at its depth), or another mark ending
    // the container (binding to an enclosing table, so it closes the region's open tables, deeper, first).
    if (end.d === null || (end.opens ? stack.length > base || end.d !== base : end.d >= base)) return null;
    while (stack.length > base) close(end.id, null);
    top.finish(end.id);
  }
  return { ents: top.out, inert, tables, leadsAfter };
}
