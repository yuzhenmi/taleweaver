import * as Y from "yjs";
import type { State } from "./state";
import { freshState } from "./state";
import { getBlocksMap, getEmbedContentsMap } from "./yjs-doc";

export interface PushHistoryArgs {
  selection: unknown | null;
}

export interface UndoRedoResult {
  readonly state: State;
  readonly selection: unknown | null;
}

/**
 * Yjs-backed history wrapper. Mutable internal state — instances live
 * alongside an `EditorState`-like container and produce fresh State
 * references on undo/redo (so consumers can use `oldState !== newState`
 * to detect changes).
 *
 * Selection is per-client local state (not in Y.Doc); tracked separately
 * in parallel stacks and returned on undo/redo for the caller to apply.
 *
 * Per Decision D point 9: during P11.0+ parallel window the editor
 * wraps this in a backend-selector that also delegates to a legacy
 * EditorHistory. Within P4e, this is the only backend.
 *
 * **Meta-map exclusion (intentional).** The Y.UndoManager is constructed
 * with ONLY the blocks map and the embedContents map as tracked scopes.
 * Writes to the doc's meta Y.Map (see `getMetaMap` in `yjs-doc.ts`) are
 * deliberately NOT undoable. Today the meta map holds only `rootId`,
 * which is immutable for the lifetime of a session (created once in
 * `createYDoc`, never reassigned). Because that single field never
 * changes after document construction, there is nothing to undo and no
 * observable behavior gap.
 *
 * If a future caller adds a new meta-map writer, they MUST consider
 * undoability explicitly. Either (a) the new field is also genuinely
 * immutable / session-scoped (e.g. format version, doc id) and the
 * non-undoable behavior is correct, in which case document the intent
 * at the write site; or (b) the new field needs undo coverage, in
 * which case extend the UndoManager's tracked-types list here AND
 * update this docstring. Silently writing to meta produces non-undoable
 * changes — that is a footgun, not a feature.
 */
export class History {
  private readonly undoManager: Y.UndoManager;
  private currentState: State;
  /**
   * Selection snapshots paired with the UndoManager's undo stack.
   *
   * Alignment invariant: `push()` is the ONLY caller of
   * `undoManager.stopCapturing()`. Because `captureTimeout: 0` means
   * the UndoManager doesn't auto-close groups based on time, each
   * call to `push()` corresponds 1:1 with one UndoManager undo-stack
   * entry (since the prior transaction's group is closed at exactly
   * that point). Therefore `selectionStack.length === undoManager.undoStack.length`
   * after every `push()`. The same invariant holds for redo.
   *
   * CAVEAT: if a transaction runs WITHOUT a subsequent `push()`, the
   * UndoManager still records it as a separate undo entry the next time
   * `stopCapturing` fires (or on the next transaction with a different
   * origin). In our model, every action handler is expected to call
   * `push()` after producing an OperationResult — that's the action
   * boundary. Tests verifying alignment should assert the invariant.
   */
  private readonly selectionStack: Array<unknown | null> = [];
  /** Selection snapshots aligned with the UndoManager's redo stack. */
  private readonly redoSelectionStack: Array<unknown | null> = [];

  constructor(state: State) {
    this.currentState = state;
    this.undoManager = new Y.UndoManager(
      [getBlocksMap(state.doc), getEmbedContentsMap(state.doc)],
      {
        // captureTimeout: 0 — we control grouping via explicit `push` calls.
        captureTimeout: 0,
        // Only track transactions with our default origin (null). Rebuilds
        // (post-P11.0) will use a tagged origin to opt OUT of undo tracking.
        trackedOrigins: new Set([null]),
      },
    );
  }

  /**
   * Replace the wrapper's notion of "current state" after an external op.
   *
   * Contract: consumers SHOULD call `setState(opResult.state)` after every
   * op that mutates the Y.Doc, before the next `push()`. Skipping this
   * works for undo/redo correctness (because `freshState` always re-reads
   * from the live Y.Doc), but the wrapper's `currentState` snapshot cache
   * may then lag behind reality between op and undo. P11.0's bridge
   * wrapper may fold this into `push()` directly — deferred until then so
   * the final API shape can be chosen with full parallel-window context.
   */
  setState(state: State): void {
    this.currentState = state;
  }

  /**
   * Close the current undo group and record an entry boundary. The
   * provided selection (opaque) is stored alongside this entry for
   * restoration on undo. Clears the redo stack.
   */
  push(args: PushHistoryArgs): void {
    this.undoManager.stopCapturing();
    this.selectionStack.push(args.selection);
    this.redoSelectionStack.length = 0;
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  /**
   * Pop the latest undo entry: mutate Y.Doc back, restore selection,
   * mint a fresh State (new snapshot cache). Returns null if nothing
   * to undo.
   */
  undo(): UndoRedoResult | null {
    if (!this.canUndo()) return null;
    this.undoManager.undo();
    const selection = this.selectionStack.pop() ?? null;
    this.redoSelectionStack.push(selection);
    this.currentState = freshState(this.currentState);
    return { state: this.currentState, selection };
  }

  /**
   * Re-apply the most recently undone entry.
   */
  redo(): UndoRedoResult | null {
    if (!this.canRedo()) return null;
    this.undoManager.redo();
    const selection = this.redoSelectionStack.pop() ?? null;
    this.selectionStack.push(selection);
    this.currentState = freshState(this.currentState);
    return { state: this.currentState, selection };
  }
}

/** Convenience factory matching the legacy API shape. */
export function createHistory(state: State): History {
  return new History(state);
}
