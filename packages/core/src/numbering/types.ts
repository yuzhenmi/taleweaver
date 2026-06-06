import type { BlockId } from "../state";
import type { CounterStyle } from "../styles/format-counter";

/** A counter scope: all events sharing a scopeKey form one numbering sequence. */
export type CounterScopeKey = string;

/** Restart behavior for a level within a scope. */
export type CounterRestart = "always" | "never" | "after-break";

/** One numbering event in document order (e.g. a list item). */
export interface CounterEvent {
  /** The block this number is attached to (the lookup key in the result). */
  readonly blockId: BlockId;
  /** Which numbering sequence this belongs to (e.g. a listId). */
  readonly scopeKey: CounterScopeKey;
  /** Nesting level within the scope (0-based). */
  readonly level: number;
  /**
   * True when this event is the first of a fresh consecutive run within its
   * scope (an intervening non-scope block separated it from the previous
   * same-scope event). Drives the #425 run-grouping rule.
   */
  readonly breakBefore: boolean;
  /**
   * Explicit per-event counter value (e.g. SET_LIST_RESTART). When set, this
   * event's value becomes `override` and the running counter continues from it.
   */
  readonly override?: number;
}

/** Per-level numbering configuration for a scope. */
export interface CounterLevelDef {
  readonly style: CounterStyle;
  readonly start: number;
  readonly restart: CounterRestart;
}

/** Per-scope configuration: one entry per level. */
export interface CounterDef {
  readonly levels: ReadonlyArray<CounterLevelDef>;
}

/** The computed number for one event. */
export interface CounterValue {
  readonly value: number;
  readonly formatted: string;
}

/** scopeKey → per-level config. */
export type CounterDefs = ReadonlyMap<CounterScopeKey, CounterDef>;
