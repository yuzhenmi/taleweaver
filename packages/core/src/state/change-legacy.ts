// DEPRECATED — consumed only by legacy paths during the parallel window
// (editor-state.ts, history-legacy.ts, transformations.ts, formatting.ts,
// typing-session.test.ts, the legacy `Change`/`createChange` re-exports
// in index.ts). The new Y.UndoManager-backed history (state/history.ts)
// does NOT use this. Delete at the P11.4 cutover when the legacy editor
// path is removed.
import type { StateNode } from "./state-node-legacy";

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
