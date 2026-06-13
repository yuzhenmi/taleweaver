/**
 * Change-tracking slice 4a: the FOUR resolve editor-action handlers
 * (ACCEPT_SUGGESTION / REJECT_SUGGESTION / ACCEPT_ALL_SUGGESTIONS /
 * REJECT_ALL_SUGGESTIONS).
 *
 * Unlike the comment handlers (which `history.commit` — comment side-table flips
 * are UNDOABLE), suggestion RESOLUTION is NON-undoable: the state op already ran
 * a `SUGGESTION_RESOLVE_ORIGIN` transaction, which fires no `Y.UndoManager`
 * StackItem (accept/reject is final — Ctrl+Z cannot revert it, the Google Docs
 * convention). The reducer PREAMBLE (the `"resolve"` coalesce class) already
 * broke the open undo group so any preceding typing committed as its own unit;
 * the handler therefore does NOT `history.commit` — it `history.advanceState`s to
 * reconcile the History's cached `currentState` (which the skipped commit would
 * otherwise have set), then rebuilds.
 */
import type { EditorState, EditorConfig } from "../editor-state";
import {
  acceptSuggestion,
  rejectSuggestion,
  acceptAll,
  rejectAll,
  type SuggestionId,
  type OperationResult,
} from "../../state";
import { rebuildTrees } from "./helpers";

/**
 * Shared NON-undoable resolve commit. The op already ran a
 * `SUGGESTION_RESOLVE_ORIGIN` (non-undoable) transaction, so we do NOT
 * `history.commit` — we `advanceState` (reconcile the cached `currentState` the
 * skipped commit would have set, so the next undo/redo builds from the current
 * snapshot, not a stale one) then `rebuildTrees`. The reducer preamble already
 * broke the open undo group (`"resolve"` class). The selection is passed through
 * UNCHANGED (sidebar-click invocation; caret-clamp on a resolve that removes the
 * caret's text is a named follow-up, mirroring `handleDeleteComment`). Identity
 * no-op short-circuit (same `state` ref → return the editor) per the T7 contract.
 */
function commitResolve(
  editor: EditorState,
  result: OperationResult,
  config: EditorConfig,
): EditorState {
  if (result.state === editor.state) return editor; // identity no-op (absent id / empty)
  editor.history.advanceState(result.state);
  return rebuildTrees(
    { ...editor, state: result.state },
    editor,
    config,
    result.dirtyIds,
  );
}

/**
 * `ACCEPT_SUGGESTION` handler — accepts ONE suggestion by id (the proposal lands:
 * an insertion becomes permanent, a deletion is removed for real, a formatting
 * proposal is applied live). NON-undoable; identity no-op when the id is absent.
 */
export function handleAcceptSuggestion(
  editor: EditorState,
  id: SuggestionId,
  config: EditorConfig,
): EditorState {
  return commitResolve(editor, acceptSuggestion(editor.state, id, config.attrRegistry), config);
}

/**
 * `REJECT_SUGGESTION` handler — rejects ONE suggestion by id (the inverse of
 * accept: an insertion is dropped, a deletion's text is kept, a formatting
 * proposal is discarded). NON-undoable; identity no-op when the id is absent.
 */
export function handleRejectSuggestion(
  editor: EditorState,
  id: SuggestionId,
  config: EditorConfig,
): EditorState {
  return commitResolve(editor, rejectSuggestion(editor.state, id, config.attrRegistry), config);
}

/**
 * `ACCEPT_ALL_SUGGESTIONS` handler — accepts EVERY suggestion in the document in
 * one non-undoable transaction (the "Accept all" command). Identity no-op when
 * the document has no suggestions.
 */
export function handleAcceptAllSuggestions(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  return commitResolve(editor, acceptAll(editor.state, config.attrRegistry), config);
}

/**
 * `REJECT_ALL_SUGGESTIONS` handler — rejects EVERY suggestion in the document in
 * one non-undoable transaction (the "Reject all" command). Identity no-op when
 * the document has no suggestions.
 */
export function handleRejectAllSuggestions(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  return commitResolve(editor, rejectAll(editor.state, config.attrRegistry), config);
}
