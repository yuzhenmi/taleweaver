import * as Y from "yjs";
import type { Selection } from "./block-position";
import type { BlockId } from "./block-id";
import type { OperationResult, State } from "./state";
import { freshState } from "./state";
import { captureDirtyIds, getBlocksMap, getEmbedContentsMap } from "./yjs-doc";
import { STATE_INTERNAL } from "./state-internal";
import { isDevMode } from "./dev-mode";

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
  /**
   * BlockIds whose subtrees were mutated by the undo/redo's reversal.
   * Captured via the same `afterTransaction` mechanism `runTransaction`
   * uses (Y.UndoManager.undo / .redo each wrap their Y.Doc surgery in
   * an internal transaction). Lets the editor's incremental render
   * pipeline rebuild only the affected RenderNodes — without this set
   * an undo on a 100-page doc would force a full re-render.
   */
  readonly dirtyIds: ReadonlySet<BlockId>;
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
      [getBlocksMap(state[STATE_INTERNAL].doc), getEmbedContentsMap(state[STATE_INTERNAL].doc)],
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
   * (`opResult.dirtyIds.size === 0`). Yjs skips no-op groups (verified
   * empirically — see the class-level docstring above for the
   * captureTimeout discussion); calling `commit` anyway would push a
   * selection entry without a matching `undoStack` entry and break
   * alignment. The dev-mode assertion below catches this.
   */
  commit(opResult: OperationResult, selections: SelectionEntry): void {
    // Pre-condition, checked BEFORE any mutation so a misuse throws without
    // leaving the wrapper half-updated (currentState advanced / selection
    // pushed). `dirtyIds.size === 0` is exactly the forbidden no-op: Yjs
    // records no undo group for it, so pushing a selection entry would
    // misalign the stacks. (Sound today because every action handler surfaces
    // its full change set via the FINAL OperationResult it commits; a future
    // compound action whose last op has an empty dirty set must propagate a
    // merged dirty set.) Dev-only — compiled out of production.
    if (isDevMode() && opResult.dirtyIds.size === 0) {
      throw new Error(
        `History.commit: refusing to commit a no-op operation (dirtyIds empty); ` +
          `handlers must short-circuit when opResult.dirtyIds.size === 0.`,
      );
    }
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
   *
   * **Error recovery (T33):** the whole body is wrapped in try/catch.
   * Step order is `undoManager.undo` → `freshState` → stack mutations.
   * If either of the first two throws, the selection stacks remain
   * untouched, so stack alignment is preserved and a retry has the
   * correct shape (note: `undoManager.undo` may have mutated the Y.Doc
   * before throwing — that part is non-recoverable, but the wrapper's
   * accounting stays consistent). Caller sees a wrapped error
   * identifying the failure as history-internal.
   */
  undo(): UndoRedoResult | null {
    if (isDevMode()) {
      if (this.undoSelectionStack.length !== this.undoManager.undoStack.length) {
        throw new Error(
          `History.undo: stack misalignment ` +
            `(undoSelectionStack=${this.undoSelectionStack.length}, ` +
            `undoStack=${this.undoManager.undoStack.length}). ` +
            `An op fired without calling history.commit, ` +
            `or a no-op commit was issued without short-circuit.`,
        );
      }
    }
    if (!this.canUndo()) return null;
    // Peek selection BEFORE any mutation.
    const entry = this.undoSelectionStack[this.undoSelectionStack.length - 1];
    if (entry === undefined) return null;
    try {
      const doc = this.currentState[STATE_INTERNAL].doc;
      // Capture dirty ids from the UndoManager's internal transaction
      // so the editor's incremental render pipeline can rebuild only the
      // reversed blocks (S-A3).
      const dirtyIds = captureDirtyIds(doc, () => this.undoManager.undo());
      // Construct the new state BEFORE mutating stacks. Passing dirtyIds
      // builds the new state's cache as an overlay on the prior cache —
      // unchanged blocks stay warm via fall-through (S-A2 + S-A3).
      // If freshState throws (theoretical OOM), stacks remain untouched
      // and a retry is sound.
      const newState = freshState(this.currentState, dirtyIds);
      this.undoSelectionStack.pop();
      this.redoSelectionStack.push(entry);
      this.currentState = newState;
      return { state: newState, selection: entry.before, dirtyIds };
    } catch (err) {
      // Any throw above leaves the Y.Doc possibly mutated (if undoManager.undo
      // ran) but the selection stacks untouched. Surface a wrapped error.
      throw new Error(
        `History.undo: failed mid-operation, history may be inconsistent: ${err}`,
      );
    }
  }

  /**
   * Re-apply the most recently undone entry. Returns the post-action
   * selection so the caller can restore it. The entry travels back
   * to the undo stack so the cycle can continue.
   *
   * **Error recovery (T33):** mirrored from `undo()` — try/catch wraps
   * the whole body so a Yjs throw or `freshState` allocation failure
   * does not leave the stacks half-mutated.
   */
  redo(): UndoRedoResult | null {
    if (isDevMode()) {
      if (this.redoSelectionStack.length !== this.undoManager.redoStack.length) {
        throw new Error(
          `History.redo: stack misalignment ` +
            `(redoSelectionStack=${this.redoSelectionStack.length}, ` +
            `redoStack=${this.undoManager.redoStack.length}). ` +
            `An op fired without calling history.commit, ` +
            `or a no-op commit was issued without short-circuit.`,
        );
      }
    }
    if (!this.canRedo()) return null;
    const entry = this.redoSelectionStack[this.redoSelectionStack.length - 1];
    if (entry === undefined) return null;
    try {
      const doc = this.currentState[STATE_INTERNAL].doc;
      const dirtyIds = captureDirtyIds(doc, () => this.undoManager.redo());
      // Construct the new state BEFORE mutating stacks (mirrors undo()).
      const newState = freshState(this.currentState, dirtyIds);
      this.redoSelectionStack.pop();
      this.undoSelectionStack.push(entry);
      this.currentState = newState;
      return { state: newState, selection: entry.after, dirtyIds };
    } catch (err) {
      throw new Error(
        `History.redo: failed mid-operation, history may be inconsistent: ${err}`,
      );
    }
  }
}

/** Convenience factory for constructing a `History` instance. */
export function createHistory(state: State): History {
  return new History(state);
}
