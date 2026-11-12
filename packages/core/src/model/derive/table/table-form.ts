/**
 * A table's stored forming state (N2, design F4): what the incremental row splice needs to
 * re-form from the first touched row forward without reading the rows above it.
 */
import type * as Y from "yjs";
import type { BlockId } from "../../block";
import type { Carry, GridCell, PlacedCell } from "../../../table-grid/assign-table-grid";

export interface RowForm {
  /** The row's `⟨r⟩`. */
  readonly id: BlockId;
  /** Its `⟨r⟩`'s map. */
  readonly map: Y.Map<unknown>;
  /** The slots covered from above (stored spans). */
  readonly carryIn: Carry;
  /** Its cells with their REQUESTED spans (the placement's input, document order): a re-placement reads no map. */
  readonly cells: readonly GridCell[];
  /** Its cells that got a slot: `colSpan` clipped. */
  readonly placed: readonly PlacedCell[];
  /** Grid width of the row's own cells (0 with none). */
  readonly width: number;
  /** Its `⟨r⟩` holds `header: true` (RT4). */
  readonly header: boolean;
  /**
   * Content of it (its lead, or a cell past the width cap with no cell before it) joins the head
   * covering its slot 0 from an earlier row: that row's records hold it (concurrency only).
   */
  readonly joinsAbove: boolean;
  /** Content of it reads outside its own cells' marks: a lead (row 0: the table's too) or a cell past the column cap. */
  readonly outside: boolean;
}

export interface TableForm {
  /** Its `⟦`. */
  readonly map: Y.Map<unknown>;
  /** Its marks' nesting depth. */
  readonly depth: number;
  /** Its `⟧`, or null when unclosed. */
  readonly closeId: BlockId | null;
  readonly rows: readonly RowForm[];
  /** The carry out of its last row: the heads reaching past its end (their clipped spans depend on the row count). */
  readonly endCarry: Carry;
  readonly rowIndex: ReadonlyMap<BlockId, number>;
  /** `widthCount[w]` = the rows of width w (0 ≤ w ≤ the column cap). */
  readonly widthCount: readonly number[];
  /** The leading run of `header` rows, before crossing spans shrink it (RT4). */
  readonly rawHeaderRun: number;
  /** The rows that join content into an earlier row ({@link RowForm.joinsAbove}). */
  readonly joinsAbove: number;
}

/** The column count: the widest row. O(column cap). */
export function columnCountOf(f: TableForm): number {
  for (let w = f.widthCount.length - 1; w > 0; w--) if ((f.widthCount[w] ?? 0) > 0) return w;
  return 0;
}

/** RT4: the raw header run, shrunk while a span crosses its lower boundary (row h is covered from above). */
export const headerCountOf = (f: TableForm): number => cleanHeaderCount(f, f.rawHeaderRun);

/** The largest header count ≤ `n` (clamped to the rows) whose lower boundary no span crosses. */
export function cleanHeaderCount(f: TableForm, n: number): number {
  let h = Math.max(0, Math.min(n, f.rows.length));
  while (h > 0 && (f.rows[h]?.carryIn.length ?? 0) > 0) h--;
  return h;
}

/** The id of the mark after row `i` (the next `⟨r⟩`, the `⟧`, or the `⟦` of an unclosed table): virtual cell ids. */
export const nextMarkId = (form: TableForm, tableId: BlockId, i: number): BlockId => form.rows[i + 1]?.id ?? form.closeId ?? tableId;

/** A row's slot owners: the heads covering it from above, then its placed cells; undefined = free (a virtual cell). */
export function slotsOf(row: RowForm): (BlockId | undefined)[] {
  const out: (BlockId | undefined)[] = row.carryIn.map((c) => c?.head);
  for (const p of row.placed) for (let dc = 0; dc < p.colSpan; dc++) out[p.gridCol + dc] = p.cellId;
  return out;
}
