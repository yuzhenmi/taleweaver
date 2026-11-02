import * as Y from "yjs";
import type { CounterStyle } from "../../styles/format-counter";
import type { ListDef, ListLevelDef, ListRestart } from "../document/types";
import { LIST_DEFS_KEY } from "../storage/keys";
import { childMap } from "../storage/map-reads";

// ---------------------------------------------------------------------------
// List definitions (R11 storage read)
// ---------------------------------------------------------------------------

const MAX_LEVEL = 8;
const LEVEL_FIELDS = ["style", "start", "restart"];
export const DEFAULT_LIST_LEVEL: ListLevelDef = Object.freeze({ style: "decimal", start: 1, restart: "after-break" });
const STYLES: ReadonlySet<unknown> = new Set(["decimal", "lower-alpha", "upper-alpha", "lower-roman", "upper-roman", "disc", "circle", "square"]);
const RESTARTS: ReadonlySet<unknown> = new Set(["always", "never", "after-break"]);
const isStyle = (v: unknown): v is CounterStyle => STYLES.has(v);
const isRestart = (v: unknown): v is ListRestart => RESTARTS.has(v);

/**
 * `listDefs`: `Y.Map<listId, Y.Map>` with flat keys `<level>:style|start|restart`
 * (level written as a plain decimal 0..8; no other spelling is read).
 * Levels run 0..(highest level key); a missing / malformed field takes the default level's.
 */
export function readListDefs(docMap: Y.Map<unknown>): ReadonlyMap<string, ListDef> {
  const out = new Map<string, ListDef>();
  const defs = childMap(docMap, LIST_DEFS_KEY);
  const ids: string[] = [];
  defs?.forEach((_def, listId) => ids.push(listId));
  for (const listId of ids.sort()) {
    const def = defs?.get(listId);
    if (!(def instanceof Y.Map)) continue;
    // Only the exact keys `${n}:style|start|restart`, n = 0..8, are read.
    let top = -1;
    for (let n = 0; n <= MAX_LEVEL; n++) if (LEVEL_FIELDS.some((f) => def.has(`${n}:${f}`))) top = n;
    const levels: ListLevelDef[] = [];
    for (let i = 0; i <= top; i++) {
      const style: unknown = def.get(`${i}:style`);
      const start: unknown = def.get(`${i}:start`);
      const restart: unknown = def.get(`${i}:restart`);
      levels.push(
        Object.freeze({
          style: isStyle(style) ? style : DEFAULT_LIST_LEVEL.style,
          start: typeof start === "number" && Number.isFinite(start) ? start : DEFAULT_LIST_LEVEL.start,
          restart: isRestart(restart) ? restart : DEFAULT_LIST_LEVEL.restart,
        }),
      );
    }
    out.set(listId, Object.freeze({ levels: Object.freeze(levels) }));
  }
  return out;
}
