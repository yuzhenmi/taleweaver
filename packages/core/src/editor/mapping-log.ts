import type { BlockId, Position, State } from "../state";
import { IDENTITY_MAPPING, type Assoc, type MappedPosition, type PositionMapping } from "../state/position-mapping";

/**
 * A bounded log of a controller's recent document transitions and their position
 * mappings, so work computed against an OLDER document State (an async decoration pass, a
 * debounced host computation) can be mapped onto the current one. `mappingFrom(state)`
 * composes every logged mapping since `state`; it returns `null` when `state` is unknown or
 * has aged out of the log — callers must then treat their positions as unmappable.
 */
export interface MappingLog {
  /** Record the transition `from → to` (a no-op when the States are equal). */
  record(from: State, to: State, mapping: PositionMapping): void;
  /** The mapping from `state` to the latest recorded State; IDENTITY when `state` is the
   *  latest; null when `state` is not in the log. */
  mappingFrom(state: State): PositionMapping | null;
  /** Start (or restart) the log at `state` — e.g. on mount or when the document is replaced. */
  reset(state: State): void;
  /** The latest State the log knows (null before the first record/reset). */
  readonly latest: State | null;
}

interface Entry {
  readonly from: State;
  readonly to: State;
  readonly mapping: PositionMapping;
}

/** Default number of transitions kept (a few seconds of fast typing plus async latency). */
export const DEFAULT_MAPPING_LOG_CAPACITY = 512;

export function createMappingLog(capacity = DEFAULT_MAPPING_LOG_CAPACITY): MappingLog {
  const entries: Entry[] = [];
  let latest: State | null = null;
  return {
    get latest() {
      return latest;
    },
    reset(state) {
      entries.length = 0;
      latest = state;
    },
    record(from, to, mapping) {
      if (from === to) return;
      // A record that doesn't continue the chain (document replaced) restarts it.
      if (latest !== null && from !== latest) entries.length = 0;
      entries.push({ from, to, mapping });
      if (entries.length > capacity) entries.splice(0, entries.length - capacity);
      latest = to;
    },
    mappingFrom(state) {
      if (state === latest) return IDENTITY_MAPPING;
      const start = entries.findIndex((e) => e.from === state);
      if (start < 0) return null;
      return composeMappings(entries.slice(start).map((e) => e.mapping));
    },
  };
}

/** Apply `mappings` in order. */
export function composeMappings(mappings: readonly PositionMapping[]): PositionMapping {
  const live = mappings.filter((m) => !m.identity);
  if (live.length === 0) return IDENTITY_MAPPING;
  const only = live[0];
  if (live.length === 1 && only !== undefined) return only;
  let dirty: Set<BlockId> | null = new Set();
  for (const m of live) {
    if (m.dirty === null || dirty === null) dirty = null;
    else for (const id of m.dirty) dirty.add(id);
  }
  return {
    identity: false,
    dirty,
    map(position: Position, assoc: Assoc = 1): MappedPosition {
      let pos: Position | null = position;
      let deleted = false;
      for (const m of live) {
        if (pos === null) break;
        const r = m.map(pos, assoc);
        pos = r.position;
        deleted = deleted || r.deleted;
      }
      return { position: pos, deleted: deleted || pos === null };
    },
    touches(from: Position, to: Position): boolean {
      // Conservative across steps: true unless every step provably left the range alone.
      let a: Position | null = from;
      let b: Position | null = to;
      for (const m of live) {
        if (a === null || b === null) return true;
        if (m.touches(a, b)) return true;
        a = m.map(a, 1).position;
        b = m.map(b, -1).position;
      }
      return false;
    },
  };
}
