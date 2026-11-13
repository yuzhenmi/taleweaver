import { DEFAULT_LIST_LEVEL } from "../derive/list-defs";
import type { Document, ListLevelDef } from "./types";

/** Highest list level a paragraph can have. */
export const MAX_LIST_LEVEL = 8;

/** R11: the level config of `level` in list `listId`: a missing def → default; level clamped to min(level, levels − 1, 8). */
export function listLevelConfig(d: Document, listId: string, level: number): ListLevelDef {
  const def = d.listDefs.get(listId);
  if (def === undefined || def.levels.length === 0) return DEFAULT_LIST_LEVEL;
  const l = Math.max(0, Math.min(Number.isInteger(level) ? level : 0, def.levels.length - 1, MAX_LIST_LEVEL));
  return def.levels[l] ?? DEFAULT_LIST_LEVEL;
}
