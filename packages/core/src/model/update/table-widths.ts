/**
 * A `cols` edit (column insert / delete, a width change) or a `⟦`'s `a:*` keys (T4) change only the table record's
 * attrs: the table's grid and every other record stay; its attrs are re-read from the `⟦` and its current form.
 */
import * as Y from "yjs";
import type { BlockId } from "../block";
import { tableAttrs } from "../derive/derive-flow";
import { widthsOf } from "../derive/table/form-table";
import { columnCountOf, headerCountOf } from "../derive/table/table-form";
import type { Working } from "../derive/working";
import { typeId } from "../storage/item-id";
import { COLS_KEY } from "../storage/keys";
import { isTableStart } from "../storage/table-marks";

/** The `⟦` whose `cols` array is `t`, or holds entry map `t`; null for any other type. */
export function colsOwner(t: Y.AbstractType<unknown>): Y.Map<unknown> | null {
  const arr = t instanceof Y.Map ? t._item?.parent : t;
  if (!(arr instanceof Y.Array) || arr._item?.parentSub !== COLS_KEY) return null;
  const open = arr._item.parent;
  return open instanceof Y.Map && isTableStart(open) ? open : null;
}

/** Two record attr values equal (a `columnWidths` array by its entries). */
const same = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;

/** Re-put the attrs (`a:*`, RT3 widths, RT4 header count) of the tables of flow `holderId` whose `⟦` is in `opens` (their forms already current). */
export function refreshTableAttrs(w: Working, holderId: BlockId, opens: ReadonlySet<Y.Map<unknown>>): void {
  const fs = w.flows.get(holderId);
  if (fs === undefined) return;
  for (const open of opens) {
    const id = typeId(open);
    const form = id === null ? undefined : fs.tables.get(id);
    const rec = id === null ? undefined : w.get(fs.tree, id);
    if (form === undefined || rec === undefined) continue; // inert, or deleted with its table
    const n = columnCountOf(form);
    const attrs = tableAttrs(open, n === 0 ? null : widthsOf(open, n), headerCountOf(form));
    const keys = new Set([...Object.keys(attrs), ...Object.keys(rec.attrs)]);
    if ([...keys].every((k) => same(attrs[k], rec.attrs[k]))) continue;
    w.put(fs.tree, Object.freeze({ ...rec, attrs }));
  }
}
