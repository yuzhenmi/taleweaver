import type { BlockId } from "../state";
import { formatCounter, type CounterStyle } from "../styles/format-counter";
import type {
  CounterEvent,
  CounterDefs,
  CounterDef,
  CounterLevelDef,
  CounterValue,
} from "./types";

const DEFAULT_LEVEL: CounterLevelDef = {
  style: "decimal",
  start: 1,
  restart: "after-break",
};

function levelConfig(def: CounterDef | undefined, level: number): CounterLevelDef {
  if (def === undefined || def.levels.length === 0) return DEFAULT_LEVEL;
  const clamped = Math.min(level, def.levels.length - 1);
  return def.levels[clamped] ?? DEFAULT_LEVEL;
}

/**
 * Pure render-time numbering engine. Given counter events in document order
 * and per-scope configuration, produces `{ value, formatted }` per event.
 *
 * Per-scope state is a stack of running counters indexed by level. Entering a
 * level resets all deeper levels (CSS-list-like). `breakBefore` restarts the
 * scope's level-0..current chain (the #425 consecutive-run rule). `override`
 * forces a value and the sequence continues from it.
 *
 * This engine handles RENDER-TIME-derivable counters only — counters whose
 * value is fixed by document position + scope/level + explicit restart/override.
 * Layout-dependent restart (e.g. footnote restart-per-page) is NOT modeled here.
 */
export function computeCounters(
  events: ReadonlyArray<CounterEvent>,
  defs: CounterDefs,
): Map<BlockId, CounterValue> {
  const result = new Map<BlockId, CounterValue>();
  const scopes = new Map<string, number[]>();

  for (const event of events) {
    const def = defs.get(event.scopeKey);
    const cfg = levelConfig(def, event.level);

    let counters = scopes.get(event.scopeKey);
    if (counters === undefined || event.breakBefore) {
      counters = [];
      scopes.set(event.scopeKey, counters);
    }

    let value: number;
    const prev = counters[event.level];
    if (event.override !== undefined) {
      value = event.override;
    } else if (prev === undefined) {
      value = cfg.start;
    } else {
      value = prev + 1;
    }

    counters[event.level] = value;
    counters.length = event.level + 1;

    const style: CounterStyle = cfg.style;
    result.set(event.blockId, { value, formatted: formatCounter(value, style) });
  }

  return result;
}
