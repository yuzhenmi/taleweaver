import * as Y from "yjs";
import { COLS_KEY, ITEM_KINDS, KIND_KEY, ROWS_KEY, TRACK_KEY, WEIGHT_KEY } from "./keys";
import { mapOf, newFlow } from "./new-items";
import type { FlatKeys } from "./scalar";
import { cellFlowKey } from "./table-keys";

// ---------------------------------------------------------------------------
// Table constructors (detached; nested types are created with their parent, G1)
// ---------------------------------------------------------------------------

/** A ColMap: `{key, weight?}`. */
export function newColMap(key: string, weight?: number): Y.Map<unknown> {
  return mapOf(weight === undefined ? { [TRACK_KEY]: key } : { [TRACK_KEY]: key, [WEIGHT_KEY]: weight });
}

/** A RowMap with a one-¶ flow in every column's slot (G1 / G3) and flat `keys` (`header`, `a:*`, `c:<col>:a:*`). */
export function newRowMap(key: string, colKeys: readonly string[], keys: FlatKeys = {}): Y.Map<unknown> {
  const e: Record<string, unknown> = { ...keys, [TRACK_KEY]: key };
  for (const c of colKeys) e[cellFlowKey(c)] = newFlow();
  return mapOf(e);
}

/** A table map holding `rows` (RowMaps) and `cols` (ColMaps), with flat `keys` (`a:*`). */
export function newTable(rows: readonly Y.Map<unknown>[], cols: readonly Y.Map<unknown>[], keys: FlatKeys = {}): Y.Map<unknown> {
  const r = new Y.Array<Y.Map<unknown>>();
  r.insert(0, rows.slice());
  const c = new Y.Array<Y.Map<unknown>>();
  c.insert(0, cols.slice());
  return mapOf({ ...keys, [KIND_KEY]: ITEM_KINDS.table, [ROWS_KEY]: r, [COLS_KEY]: c });
}
