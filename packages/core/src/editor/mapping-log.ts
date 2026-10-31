import type { Document } from "../state";
import { IDENTITY_MAPPING, composeMappings, type PositionMapping } from "../state/position-mapping";

/**
 * A bounded log of a controller's recent document transitions and their position
 * mappings, so work computed against an OLDER document Document (an async decoration pass, a
 * debounced host computation) can be mapped onto the current one. `mappingFrom(state)`
 * composes every logged mapping since `document`; it returns `null` when `document` is unknown or
 * has aged out of the log — callers must then treat their positions as unmappable.
 */
export interface MappingLog {
  /** Record the transition `from → to` (a no-op when the Documents are equal). */
  record(from: Document, to: Document, mapping: PositionMapping): void;
  /** The mapping from `document` to the latest recorded Document; IDENTITY when `document` is the
   *  latest; null when `document` is not in the log. */
  mappingFrom(document: Document): PositionMapping | null;
  /** Start (or restart) the log at `document` — e.g. on mount or when the document is replaced. */
  reset(document: Document): void;
  /** The latest Document the log knows (null before the first record/reset). */
  readonly latest: Document | null;
}

interface Entry {
  readonly from: Document;
  readonly to: Document;
  readonly mapping: PositionMapping;
}

/** Default number of transitions kept (a few seconds of fast typing plus async latency). */
export const DEFAULT_MAPPING_LOG_CAPACITY = 512;

export function createMappingLog(capacity = DEFAULT_MAPPING_LOG_CAPACITY): MappingLog {
  const entries: Entry[] = [];
  let latest: Document | null = null;
  return {
    get latest() {
      return latest;
    },
    reset(document) {
      entries.length = 0;
      latest = document;
    },
    record(from, to, mapping) {
      if (from === to) return;
      // A record that doesn't continue the chain (document replaced) restarts it.
      if (latest !== null && from !== latest) entries.length = 0;
      entries.push({ from, to, mapping });
      if (entries.length > capacity) entries.splice(0, entries.length - capacity);
      latest = to;
    },
    mappingFrom(document) {
      if (document === latest) return IDENTITY_MAPPING;
      const start = entries.findIndex((e) => e.from === document);
      if (start < 0) return null;
      return composeMappings(entries.slice(start).map((e) => e.mapping));
    },
  };
}

export { composeMappings } from "../state/position-mapping";
