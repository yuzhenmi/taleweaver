import * as Y from "yjs";
import type { CounterStyle } from "../styles/format-counter";
import type { CounterRestart } from "../numbering/types";
import { getListDefsMap, requireInTransaction } from "./yjs-doc";
import type { State } from "./state";
import { STATE_INTERNAL } from "./state-internal";

/**
 * Per-level numbering configuration for a list (structurally a
 * `CounterLevelDef` in numbering/types.ts; restated here so this state-layer
 * config type does not depend on the numbering engine's vocabulary).
 */
export interface ListLevelConfig {
  readonly style: CounterStyle;
  readonly start: number;
  readonly restart: CounterRestart;
}

/** Per-list numbering config: one entry per nesting level. */
export interface ListDef {
  readonly levels: ReadonlyArray<ListLevelConfig>;
}

/** The bullet marker styles — a def whose level-0 style is one of these is unordered. */
const BULLET_STYLES: ReadonlySet<CounterStyle> = new Set<CounterStyle>([
  "disc",
  "circle",
  "square",
]);

/**
 * Classify a list def as ordered (numbered) or unordered (bulleted) by its
 * level-0 marker style. A def with no levels defaults to ordered (degenerate;
 * harmless). Shared by the toggle-list and set-list-type editor handlers so the
 * ordered-vs-unordered rule lives in one place.
 */
export function classifyListDef(def: ListDef): "ordered" | "unordered" {
  const style = def.levels[0]?.style;
  return style !== undefined && BULLET_STYLES.has(style) ? "unordered" : "ordered";
}

/**
 * Guarded read of a required field out of an untyped Yjs `Y.Map<unknown>`.
 * Mirrors snapshot.ts's `requireField`/`requireItemField` idiom: `Y.Map.get`
 * returns `undefined` for an absent key, and a bare `as T` would silently
 * widen that `undefined` to the expected type and crash opaquely downstream.
 * This turns a malformed def (a collab peer / migration that wrote a record
 * missing a required key) into a clear error naming the field — and is the
 * project's stricter alternative to a bare reading-from-Yjs cast.
 */
function requireDefField<T>(yMap: Y.Map<unknown>, what: string, key: string): T {
  const raw = yMap.get(key);
  if (raw === undefined) {
    throw new Error(`listDefs: ${what} missing required "${key}" field`);
  }
  return raw as T;
}

function levelToY(level: ListLevelConfig): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set("style", level.style);
  m.set("start", level.start);
  m.set("restart", level.restart);
  return m;
}

function levelFromY(m: Y.Map<unknown>): ListLevelConfig {
  return {
    style: requireDefField<CounterStyle>(m, "level", "style"),
    start: requireDefField<number>(m, "level", "start"),
    restart: requireDefField<CounterRestart>(m, "level", "restart"),
  };
}

/** Write (or overwrite) a list definition. Must run inside a transaction. */
export function writeListDefInTx(doc: Y.Doc, listId: string, def: ListDef): void {
  requireInTransaction(doc, "writeListDef");
  const defs = getListDefsMap(doc);
  const yDef = new Y.Map<unknown>();
  const yLevels = new Y.Array<Y.Map<unknown>>();
  yLevels.push(def.levels.map(levelToY));
  yDef.set("levels", yLevels);
  defs.set(listId, yDef);
}

/** Read a list definition, or undefined if absent. */
export function getListDef(doc: Y.Doc, listId: string): ListDef | undefined {
  const yDef = getListDefsMap(doc).get(listId);
  if (yDef === undefined) return undefined;
  const yLevels = requireDefField<Y.Array<Y.Map<unknown>>>(
    yDef,
    `def "${listId}"`,
    "levels",
  );
  return { levels: yLevels.map(levelFromY) };
}

/** All defs as a plain Map (for the numbering engine). */
export function getListDefs(doc: Y.Doc): Map<string, ListDef> {
  const out = new Map<string, ListDef>();
  for (const listId of getListDefsMap(doc).keys()) {
    const def = getListDef(doc, listId);
    if (def !== undefined) out.set(listId, def);
  }
  return out;
}

/**
 * All list defs as a plain Map, resolved from a `State` (the render-pass entry
 * point). Reaches the underlying Y.Doc through the STATE_INTERNAL seam — the
 * same encapsulated access the other state-module accessors use — then delegates
 * to `getListDefs`. The numbering engine (`computeCounters`) consumes the result
 * as its `CounterDefs`.
 */
export function getListDefsForState(state: State): Map<string, ListDef> {
  return getListDefs(state[STATE_INTERNAL].doc);
}
