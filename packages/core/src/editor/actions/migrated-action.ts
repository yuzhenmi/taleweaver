/**
 * @deprecated Remove at P11.4 cutover (alongside the legacy stateLegacy +
 * historyLegacy fields and the paired `handle*Legacy` exports introduced
 * in P11.1 T2-T8).
 *
 * Decision-D parallel-window wrapper for migrated inline-text action
 * handlers. Centralizes the bookkeeping that surrounds every migrated
 * Layer 3 op so individual handlers (T2-T8) stay small and only express
 * the action-specific logic.
 *
 * For each migrated handler invocation the wrapper:
 *   1. Converts the editor's legacy Selection to a new Span via
 *      `legacySelectionToNew(state, selection)`.
 *   2. Invokes the caller's `fn(state, newSelection)`, which runs a new
 *      Layer 3 op on `state` and returns the post-op `state`, the new
 *      `selection` (NewSpan), and an optional history `mergeTag`.
 *   3. Downgrades the post-op `state` to a fresh `stateLegacy` via
 *      `downgradeToStateNode(state)`. The legacy renderer continues to
 *      consume `stateLegacy` until P11.4 cutover.
 *   4. Re-projects the post-op NewSpan back to a legacy Selection via
 *      `newSelectionToLegacy(stateLegacy, span)` — ONE call. The helper
 *      already returns a `Selection` with both anchor + focus walked.
 *   5. Constructs a legacy `Change` from the pre/post `stateLegacy`
 *      snapshots and pushes it onto `historyLegacy` via
 *      `pushEditorChange` (with the optional mergeTag for keystroke
 *      grouping).
 *   6. Returns a new `EditorState` rebuilt through `rebuildTrees` so the
 *      render/cascade/layout caches stay in sync.
 *
 * At P11.4 the History wrapper switches to Y.UndoManager directly,
 * `stateLegacy` + `historyLegacy` are deleted from EditorState, and this
 * wrapper goes away — migrated handlers become plain Layer-3-op callers.
 */
import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import type { State } from "../../state/state";
import type { Span as NewSpan } from "../../state/block-position";
import {
  legacySelectionToNew,
  newSelectionToLegacy,
} from "../legacy-position-bridge";
import { downgradeToStateNode } from "../rebuild-state-from-legacy";
import { rebuildTrees } from "./helpers";

/**
 * Result of a migrated handler's Layer-3-op callback. The wrapper uses
 * `state` + `selection` to produce the post-action EditorState, and
 * `mergeTag` (when provided) to group consecutive entries in
 * `historyLegacy` so e.g. rapid typing collapses into one undo entry.
 */
export interface MigratedActionResult {
  /** The new State after the Layer 3 op. */
  readonly state: State;
  /** The new Selection (Span over new Positions) after the action. */
  readonly selection: NewSpan;
  /**
   * Optional history merge tag (e.g. `"insert"`, `"delete"`). Consecutive
   * pushes with the same non-empty tag within `MERGE_THRESHOLD_MS` merge
   * into a single undo entry. Undefined / empty disables merging.
   */
  readonly mergeTag?: string;
}

/**
 * Run a migrated handler's Layer-3-op callback under the Decision-D
 * parallel-window contract.
 *
 * @param editor  The current EditorState (legacy fields canonical).
 * @param config  EditorConfig used to rebuild render/cascade/layout.
 * @param fn      Handler callback. Receives the current new `State` and
 *                a NewSpan converted from `editor.selection`. Must return
 *                the post-op State, the post-op NewSpan, and an optional
 *                history mergeTag.
 * @returns The post-action EditorState with all fields updated and the
 *          render/cascade/layout caches rebuilt.
 */
export function migratedAction(
  editor: EditorState,
  config: EditorConfig,
  fn: (state: State, selection: NewSpan) => MigratedActionResult,
): EditorState {
  // 1. legacy Selection → new Span (against the current new State).
  const newSelection = legacySelectionToNew(editor.state, editor.selection);

  // 2. Invoke the handler callback.
  const result = fn(editor.state, newSelection);

  // 3. Downgrade post-op State to a fresh stateLegacy.
  const newStateLegacy = downgradeToStateNode(result.state);

  // 4. Re-project post-op NewSpan back to a legacy Selection (single call;
  //    newSelectionToLegacy walks anchor + focus internally).
  const newLegacySelection = newSelectionToLegacy(
    newStateLegacy,
    result.selection,
  );

  // 5. Build the legacy Change from pre/post stateLegacy and push onto
  //    historyLegacy. Per Decision D the wrapper is the sole owner of
  //    history-push for migrated handlers during the parallel window.
  const change = {
    oldState: editor.stateLegacy,
    newState: newStateLegacy,
    timestamp: Date.now(),
  };
  const newHistoryLegacy = pushEditorChange(
    editor.historyLegacy,
    {
      change,
      selectionBefore: editor.selection,
      selectionAfter: newLegacySelection,
    },
    result.mergeTag ?? "",
  );

  // 6. Rebuild render/cascade/layout caches against the post-op
  //    stateLegacy and return the new EditorState.
  return rebuildTrees(
    {
      ...editor,
      state: result.state,
      stateLegacy: newStateLegacy,
      selection: newLegacySelection,
      historyLegacy: newHistoryLegacy,
    },
    editor,
    config,
  );
}
