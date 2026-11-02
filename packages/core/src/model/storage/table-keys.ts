import * as Y from "yjs";

// ---------------------------------------------------------------------------
// A RowMap's per-column (cell) keys: `c:<col>:…`
// ---------------------------------------------------------------------------

export const cellFlowKey = (col: string): string => `c:${col}:flow`;
export const cellAttrPrefix = (col: string): string => `c:${col}:a:`;
export const rowSpanKey = (col: string): string => `c:${col}:rowSpanTo`;
export const colSpanKey = (col: string): string => `c:${col}:colSpanTo`;

/** The column of a `c:<col>:rowSpanTo` / `c:<col>:colSpanTo` key, else null. */
export function spanKeyCol(k: string): string | null {
  if (!k.startsWith("c:")) return null;
  for (const suffix of [":rowSpanTo", ":colSpanTo"]) if (k.length >= suffix.length + 2 && k.endsWith(suffix)) return k.slice(2, -suffix.length);
  return null;
}

/** A `c:<col>:flow` key (the shortest is `c::flow`). */
export const isCellFlowKey = (k: string | null): k is string => k !== null && k.length >= 7 && k.startsWith("c:") && k.endsWith(":flow");
/** The column of a `c:<col>:flow` key ({@link isCellFlowKey}). */
export const cellFlowCol = (k: string): string => k.slice(2, -5);

/** The slot's flow: `c:<col>:flow` when it is a `Y.Array`, else null (X4). */
export function cellFlowOf(row: Y.Map<unknown>, col: string): Y.Array<Y.Text> | null {
  const f = row.get(cellFlowKey(col));
  return f instanceof Y.Array ? f : null;
}

/**
 * The columns a RowMap key may be the cell flow / attr key of (`c:<col>:flow`,
 * `c:<col>:a:*`; track keys may hold `:`, so every parse counts, a span key's included:
 * `c:x:a:y:rowSpanTo` is also column x's attr `y:rowSpanTo`).
 */
export function cellKeyCols(k: string): string[] {
  const cols: string[] = [];
  if (!k.startsWith("c:")) return cols;
  if (isCellFlowKey(k)) cols.push(cellFlowCol(k));
  for (let p = k.indexOf(":a:", 2); p >= 0; p = k.indexOf(":a:", p + 1)) cols.push(k.slice(2, p));
  return cols;
}
