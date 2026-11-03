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
import type { Token } from "../../scan/tokens";
import { TABLE_DEPTH_CAP } from "../../storage/limits";
import { markDepth, markRole } from "../../storage/table-marks";
import { type Entity, Grouper } from "../entities";
import { type ParsedCell, type ParsedRow, type ParsedTable, formTable } from "./form-table";
import type { TableForm } from "./table-form";

interface Open {
  readonly table: ParsedTable;
  /** The open container: the table's lead, a row's lead or a cell. */
  grouper: Grouper;
  row: ParsedRow | null;
}

/**
 * The entities of the flow `holderId` whose tokens are `tokens` (its whole reading order),
 * the ids of its INERT marks and the forms of its tables (by `⟦` id).
 */
export function parseFlow(tokens: Iterable<Token>, holderId: BlockId): { ents: Entity[]; inert: Set<BlockId>; tables: Map<BlockId, TableForm> } {
  const top = new Grouper(holderId);
  const inert = new Set<BlockId>();
  const tables = new Map<BlockId, TableForm>();
  const stack: Open[] = [];
  const current = (): Grouper => stack[stack.length - 1]?.grouper ?? top;
  const close = (closer: BlockId | null, closeId: BlockId | null): void => {
    const o = stack.pop();
    if (o === undefined) return;
    o.grouper.finish(closer);
    const { formed, trailing, form } = formTable(o.table, closeId, stack.length);
    tables.set(o.table.id, form);
    const parent = current();
    const t = o.table;
    parent.pushObject({ k: "table", id: t.id, map: t.map, after: closeId ?? t.id, formed }, closeId ?? t.id, true);
    parent.pushEntities(trailing);
  };
  for (const t of tokens) {
    if (t.k === "run" || (!holdsFlows(t.k) && !isSectionBreak(t.k))) {
      current().push(t);
      continue;
    }
    if (!holdsFlows(t.k)) {
      while (stack.length > 0) close(t.id, null);
      top.push(t);
      continue;
    }
    const d = markDepth(t.map);
    if (d === null) {
      inert.add(t.id);
      continue;
    }
    const role = markRole(t.map);
    if (role === "open") {
      if (d !== stack.length || d >= TABLE_DEPTH_CAP) {
        inert.add(t.id);
        continue;
      }
      const table: ParsedTable = { id: t.id, map: t.map, lead: [], rows: [] };
      stack.push({ table, grouper: new Grouper(holderId, table.lead), row: null });
      continue;
    }
    const o = stack[d];
    if (o === undefined || role === null || (role === "newCell" && o.row === null)) {
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
  while (stack.length > 0) close(null, null);
  top.finish(null);
  return { ents: top.out, inert, tables };
}
