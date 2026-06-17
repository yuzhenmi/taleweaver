import * as Y from "yjs";
import type { Selection } from "./block-position";
import type { BlockId } from "./block-id";
import type { OperationResult, State } from "./state";
import { freshState } from "./state";
import {
  captureDirtyIds,
  getBlocksMap,
  getCommentsMap,
  getEmbedContentsMap,
  getListDefsMap,
  getSuggestionsMap,
  getTemplateContentsMap,
} from "./yjs-doc";
import { STATE_INTERNAL } from "./state-internal";
import { isDevMode } from "./dev-mode";

/**
 * One entry on the undo / redo stacks: the pre-action and post-action
 * selections captured at commit time.
 *
 * A `SelectionEntry` does NOT live in its own parallel array. Instead it is
 * welded onto the `Y.UndoManager` StackItem it belongs to via the item's
 * `.meta` map (Yjs's documented "save/restore metadata like selection range"
 * channel — see `StackItem.meta`). Binding it to the live item means it
 * CANNOT index-desync from the Yjs stack regardless of how Yjs reshuffles the
 * items (redo-clear on a new edit, group merge, depth-cap trim, etc.).
 *
 * `commit()` writes the pair onto the just-closed undo item. `undo()` /
 * `redo()` read it back off the popped item, then RE-WELD it onto the
 * opposite stack's new top item: Yjs does NOT copy `.meta` across undo↔redo —
 * each direction creates a brand-new StackItem on the opposite stack with an
 * empty `.meta` (empirically verified). The re-weld in `undo`/`redo` keeps the
 * entry bound to whichever live item currently represents this action, so the
 * cycle stays sound across arbitrarily many undo↔redo flips.
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
 * A Yjs undo/redo StackItem. Yjs's index barrel does not re-export the
 * `StackItem` class, so we derive its type structurally from the return type
 * of `UndoManager.undo()` (`StackItem | null`). This stays correct across
 * Yjs 13.x without naming an unexported symbol.
 */
type YStackItem = NonNullable<ReturnType<Y.UndoManager["undo"]>>;

/**
 * Module-private key under which a `SelectionEntry` is stored on a
 * `Y.UndoManager` StackItem's `.meta` map. A symbol (not a string) keeps the
 * key from ever colliding with any future meta writer's key.
 */
const SEL_KEY: unique symbol = Symbol("taleweaver.history.selectionEntry");

/**
 * Read the `SelectionEntry` welded onto a StackItem's `.meta`. Returns null
 * if absent — which, in correct operation, never happens: `commit()` writes
 * the entry onto every item it produces. A null here means a tracked edit
 * fired without a matching `commit` (the dev assertion in `undo`/`redo`
 * surfaces it).
 */
function readSelectionEntry(item: YStackItem): SelectionEntry | null {
  const entry = item.meta.get(SEL_KEY);
  return entry === undefined ? null : (entry as SelectionEntry);
}

/**
 * Yjs-backed history wrapper. Mutable internal state — instances live
 * alongside an `EditorState`-like container and produce fresh State
 * references on undo/redo (so consumers can use `oldState !== newState`
 * to detect changes).
 *
 * Selection is per-client local state (not in Y.Doc); the before/after pair
 * is welded onto the owning `Y.UndoManager` StackItem via its `.meta` map
 * (see `SelectionEntry`), so it stays bound to the live item and can never
 * desync from the Yjs stack. There is no parallel selection array. (Yjs does
 * not copy `.meta` across undo↔redo, so `undo`/`redo` re-weld it onto the
 * opposite stack's new item — see `SelectionEntry`.)
 *
 * **Meta-map exclusion (intentional).** The Y.UndoManager is constructed
 * with the blocks map, the embedContents map, the templateContents map, the
 * listDefs config side-table, the comments side-table, and the suggestions
 * side-table as tracked scopes.
 * Tracking the comments map makes a comment thread record revert ATOMICALLY
 * with its in-content `comment-start`/`comment-end` markers (undoable-as-
 * content; the markers live in the tracked block trees) — a comment is one undo
 * unit. Tracking the suggestions map makes a tracked-change record revert
 * atomically with the inline `insertion/deletion/formattingSuggestionId` attrs
 * (and the block-join/split break embeds) that carry its id — a suggestion is
 * one undo unit, same as a comment. Per-TRANSACTION tracking (Yjs reverts the
 * types a transaction changed,
 * not a whole map) means a pure text edit, which never touches the comments
 * or suggestions map, is undone WITHOUT affecting any comment or suggestion.
 * Writes to the doc's meta
 * Y.Map (see `getMetaMap` in `yjs-doc.ts`) are deliberately NOT undoable. Today the meta map holds only `rootId`,
 * which is immutable for the lifetime of a session (created once in
 * `createYDoc`, never reassigned). Because that single field never
 * changes after document construction, there is nothing to undo and no
 * observable behavior gap.
 *
 * (Distinct concept: the doc's meta Y.Map above is unrelated to the
 * `StackItem.meta` map used here to carry `SelectionEntry`. The former is a
 * Y type inside the document; the latter is plain client-local metadata on
 * a Yjs undo StackItem. Don't conflate them.)
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
 * Yjs skips no-op groups, so a no-op `commit` would have no StackItem to
 * attach the SelectionEntry to. Rather than impose a contract on callers,
 * `commit` is itself no-op-safe: an `OperationResult` with empty
 * `dirtyIds` is silently dropped (no StackItem produced, no selection
 * recorded, `currentState` unchanged). Action handlers conventionally
 * short-circuit FIRST via the T7 identity contract
 * (`result.state === editor.state`) — that returns the SAME editor
 * reference on no-ops, the editor module's invariant — but commit does
 * not depend on it for soundness.
 *
 * ## Multi-transaction grouping
 *
 * Empirically, under `captureTimeout: Number.MAX_SAFE_INTEGER` Yjs MERGES
 * consecutive `doc.transact` calls into a single undo group until
 * `stopCapturing()` is called. This is the configuration we want: action
 * handlers may compose multiple internal ops (each its own
 * `doc.transact`), and they collapse to one undo entry at the action
 * boundary marked by `commit`. Under `captureTimeout: 0` Yjs would split
 * every transaction into its own undo group. Because the SelectionEntry is
 * written AT commit onto the (then-merged) top-of-undoStack item — NOT in a
 * `stack-item-added` handler — the grouping is transparent to selection
 * storage: a multi-`transact` action fires `-added` then `-updated`, but at
 * commit time exactly one merged item exists to receive the entry.
 *
 * ## Undo-depth cap
 *
 * Y.UndoManager has no built-in maxDepth, so `commit` trims the OLDEST
 * entries from the undo stack once `maxDepth` (default
 * `DEFAULT_MAX_UNDO_DEPTH`) is exceeded — bounding long-session memory at
 * the cost of making the most distant history non-undoable. Each trimmed
 * item carries its own `.meta` (and thus its SelectionEntry) away with it;
 * there is no second structure to keep in lockstep. See `commit`.
 */
/**
 * Default cap on undo-stack depth. `Y.UndoManager` has no built-in maxDepth;
 * without a cap the undo stack — and the DeleteSets each `StackItem` retains
 * to be able to reverse its group — grows unbounded across a long editing
 * session. 1000 actions is generous for a word processor (well past any
 * realistic single-session undo reach) while bounding worst-case memory.
 */
const DEFAULT_MAX_UNDO_DEPTH = 1000;

/**
 * Pause window (ms) for typing coalescing (#420). Consecutive same-kind text
 * edits whose gap is `< UNDO_COALESCE_PAUSE_MS` merge into one undo unit; a
 * longer gap starts a fresh unit. Time is supplied by the caller (the reducer's
 * injected clock), so this is deterministic in tests. ~500ms matches the
 * ProseMirror default and a Google-Docs-ish feel; tunable in-browser.
 */
export const UNDO_COALESCE_PAUSE_MS = 500;

/** The coalescing classes `beginEntry` accepts (selection/inert are filtered upstream). */
export type BeginKey = "insert" | "delete" | "command";

export class History {
  private readonly undoManager: Y.UndoManager;
  private readonly maxDepth: number;
  private currentState: State;

  // Typing-coalescing state (#420). `coalesceKey` is the open group's kind, or
  // null when no coalescible group is open. `lastEditTime` is the injected-clock
  // time of the last edit in the open group. `didCoalesce` records whether the
  // most recent `beginEntry` merged into the open group (read by `commit` to
  // decide selection-meta handling).
  private coalesceKey: BeginKey | null = null;
  private lastEditTime = 0;
  private didCoalesce = false;

  constructor(
    state: State,
    maxDepth: number = DEFAULT_MAX_UNDO_DEPTH,
    trackedOrigin: unknown = null,
  ) {
    if (maxDepth < 1) {
      throw new Error(`History: maxDepth must be >= 1, got ${maxDepth}`);
    }
    this.maxDepth = maxDepth;
    this.currentState = state;
    this.undoManager = new Y.UndoManager(
      [
        getBlocksMap(state[STATE_INTERNAL].doc),
        getEmbedContentsMap(state[STATE_INTERNAL].doc),
        getTemplateContentsMap(state[STATE_INTERNAL].doc),
        getListDefsMap(state[STATE_INTERNAL].doc),
        getCommentsMap(state[STATE_INTERNAL].doc),
        getSuggestionsMap(state[STATE_INTERNAL].doc),
      ],
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
        // grouping (each `applyOperation` would become its own undo step).
        captureTimeout: Number.MAX_SAFE_INTEGER,
        // Track ONLY transactions tagged with this editor's `trackedOrigin`
        // (default `null` — the single-editor case, Yjs's default origin). A
        // collab host passes its distinct peer origin here AND tags all its edits
        // with the same origin (via `runWithTransactionOrigin`): its own edits stay
        // undoable, while a REMOTE peer's edits (a different origin) and the
        // non-undoable suggestion-resolve ops (SUGGESTION_RESOLVE_ORIGIN) are
        // excluded — so undo isolation across collaborators falls out for free.
        trackedOrigins: new Set([trackedOrigin]),
      },
    );
  }

  /**
   * Open the undo group for an about-to-be-applied committing action (#420).
   * MUST be called BEFORE the action's `applyOperation` (with `captureTimeout:
   * MAX`, a transaction merges into the currently-open StackItem unless
   * `stopCapturing` was already called — so the break decision has to precede
   * the transaction).
   *
   * Coalesces with the open group iff: the key is coalescible (`insert`/
   * `delete`), matches the open group's key, and the gap since the last edit is
   * `< UNDO_COALESCE_PAUSE_MS`. Otherwise it closes the open group
   * (`stopCapturing`) so this action starts a fresh undo entry. Commands never
   * coalesce (their `coalesceKey` is set to null, so the next action also
   * breaks).
   */
  beginEntry(key: BeginKey, now: number): void {
    const coalescible = key === "insert" || key === "delete";
    const canCoalesce =
      coalescible &&
      key === this.coalesceKey &&
      now - this.lastEditTime < UNDO_COALESCE_PAUSE_MS;
    if (!canCoalesce) {
      // Close the previous group so this action's transaction starts a new item.
      this.undoManager.stopCapturing();
    }
    this.didCoalesce = canCoalesce;
    this.coalesceKey = coalescible ? key : null;
    this.lastEditTime = now;
  }

  /**
   * Close the open undo group without recording an entry (#420). Called on
   * selection jumps (caret move / click) and on undo/redo, so the next edit
   * starts a fresh undo unit. Idempotent and cheap.
   */
  breakCoalescing(): void {
    this.undoManager.stopCapturing();
    this.coalesceKey = null;
  }

  /**
   * Record an undo entry. Updates the wrapper's notion of current state and
   * welds the before/after selection pair onto the action's StackItem `.meta`.
   *
   * Undo-group BOUNDARIES are no longer owned here (#420): `beginEntry` (called
   * before each committing action) and `breakCoalescing` (on selection jumps /
   * undo/redo) decide whether the action opens a fresh group or merges into the
   * open one via `stopCapturing`. `commit` only writes selection meta. The
   * action's transaction has already pushed/merged its StackItem onto
   * `undoStack` (Yjs does this in `afterTransaction`, before `commit` runs), so
   * the top item is locatable without any `stopCapturing` call here.
   *
   * **Coalesced merges preserve the group's original `before` selection.** When
   * `beginEntry` merged this action into the open group (`didCoalesce`), the top
   * item is the SAME StackItem the previous edit committed to and already
   * carries this group's `SelectionEntry`; `commit` keeps its `before` and
   * advances only `after`. On a fresh group it writes the full pair.
   *
   * Yjs clears its own redo stack on any new tracked edit (in its
   * `afterTransaction` handler, BEFORE this `commit` runs), so there is
   * nothing for `commit` to clear — the redo entries (and their `.meta`)
   * are already gone.
   *
   * **No-ops are silently dropped.** An `OperationResult` with
   * `dirtyIds.size === 0` produces no StackItem (Yjs skips no-op groups —
   * see the class-level docstring), so there is nothing to weld the
   * SelectionEntry onto and nothing to record. The early return below
   * keeps the wrapper consistent in that case. Handlers conventionally
   * short-circuit first via the T7 identity contract
   * (`result.state === editor.state`), which is the editor module's
   * same-reference-on-no-op invariant; commit's no-op safety is the
   * backstop, not a substitute.
   */
  commit(opResult: OperationResult, selections: SelectionEntry): void {
    // No-op shortcut, checked BEFORE any mutation. With empty `dirtyIds`,
    // Yjs records no undo group: there is no fresh StackItem to receive the
    // SelectionEntry, so welding `selections` onto the (stale) top item would
    // OVERWRITE the prior action's selection (or, on an empty stack, surface
    // the "no StackItem" error below). Returning early is the safe and
    // correct outcome — nothing happened, so we record nothing.
    if (opResult.dirtyIds.size === 0) {
      return;
    }
    // The action's transaction has already pushed/merged its StackItem onto
    // `undoStack` (Yjs does this in `afterTransaction`); the group boundary was
    // decided by `beginEntry`/`breakCoalescing` before the transaction ran.
    // Locate that item BEFORE advancing `currentState`, so a mid-commit throw
    // (the "impossible" no-item case) never leaves the wrapper half-updated.
    const top =
      this.undoManager.undoStack[this.undoManager.undoStack.length - 1];
    if (top === undefined) {
      // The action mutated tracked types (dirtyIds non-empty) yet produced no
      // undo StackItem — should be impossible. Surface loudly rather than
      // silently dropping the selection. `currentState` is NOT yet advanced.
      throw new Error(
        `History.commit: no undo StackItem to attach selection to ` +
          `(dirtyIds=${opResult.dirtyIds.size}). ` +
          `A tracked mutation should always produce a StackItem.`,
      );
    }
    // Weld the selection pair onto that item's `.meta`. It is now bound to
    // the live undo item and can never desync from the Yjs stack. (`undo` /
    // `redo` re-weld it onto the opposite stack's new item as the action
    // flips direction — Yjs does not copy `.meta` across undo↔redo.)
    //
    // #420: on a coalesced merge the top item is the SAME StackItem the previous
    // edit committed to (it already carries this group's SelectionEntry). Keep
    // the group's original `before` and advance only `after`. On a fresh group
    // write the full pair (the pre-#420 behavior). The `.meta.get` cast follows
    // the existing localized-Yjs-cast pattern used by `readSelectionEntry`
    // (Y.Map.meta is typed loosely by Yjs) — not new type-unsafety.
    if (this.didCoalesce) {
      const existing = top.meta.get(SEL_KEY) as SelectionEntry | undefined;
      top.meta.set(SEL_KEY, {
        before: existing !== undefined ? existing.before : selections.before,
        after: selections.after,
      });
    } else {
      top.meta.set(SEL_KEY, selections);
    }
    // All bookkeeping succeeded — now advance the wrapper's current state.
    this.currentState = opResult.state;
    // #234: cap undo depth. Y.UndoManager has no maxDepth, so once the stack
    // exceeds the cap drop the OLDEST entries from the undoStack. Each trimmed
    // StackItem carries its own `.meta` (and thus its SelectionEntry) away
    // automatically — there is no parallel array to keep in lockstep. The
    // trimmed-away history simply becomes non-undoable; this bounds
    // long-session memory (each StackItem retains DeleteSets).
    const excess = this.undoManager.undoStack.length - this.maxDepth;
    if (excess > 0) {
      this.undoManager.undoStack.splice(0, excess);
    }
  }

  /**
   * Advance `currentState` after a NON-undoable change (an accept/reject
   * suggestion-resolve txn that skipped `commit`). It sets `this.currentState =
   * newState` ONLY — it does NOT touch the undo/redo stacks, the coalescing
   * state, or the UndoManager.
   *
   * Without this, `currentState` stays pinned at the pre-resolve snapshot, and
   * the next `undo`/`redo` — which builds via `freshState(this.currentState,
   * dirtyIds)` — serves any block the resolve changed but the undo did NOT
   * re-dirty from a STALE snapshot (silently wrong render). It deliberately does
   * NOT call `commit` (a non-`null`-origin txn fires no UndoManager StackItem
   * event, so the stacks stay correct; `advanceState` only reconciles the cached
   * `currentState`).
   */
  advanceState(newState: State): void {
    this.currentState = newState;
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  /**
   * Dispose this History's `Y.UndoManager`, detaching the
   * `afterTransaction` / `afterAllTransactions` observers it registered on the
   * Doc. The owner (the editor/doc that created this History) MUST call this
   * when it is torn down.
   *
   * Today there is exactly one long-lived History per editor, so nothing leaks
   * in the current app. This exists for the collab / multi-view future, where
   * editors and docs are created and destroyed: a second `Y.UndoManager`
   * tracking the same scopes on an undisposed Doc would double-count changes
   * and silently corrupt undo grouping. Disposing is the cheap insurance.
   *
   * After `destroy()` the History must not be used again (undo/redo/commit are
   * undefined behaviour on a destroyed UndoManager).
   */
  destroy(): void {
    this.undoManager.destroy();
  }

  /**
   * Pop the latest undo entry: mutate Y.Doc back, mint a fresh State,
   * and return the pre-action selection so the caller can restore it.
   * Y.UndoManager creates a fresh StackItem on the redo stack; we re-weld
   * this action's `SelectionEntry` onto it (Yjs does not copy `.meta`) so a
   * subsequent `redo()` can read the `after` side. Returns null if nothing
   * to undo.
   *
   * **Error recovery (T33):** the whole body is wrapped in try/catch, and
   * `currentState` is reassigned only on full success (last statement before
   * the return). The retriability of the wrapper depends on WHERE the throw
   * lands relative to the Yjs reversal:
   *   - A throw BEFORE `undoManager.undo()` mutates the Yjs stacks (i.e. inside
   *     `captureDirtyIds` before the reversal applies) leaves BOTH the Y.Doc and
   *     `currentState` unchanged → a retry is fully sound.
   *   - A throw AFTER the reversal applied (only `freshState`, an allocation +
   *     freeze, runs after it) leaves the Y.Doc already reversed and the redo
   *     entry already re-welded, while `currentState` is stale → the wrapper is
   *     NOT safely retriable (a blind retry would double-undo). The catch
   *     surfaces this as "history may be inconsistent"; the caller must treat
   *     history as such rather than retrying blindly. `freshState` is
   *     allocation-only and realistically cannot throw, so this window is
   *     theoretical — but the guarantee is the weaker of the two, not "always
   *     retriable".
   * With the selection welded to the Yjs item there is no parallel-array
   * mutation to order or unwind. Caller sees a wrapped error identifying the
   * failure as history-internal.
   */
  undo(): UndoRedoResult | null {
    if (!this.canUndo()) return null;
    try {
      const doc = this.currentState[STATE_INTERNAL].doc;
      // Capture dirty ids from the UndoManager's internal transaction so the
      // editor's incremental render pipeline can rebuild only the reversed
      // blocks (S-A3). `undoManager.undo()` returns the popped StackItem; we
      // read its `.meta` AFTER the closure returns (orthogonal to the dirtyId
      // channel — no ordering hazard).
      let poppedItem: YStackItem | null = null;
      const dirtyIds = captureDirtyIds(doc, () => {
        poppedItem = this.undoManager.undo();
      });
      // canUndo() was true yet undo() returned no item — a LEGITIMATE outcome,
      // not a desync. A NON-undoable resolve (SUGGESTION_RESOLVE_ORIGIN) surgically
      // rewrites a block's inline content (`applyResolveDecisionsInTx`, #484 —
      // in-place attr swaps + delete-by-index of the dropped runs), which can turn a
      // preceding tracked StackItem that targeted the DELETED runs into a no-op.
      // Yjs's `popStackItem` pops such no-op items as it scans and returns null once
      // nothing reversible remains. Treat it as a graceful no-op (the dead items are
      // already off `undoStack`); the caller's `handleUndo` returns the editor
      // unchanged. `currentState` is intentionally NOT advanced — the Y.Doc was not
      // mutated, so the cached state stays valid. (#484's identity-preserving resolve
      // RESTORED undo-after-resolve for the in-place case; this null-pop path remains
      // only when the resolve deleted the very runs a prior StackItem tracked.)
      if (poppedItem === null) {
        // DEV trip-wire: the "Y.Doc not mutated" claim above is the load-bearing
        // reason `currentState` stays un-advanced. A no-op pop applies no
        // reversal, so `dirtyIds` MUST be empty. If a future Yjs changes
        // `popStackItem` to mutate while returning null, this surfaces it loudly
        // instead of silently desyncing the cached state.
        if (isDevMode() && dirtyIds.size > 0) {
          throw new Error(
            `History.undo: undo() returned null yet the Y.Doc was mutated ` +
              `(dirtyIds=${dirtyIds.size}) — a no-op pop must not mutate.`,
          );
        }
        return null;
      }
      const entry = readSelectionEntry(poppedItem);
      if (isDevMode() && entry === null) {
        throw new Error(
          `History.undo: popped StackItem carries no SelectionEntry in .meta. ` +
            `A tracked edit was committed without History.commit (or commit ` +
            `failed to attach the selection).`,
        );
      }
      // Carry the entry onto the freshly-created REDO StackItem so a
      // subsequent redo() can read `after`. Yjs does NOT copy `.meta` across
      // undo↔redo — it creates a brand-new StackItem on the opposite stack
      // (empirically verified; the popped item keeps its meta but the new
      // redo item starts empty). Re-welding here keeps the selection bound to
      // the live item, so there is still no parallel array and no desync.
      if (entry !== null) {
        this.carryEntryToTop(this.undoManager.redoStack, entry);
      }
      // Construct the new state BEFORE updating currentState. Passing dirtyIds
      // builds the new state's cache as an overlay on the prior cache —
      // unchanged blocks stay warm via fall-through (S-A2 + S-A3). NOTE: the
      // Yjs reversal above has ALREADY applied at this point, so a freshState
      // throw here leaves currentState stale relative to the Y.Doc — see the
      // method docstring; this is the non-retriable window (theoretical, since
      // freshState is allocation-only).
      const newState = freshState(this.currentState, dirtyIds);
      this.currentState = newState;
      return {
        state: newState,
        selection: entry === null ? null : entry.before,
        dirtyIds,
      };
    } catch (err) {
      // Any throw above leaves the Y.Doc possibly mutated (if undoManager.undo
      // ran) but `currentState` untouched. Surface a wrapped error.
      throw new Error(
        `History.undo: failed mid-operation, history may be inconsistent: ${err}`,
      );
    }
  }

  /**
   * Re-apply the most recently undone entry. Returns the post-action
   * selection so the caller can restore it. Y.UndoManager creates a fresh
   * StackItem on the undo stack; we re-weld this action's `SelectionEntry`
   * onto it (mirror of `undo()`) so the cycle can continue. Returns null if
   * nothing to redo.
   *
   * **Error recovery (T33):** mirrored from `undo()` — try/catch wraps the
   * whole body and `currentState` advances only on full success. Same
   * retriability split as `undo()`: a throw before the Yjs re-application is
   * fully retriable; a `freshState` throw after it leaves `currentState` stale
   * relative to the already-reapplied Y.Doc (non-retriable, theoretical). See
   * `undo()`'s docstring for the full rationale.
   */
  redo(): UndoRedoResult | null {
    if (!this.canRedo()) return null;
    try {
      const doc = this.currentState[STATE_INTERNAL].doc;
      let poppedItem: YStackItem | null = null;
      const dirtyIds = captureDirtyIds(doc, () => {
        poppedItem = this.undoManager.redo();
      });
      // canRedo() was true yet redo() returned no item — graceful no-op, mirror
      // of undo()'s handling. A non-undoable resolve (SUGGESTION_RESOLVE_ORIGIN)
      // that DELETED the very runs a redo StackItem tracked can leave that item a
      // no-op; Yjs's popStackItem pops it and returns null when nothing reapplies.
      // The Y.Doc was not mutated, so `currentState` stays valid. See undo() for
      // the full rationale.
      if (poppedItem === null) {
        // DEV trip-wire: mirror of undo() — a no-op pop must not mutate, so
        // `dirtyIds` must be empty (see undo() for the rationale).
        if (isDevMode() && dirtyIds.size > 0) {
          throw new Error(
            `History.redo: redo() returned null yet the Y.Doc was mutated ` +
              `(dirtyIds=${dirtyIds.size}) — a no-op pop must not mutate.`,
          );
        }
        return null;
      }
      const entry = readSelectionEntry(poppedItem);
      if (isDevMode() && entry === null) {
        throw new Error(
          `History.redo: popped StackItem carries no SelectionEntry in .meta. ` +
            `A tracked edit was committed without History.commit (or commit ` +
            `failed to attach the selection).`,
        );
      }
      // Carry the entry back onto the freshly-created UNDO StackItem so a
      // subsequent undo() can read `before` again (mirror of undo()'s carry;
      // see that method for why Yjs needs this re-weld).
      if (entry !== null) {
        this.carryEntryToTop(this.undoManager.undoStack, entry);
      }
      const newState = freshState(this.currentState, dirtyIds);
      this.currentState = newState;
      return {
        state: newState,
        selection: entry === null ? null : entry.after,
        dirtyIds,
      };
    } catch (err) {
      throw new Error(
        `History.redo: failed mid-operation, history may be inconsistent: ${err}`,
      );
    }
  }

  /**
   * Weld `entry` onto the `.meta` of the StackItem currently on top of
   * `stack` (the opposite stack's freshly-created item produced by the
   * just-completed undo/redo reversal).
   *
   * Called only from `undo` / `redo`, AFTER a successful reversal: Y.UndoManager
   * always pushes a fresh StackItem onto the opposite stack for the reversal, so
   * `stack` is non-empty by construction here. An empty stack would mean Yjs
   * stopped doing that — a behavioral regression. DEV: throw (caught + wrapped
   * by undo/redo's outer try/catch as a "history may be inconsistent" error)
   * to surface it on THIS reversal, rather than letting it resurface later as a
   * misleading "popped StackItem carries no SelectionEntry" error on the NEXT
   * undo/redo. PROD: skip silently — the selection round-trip degrades but the
   * editor does not crash.
   */
  private carryEntryToTop(
    stack: readonly YStackItem[],
    entry: SelectionEntry,
  ): void {
    const top = stack[stack.length - 1];
    if (top === undefined) {
      if (isDevMode()) {
        throw new Error(
          `History.carryEntryToTop: opposite stack is empty after a successful ` +
            `undo/redo — Y.UndoManager did not push the expected StackItem.`,
        );
      }
      return;
    }
    top.meta.set(SEL_KEY, entry);
  }
}

/**
 * Convenience factory for constructing a `History` instance. `maxDepth` caps
 * the undo-stack depth (default `DEFAULT_MAX_UNDO_DEPTH`); pass a smaller value
 * to bound memory more aggressively or for tests. `trackedOrigin` (default `null`,
 * the single-editor case) is the transaction origin this History's UndoManager
 * tracks — a collab host passes its peer origin so its undo stack holds only its
 * own edits (see the `History` constructor for the collab-isolation rationale).
 */
export function createHistory(
  state: State,
  maxDepth?: number,
  trackedOrigin: unknown = null,
): History {
  return new History(state, maxDepth ?? DEFAULT_MAX_UNDO_DEPTH, trackedOrigin);
}
