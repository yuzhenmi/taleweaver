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
import type * as Y from "yjs";
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
  /** The region's NEW tokens: a run holding folded inert marks (not rescanned) makes it decline. */
  readonly rescanned?: boolean;
}

/**
 * RT1 over a REGION of a flow: tokens read inside one container nested in `seed.depth`
 * open tables. Null when the region is not balanced there — a mark binds to one of the
 * enclosing tables, an `[S]` / `<end>` would close them, or a table opened in the region
 * stays open past its end where the whole read would bind differently. Otherwise the
 * entities read exactly as in a whole-flow parse (with the same seed's containers).
 */
export function parseRegion(tokens: Iterable<Token>, holderId: BlockId, seed: RegionSeed): ParseResult | null {
  const p = new RegionParser(holderId, seed.depth, { withItems: seed.withItems, objectBefore: seed.objectBefore, rescanned: seed.rescanned });
  for (const t of tokens) if (!p.push(t)) return null;
  return p.finish(seed.end);
}

/**
 * The RT1 parse of a region, token by token ({@link parseRegion}). In ROW mode (`table`
 * given) the region is whole rows of that table, open at depth `depth` and not closed in
 * the region: its rows are collected ({@link endRows}) instead of the container's entities.
 */
export class RegionParser {
  readonly inert = new Set<BlockId>();
  readonly tables = new Map<BlockId, TableForm>();
  readonly leadsAfter = new Set<BlockId>();
  /** Row mode: the open table whose rows the region holds. */
  readonly table: ParsedTable | null;
  private readonly top: Grouper;
  /** Index i < depth: an enclosing table (not this parse's); then the row mode's table; then the region's own. */
  private readonly stack: (Open | null)[];
  private failed = false;
  private readonly rescanned: boolean;

  constructor(
    private readonly holderId: BlockId,
    private readonly depth: number,
    opts: {
      readonly withItems?: boolean;
      readonly objectBefore?: BlockId | null;
      /** `row`: the region starts inside that row of the table (after its `⟨r⟩`), so it reads whole cells. */
      readonly table?: { readonly id: BlockId; readonly map: Y.Map<unknown>; readonly row?: { readonly id: BlockId; readonly map: Y.Map<unknown> } };
      /** Decline a run holding folded inert marks (the context they were read inert in may differ now). */
      readonly rescanned?: boolean;
    } = {},
  ) {
    this.top = new Grouper(holderId, [], opts.withItems ?? true, opts.objectBefore ?? null);
    this.rescanned = opts.rescanned ?? false;
    this.stack = new Array<Open | null>(depth).fill(null);
    this.table = opts.table === undefined ? null : { id: opts.table.id, map: opts.table.map, lead: [], rows: [] };
    if (this.table !== null) {
      const seed = opts.table?.row;
      const row: ParsedRow | null = seed === undefined ? null : { id: seed.id, map: seed.map, lead: [], cells: [] };
      if (row !== null) this.table.rows.push(row);
      this.stack.push({ table: this.table, grouper: new Grouper(holderId, row?.lead ?? this.table.lead), row });
    }
  }

  /** The region's own open tables start at this stack index. */
  private get own(): number {
    return this.table === null ? this.depth : this.depth + 1;
  }

  private current(): Grouper {
    return this.stack[this.stack.length - 1]?.grouper ?? this.top;
  }

  private close(closer: BlockId | null, closeId: BlockId | null): void {
    const o = this.stack.pop();
    if (o === undefined || o === null) return;
    o.grouper.finish(closer);
    const { formed, trailing, form } = formTable(o.table, closeId, this.stack.length);
    this.tables.set(o.table.id, form);
    const parent = this.current();
    const t = o.table;
    parent.pushObject({ k: "table", id: t.id, map: t.map, after: closeId ?? t.id, formed }, closeId ?? t.id, true);
    parent.pushEntities(trailing);
    for (const e of trailing) this.leadsAfter.add(e.id);
  }

  /** Read token `t`; false (for good) when the region is not balanced. */
  push(t: Token): boolean {
    if (this.failed) return false;
    const ok = this.read(t);
    if (!ok) this.failed = true;
    return ok;
  }

  private read(t: Token): boolean {
    if (t.k === "run" && t.foldedMarks === true && this.rescanned) return false;
    if (t.k === "run" || (!holdsFlows(t.k) && !isSectionBreak(t.k))) {
      this.current().push(t);
      return true;
    }
    const stack = this.stack;
    if (!holdsFlows(t.k)) {
      if (this.depth > 0 || this.table !== null) return false;
      while (stack.length > 0) this.close(t.id, null);
      this.top.push(t);
      return true;
    }
    const d = depthOf(t);
    if (d === null) {
      this.inert.add(t.id);
      return true;
    }
    const role = roleOf(t);
    if (role === "open") {
      if (d !== stack.length || d >= TABLE_DEPTH_CAP) {
        this.inert.add(t.id);
        return true;
      }
      const table: ParsedTable = { id: t.id, map: t.map, lead: [], rows: [] };
      stack.push({ table, grouper: new Grouper(this.holderId, table.lead), row: null });
      return true;
    }
    // Binding to an enclosing table, or closing the row mode's one, changes what is outside the region.
    if (role !== null && (d < this.depth || (this.table !== null && d === this.depth && role === "close"))) return false;
    const o = stack[d];
    if (o === undefined || o === null || role === null || (role === "newCell" && o.row === null)) {
      this.inert.add(t.id);
      return true;
    }
    while (stack.length > d + 1) this.close(t.id, null);
    if (role === "close") {
      this.close(t.id, t.id);
    } else if (role === "newRow") {
      o.grouper.finish(t.id);
      const row: ParsedRow = { id: t.id, map: t.map, lead: [], cells: [] };
      o.table.rows.push(row);
      o.row = row;
      o.grouper = new Grouper(this.holderId, row.lead);
    } else if (o.row !== null) {
      o.grouper.finish(t.id);
      const cell: ParsedCell = { id: t.id, map: t.map, ents: [] };
      o.row.cells.push(cell);
      o.grouper = new Grouper(this.holderId, cell.ents);
    }
    return true;
  }

  /** Content mode: the region's entities, ending at `end`; null when it is not balanced. */
  finish(end: RegionEnd): ParseResult | null {
    if (this.failed || this.table !== null) return null;
    const stack = this.stack;
    const base = this.depth;
    if (end === undefined) {
      if (stack.length > base) return null;
    } else if (end === null) {
      if (base > 0) return null;
      while (stack.length > 0) this.close(null, null);
      this.top.finish(null);
    } else {
      // The mark must read as it did: a `⟦` opening a table in the container (at its depth), or another mark ending
      // the container (binding to an enclosing table, so it closes the region's open tables, deeper, first).
      if (end.d === null || (end.opens ? stack.length > base || end.d !== base : end.d >= base)) return null;
      while (stack.length > base) this.close(end.id, null);
      this.top.finish(end.id);
    }
    this.failed = true;
    return { ents: this.top.out, inert: this.inert, tables: this.tables, leadsAfter: this.leadsAfter };
  }

  /**
   * Row mode: the rows read so far, the last one ended by `closer` (the row mode table's next `⟨r⟩` / its `⟧`, not
   * in the region): the region's open tables are closed first, as that mark closes them. Pushing `closer` afterwards
   * continues the parse. Null when the region is not balanced.
   */
  endRows(closer: BlockId): ParsedTable | null {
    if (this.failed || this.table === null) return null;
    while (this.stack.length > this.own) this.close(closer, null);
    this.current().finish(closer);
    return this.table;
  }
}
