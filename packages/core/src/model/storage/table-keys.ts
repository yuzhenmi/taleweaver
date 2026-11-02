import * as Y from "yjs";

// ---------------------------------------------------------------------------
// A RowMap's per-column (cell) keys: `c:<col>:…`
// ---------------------------------------------------------------------------

export const cellFlowKey = (col: string): string => `c:${col}:flow`;
export const cellAttrPrefix = (col: string): string => `c:${col}:a:`;
export const rowSpanKey = (col: string): string => `c:${col}:rowSpanTo`;
export const colSpanKey = (col: string): string => `c:${col}:colSpanTo`;

/** A `c:<col>:flow` key (the shortest is `c::flow`). */
export const isCellFlowKey = (k: string | null): boolean => k !== null && k.length >= 7 && k.startsWith("c:") && k.endsWith(":flow");

/** The slot's flow: `c:<col>:flow` when it is a `Y.Array`, else null (X4). */
export function cellFlowOf(row: Y.Map<unknown>, col: string): Y.Array<Y.Text> | null {
  const f = row.get(cellFlowKey(col));
  return f instanceof Y.Array ? f : null;
}
