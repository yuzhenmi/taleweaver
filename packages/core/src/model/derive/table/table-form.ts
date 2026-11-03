/**
 * A table's stored forming state (N2, design F4): what the incremental row splice needs to
 * re-form from the first touched row forward without reading the rows above it.
 */
import type * as Y from "yjs";
import type { BlockId } from "../../block";
import type { Carry, PlacedCell } from "../../../table-grid/assign-table-grid";

export interface RowForm {
  /** The row's `⟨r⟩`. */
  readonly id: BlockId;
  /** The slots covered from above (stored spans). */
  readonly carryIn: Carry;
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
export function headerCountOf(f: TableForm): number {
  let h = f.rawHeaderRun;
  while (h > 0 && (f.rows[h]?.carryIn.length ?? 0) > 0) h--;
  return h;
}
