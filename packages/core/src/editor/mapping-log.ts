import type { State } from "../state";
import { IDENTITY_MAPPING, composeMappings, type PositionMapping } from "../state/position-mapping";

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

export { composeMappings } from "../state/position-mapping";
