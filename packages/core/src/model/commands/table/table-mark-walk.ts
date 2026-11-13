/** One walk over a table's own marks, for row / column commands that read many of them (N4). */
import type * as Y from "yjs";
import type { BlockId } from "../../block";
import { type StoragePoint, type TerminatorRef, terminatorOf } from "../../position/paragraph-layout";
import { pointOf } from "../../position/storage-points";
import { tableExtent } from "../../position/table-extent";
import type { CellAt } from "./table-at";

/** The marks of a cell's table, read in one walk: a lookup per mark, not a {@link terminatorOf} per mark. */
export interface TableMarks {
  /** The map of the table's own mark `id` (its `⟦`, a `⟨r⟩`, a `⟨c⟩`, its `⟧`). */
  map(id: BlockId): Y.Map<unknown> | null;
  /** The storage point right before mark `id`. */
  point(id: BlockId): StoragePoint | null;
  /** The point where row `i` ends: before the next row's `⟨r⟩`, the `⟧`, or (unclosed) the table's extent end. */
  rowEnd(i: number): StoragePoint | null;
}

/** The marks of `c`'s table; null when its `⟦` does not read. */
export function tableMarks(c: CellAt): TableMarks | null {
  const open = terminatorOf(c.d, c.fs, c.tableId);
  if (open === null) return null;
  const at = new Map<string, TerminatorRef>([[open.token.id, open]]);
  const x = tableExtent(c.fs, open, (t) => at.set(t.token.id, t));
  if (x === null) return null;
  const point = (id: BlockId): StoragePoint | null => {
    const t = at.get(id);
    return t === undefined ? null : pointOf(c.fs, t);
  };
  return {
    map: (id) => at.get(id)?.token.map ?? null,
    point,
    rowEnd: (i) => {
      const next = c.form.rows[i + 1]?.id ?? c.form.closeId;
      return next === null ? x.end : point(next);
    },
  };
}
