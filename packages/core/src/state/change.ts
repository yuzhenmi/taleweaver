import type { StateNode } from "./state-node";

/** A reversible change record produced by a transformation. */
export interface Change {
  /** Apply this change to produce the new state. */
  readonly newState: StateNode;
  /** The previous state, for undo. */
  readonly oldState: StateNode;
  /** Timestamp of when the change was created. */
  readonly timestamp: number;
}

/** Create a change record. Timestamp defaults to Date.now() but can be overridden for testing. */
export function createChange(
  oldState: StateNode,
  newState: StateNode,
  timestamp: number = Date.now(),
): Change {
  return Object.freeze({
    oldState,
    newState,
    timestamp,
  });
}
