import type { EditorState } from "../editor-state";
import type { EditorConfig } from "../editor-config";
import {
  acceptAll,
  rejectAll,
  acceptSuggestionGroup,
  rejectSuggestionGroup,
  readSuggestionRecordFromState,
  suggestionGroupOf,
  type SuggestionId,
  type OperationResult,
} from "../../state";
import { rebuildTrees } from "./helpers";
import { rebaseSelection } from "../foreign-change";

/**
 * Suggestion RESOLVE actions. Each is ONE undoable history entry: the resolve op is an
 * ordinary tracked transaction, committed here; undo restores the records and the
 * tagged runs exactly. The selection is rebased through the change (a rejected
 * insertion before the caret moves it back, etc.).
 */
function commitResolve(editor: EditorState, result: OperationResult, config: EditorConfig): EditorState {
  if (result.state === editor.state) return editor; // identity no-op (absent id / empty)
  const after = rebuildTrees({ ...editor, state: result.state }, editor, config, result.dirtyIds);
  const selection = rebaseSelection(editor, after);
  editor.history.commit(result, { before: editor.selection, after: selection });
  return { ...after, selection };
}

/**
 * Accept / reject ONE suggestion — which, for a suggestion that belongs to a group (a
 * host proposal), means its whole group: groups are reviewed as one unit.
 */
function resolveOne(editor: EditorState, id: SuggestionId, mode: "accept" | "reject", config: EditorConfig): EditorState {
  const record = readSuggestionRecordFromState(editor.state, id);
  if (record === null) return editor;
  return handleResolveSuggestionGroup(editor, suggestionGroupOf(record), mode, config);
}

export function handleAcceptSuggestion(editor: EditorState, id: SuggestionId, config: EditorConfig): EditorState {
  return resolveOne(editor, id, "accept", config);
}

export function handleRejectSuggestion(editor: EditorState, id: SuggestionId, config: EditorConfig): EditorState {
  return resolveOne(editor, id, "reject", config);
}

/** Accept / reject every suggestion of group `groupId` atomically (one undo step). */
export function handleResolveSuggestionGroup(
  editor: EditorState,
  groupId: string,
  mode: "accept" | "reject",
  config: EditorConfig,
): EditorState {
  const op = mode === "accept" ? acceptSuggestionGroup : rejectSuggestionGroup;
  return commitResolve(editor, op(editor.state, groupId), config);
}

export function handleAcceptAllSuggestions(editor: EditorState, config: EditorConfig): EditorState {
  return commitResolve(editor, acceptAll(editor.state), config);
}

export function handleRejectAllSuggestions(editor: EditorState, config: EditorConfig): EditorState {
  return commitResolve(editor, rejectAll(editor.state), config);
}
