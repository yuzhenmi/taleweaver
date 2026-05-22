import * as Y from "yjs";
import type { Selection } from "./block-position";
import type { OperationResult, State } from "./state";
import { freshState } from "./state";
import { getBlocksMap, getEmbedContentsMap } from "./yjs-doc";

/**
 * True iff we should run dev-mode invariant checks. Reads `process.env`
 * defensively because the engine compiles for browsers (no `process`
 * global) — `globalThis` is the safe vehicle and the typeof guard keeps
 * us from referencing a missing identifier.
 */
function isDevMode(): boolean {
  const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process;
  return proc?.env?.NODE_ENV !== "production";
}

/**
 * One entry on the undo / redo selection stacks: the pre-action and
 * post-action selections captured at commit time.
 *
 * The stacks hold the SAME shape: when an entry moves from undo→redo
 * (via `undo()`) or redo→undo (via `redo()`), the pair travels intact
 * so both directions of traversal can return the correct side.
 */
export interface SelectionEntry {
  readonly before: Selection | null;
  readonly after: Selection | null;
}

export interface UndoRedoResult {
  readonly state: State;
  readonly selection: Selection | null;
}

/**
 * Yjs-backed history wrapper. Mutable internal state — instances live
 * alongside an `EditorState`-like container and produce fresh State
 * references on undo/redo (so consumers can use `oldState !== newState`
 * to detect changes).
 *
 * Selection is per-client local state (not in Y.Doc); tracked separately
 * in the per-entry pairs and returned on undo/redo for the caller to apply.
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
 *
 * ## Yjs no-op behavior (empirical, see history.test.ts)
 *
 * Under both `captureTimeout: 0` AND `captureTimeout:
 * Number.MAX_SAFE_INTEGER`, an empty transaction followed by
 * `stopCapturing()` does NOT increment `undoManager.undoStack.length`.
 * Yjs skips no-op groups. Consequence: action handlers MUST short-circuit
 * BEFORE calling `commit` on a no-op operation (e.g., check
 * `opResult.dirtyIds.size === 0`). The dev-mode write-time assertion in
 * `commit` catches accidental violations of this contract.
 *
 * ## Multi-transaction grouping
 *
 * Empirically, under `captureTimeout: Number.MAX_SAFE_INTEGER` Yjs MERGES
 * consecutive `doc.transact` calls into a single undo group until
 * `stopCapturing()` is called. This is the configuration we want: action
 * handlers may compose multiple internal ops (each its own
 * `doc.transact`), and they collapse to one undo entry at the action
 * boundary marked by `commit`. Under `captureTimeout: 0` Yjs would split
 * every transaction into its own undo group, breaking the alignment
 * invariant for any handler that chains ops.
 */
export class History {
  private readonly undoManager: Y.UndoManager;
  private currentState: State;
  /**
   * Selection-entry stack aligned 1:1 with `undoManager.undoStack`.
   * Each entry stores BOTH the pre-action and post-action selection so
   * `undo()` can return `before` and `redo()` (after the entry has
   * traveled to the redo stack) can return `after`.
   *
   * Alignment invariant: `commit()` is the ONLY caller of
   * `stopCapturing()`. Because `captureTimeout: Number.MAX_SAFE_INTEGER`
   * disables time-based group closure, every transaction since the prior
   * `commit()` merges into one undo group, and `commit()` closes it.
   * Therefore each call to `commit()` corresponds 1:1 with one UndoManager
   * undo-stack entry — provided the action mutated tracked types (Yjs
   * skips no-op groups, so handlers must short-circuit when
   * `opResult.dirtyIds.size === 0`). Hence
   * `undoSelectionStack.length === undoManager.undoStack.length` holds
   * after every `commit()`. The same invariant holds for redo.
   */
  private readonly undoSelectionStack: SelectionEntry[] = [];
  /** Selection-entry stack aligned 1:1 with `undoManager.redoStack`. */
  private readonly redoSelectionStack: SelectionEntry[] = [];

  constructor(state: State) {
    this.currentState = state;
    this.undoManager = new Y.UndoManager(
      [getBlocksMap(state.doc), getEmbedContentsMap(state.doc)],
      {
        // captureTimeout: Number.MAX_SAFE_INTEGER means "never auto-close
        // groups based on wall-clock time"; we control grouping entirely
        // via explicit `commit` calls (each one fires `stopCapturing`,
        // which closes the current group). This lets a single action
        // handler chain multiple `applyOperation` calls (deleteRange +
        // insertText, type + attrs, etc.) and have them merge into ONE
        // undo entry — matching user-facing "one action = one undo".
        //
        // We do NOT use `captureTimeout: 0`. That config would split every
        // `doc.transact` into its own undo entry, breaking action-level
        // grouping and the `undoSelectionStack.length === undoStack.length`
        // alignment invariant for any handler that composes ops.
        captureTimeout: Number.MAX_SAFE_INTEGER,
        // Only track transactions with our default origin (null). Future
        // non-undoable mutations (e.g., remote collab edits) can opt OUT
        // of undo tracking by using a tagged origin.
        trackedOrigins: new Set([null]),
      },
    );
  }

  /**
   * Record an undo entry. Updates the wrapper's notion of current state,
   * closes the current Y.UndoManager capture group, records the
   * before/after selection pair, and clears the redo stack.
   *
   * **Contract:** callers MUST NOT invoke `commit` on a no-op operation
   * (`opResult.dirtyIds.size === 0`). Yjs skips no-op groups under
   * `captureTimeout: 0`; calling `commit` anyway would push a selection
   * entry without a matching `undoStack` entry and break alignment. The
   * dev-mode assertion below catches this.
   */
  commit(opResult: OperationResult, selections: SelectionEntry): void {
    this.currentState = opResult.state;
    this.undoManager.stopCapturing();
    this.undoSelectionStack.push(selections);
    this.redoSelectionStack.length = 0;
    if (isDevMode()) {
      if (this.undoSelectionStack.length !== this.undoManager.undoStack.length) {
        throw new Error(
          `History.commit: stack alignment broken ` +
            `(undoSelectionStack=${this.undoSelectionStack.length}, ` +
            `undoStack=${this.undoManager.undoStack.length}). ` +
            `Did a handler call commit on a no-op operation? ` +
            `Handlers must short-circuit when opResult.dirtyIds.size === 0.`,
        );
      }
    }
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  /**
   * Pop the latest undo entry: mutate Y.Doc back, mint a fresh State,
   * and return the pre-action selection so the caller can restore it.
   * The popped entry travels intact to the redo stack so a subsequent
   * `redo()` can return its `after` side. Returns null if nothing to undo.
   */
  undo(): UndoRedoResult | null {
    if (!this.canUndo()) return null;
    const entry = this.undoSelectionStack[this.undoSelectionStack.length - 1];
    if (entry === undefined) return null;
    this.undoManager.undo();
    this.undoSelectionStack.pop();
    this.redoSelectionStack.push(entry);
    this.currentState = freshState(this.currentState);
    return { state: this.currentState, selection: entry.before };
  }

  /**
   * Re-apply the most recently undone entry. Returns the post-action
   * selection so the caller can restore it. The entry travels back
   * to the undo stack so the cycle can continue.
   */
  redo(): UndoRedoResult | null {
    if (!this.canRedo()) return null;
    const entry = this.redoSelectionStack[this.redoSelectionStack.length - 1];
    if (entry === undefined) return null;
    this.undoManager.redo();
    this.redoSelectionStack.pop();
    this.undoSelectionStack.push(entry);
    this.currentState = freshState(this.currentState);
    return { state: this.currentState, selection: entry.after };
  }
}

/** Convenience factory for constructing a `History` instance. */
export function createHistory(state: State): History {
  return new History(state);
}
