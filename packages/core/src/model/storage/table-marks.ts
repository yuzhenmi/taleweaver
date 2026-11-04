import * as Y from "yjs";
import { COLS_KEY, DEPTH_KEY, ITEM_KINDS, KIND_KEY, WIDTH_KEY } from "./keys";
import { kindOf } from "./map-reads";
import { mapOf } from "./new-items";
import type { FlatKeys } from "./scalar";

// ---------------------------------------------------------------------------
// Table mark constructors (detached; `keys` are flat: `a:*`, `header`, spans)
// ---------------------------------------------------------------------------

/** `⟦` at depth `d`, with `cols` holding one `{w}` entry per weight. */
export function newTableStart(d: number, weights: readonly number[] = [], keys: FlatKeys = {}): Y.Map<unknown> {
  const cols = new Y.Array<Y.Map<unknown>>();
  cols.insert(0, weights.map((w) => mapOf({ [WIDTH_KEY]: w })));
  return mapOf({ ...keys, [KIND_KEY]: ITEM_KINDS.table, [DEPTH_KEY]: d, [COLS_KEY]: cols });
}

/** `⟨r⟩` at depth `d`. */
export function newRowMark(d: number, keys: FlatKeys = {}): Y.Map<unknown> {
  return mapOf({ ...keys, [KIND_KEY]: ITEM_KINDS.row, [DEPTH_KEY]: d });
}

/** `⟨c⟩` at depth `d`. */
export function newCellMark(d: number, keys: FlatKeys = {}): Y.Map<unknown> {
  return mapOf({ ...keys, [KIND_KEY]: ITEM_KINDS.cell, [DEPTH_KEY]: d });
}

/** `⟧` at depth `d`. */
export function newTableEnd(d: number): Y.Map<unknown> {
  return mapOf({ [KIND_KEY]: ITEM_KINDS.tableEnd, [DEPTH_KEY]: d });
}

/** The nesting depth a mark stores, or null when it is not an integer ≥ 0 (the mark is inert). */
export function markDepth(m: Y.Map<unknown>): number | null {
  const v = m.get(DEPTH_KEY);
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

/** What a table mark does in its bracket (RT1): opens the table, starts a row / a cell, or closes the table. */
export type MarkRole = "open" | "newRow" | "newCell" | "close";

const ROLES: ReadonlyMap<string, MarkRole> = new Map([
  [ITEM_KINDS.table, "open"],
  [ITEM_KINDS.row, "newRow"],
  [ITEM_KINDS.cell, "newCell"],
  [ITEM_KINDS.tableEnd, "close"],
]);

/** The role of a table mark's map, or null when it is no table mark. */
export const markRole = (m: Y.Map<unknown>): MarkRole | null => ROLES.get(kindOf(m)) ?? null;

/** The map is a table's `⟦` (not one of its other marks). */
export const isTableStart = (m: Y.Map<unknown>): boolean => markRole(m) === "open";
