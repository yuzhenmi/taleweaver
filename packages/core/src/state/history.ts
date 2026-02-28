import type { Change } from "./change";
import type { StateNode } from "./state-node";

/** Collapse threshold in milliseconds: changes within this window are grouped. */
const COLLAPSE_THRESHOLD_MS = 500;

/** Default maximum undo stack depth. */
const DEFAULT_MAX_DEPTH = 500;

export interface History {
  /** Past changes (most recent last). */
  readonly undoStack: readonly Change[];
  /** Future changes for redo (most recent last). */
  readonly redoStack: readonly Change[];
  /** Maximum undo stack depth. Oldest entries are dropped when exceeded. */
  readonly maxDepth: number;
}

/** Create an empty history with optional max depth. */
export function createHistory(maxDepth: number = DEFAULT_MAX_DEPTH): History {
  return Object.freeze({
    undoStack: Object.freeze([]),
    redoStack: Object.freeze([]),
    maxDepth,
  });
}

/**
 * Push a change onto the history.
 * If the change is within the collapse threshold of the *group's start time*,
 * they are merged into one (keeping the oldest oldState and newest newState).
 * The merged entry keeps the *original* timestamp so the collapse window
 * does not roll forward indefinitely.
 * Clears the redo stack.
 */
export function pushChange(
  history: History,
  change: Change,
  collapseThreshold: number = COLLAPSE_THRESHOLD_MS,
): History {
  const undoStack = [...history.undoStack];

  if (undoStack.length > 0) {
    const last = undoStack[undoStack.length - 1];
    if (change.timestamp - last.timestamp <= collapseThreshold) {
      // Collapse: merge with the last change, keeping the ORIGINAL timestamp
      // so the window doesn't slide forward indefinitely
      undoStack[undoStack.length - 1] = Object.freeze({
        oldState: last.oldState,
        newState: change.newState,
        timestamp: last.timestamp, // keep original timestamp
      });
      return Object.freeze({
        undoStack: Object.freeze(undoStack),
        redoStack: Object.freeze([]),
        maxDepth: history.maxDepth,
      });
    }
  }

  undoStack.push(change);

  // Enforce max depth by dropping oldest entries
  if (undoStack.length > history.maxDepth) {
    undoStack.splice(0, undoStack.length - history.maxDepth);
  }

  return Object.freeze({
    undoStack: Object.freeze(undoStack),
    redoStack: Object.freeze([]),
    maxDepth: history.maxDepth,
  });
}

/** Undo the most recent change. Returns the new history and restored state, or null if nothing to undo. */
export function undo(
  history: History,
): { history: History; state: StateNode } | null {
  if (history.undoStack.length === 0) return null;

  const undoStack = [...history.undoStack];
  const change = undoStack.pop()!;
  const redoStack = [...history.redoStack, change];

  return {
    history: Object.freeze({
      undoStack: Object.freeze(undoStack),
      redoStack: Object.freeze(redoStack),
      maxDepth: history.maxDepth,
    }),
    state: change.oldState,
  };
}

/** Redo the most recently undone change. Returns the new history and restored state, or null if nothing to redo. */
export function redo(
  history: History,
): { history: History; state: StateNode } | null {
  if (history.redoStack.length === 0) return null;

  const redoStack = [...history.redoStack];
  const change = redoStack.pop()!;
  const undoStack = [...history.undoStack, change];

  return {
    history: Object.freeze({
      undoStack: Object.freeze(undoStack),
      redoStack: Object.freeze(redoStack),
      maxDepth: history.maxDepth,
    }),
    state: change.newState,
  };
}
