import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
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
import type { ActionOf } from "../editor-action";

/**
 * Suggestion RESOLVE actions. Each is ONE undoable history entry: the resolve op is an
 * ordinary tracked transaction; undo restores the records and the tagged runs exactly.
 * The selection is rebased through the change (a rejected insertion before the caret
 * moves it back, etc.).
 */
function resolveEdit(result: OperationResult): Edit {
  return { change: result, selection: "rebase" };
}

/**
 * Accept / reject ONE suggestion — which, for a suggestion that belongs to a group (a
 * host proposal), means its whole group: groups are reviewed as one unit.
 */
function resolveOne(editor: EditorState, id: SuggestionId, mode: "accept" | "reject"): Edit | null {
  const record = readSuggestionRecordFromState(editor.state, id);
  if (record === null) return null;
  return resolveGroup(editor, suggestionGroupOf(record), mode);
}

export function handleAcceptSuggestion(
  editor: EditorState,
  { id }: ActionOf<"ACCEPT_SUGGESTION">,
): Edit | null {
  return resolveOne(editor, id, "accept");
}

export function handleRejectSuggestion(
  editor: EditorState,
  { id }: ActionOf<"REJECT_SUGGESTION">,
): Edit | null {
  return resolveOne(editor, id, "reject");
}

/** Accept / reject every suggestion of group `groupId` atomically (one undo step). */
function resolveGroup(
  editor: EditorState,
  groupId: string,
  mode: "accept" | "reject",
): Edit | null {
  const op = mode === "accept" ? acceptSuggestionGroup : rejectSuggestionGroup;
  return resolveEdit(op(editor.state, groupId));
}

export function handleResolveSuggestionGroup(
  editor: EditorState,
  action: ActionOf<"ACCEPT_SUGGESTION_GROUP" | "REJECT_SUGGESTION_GROUP">,
): Edit | null {
  const mode = action.type === "ACCEPT_SUGGESTION_GROUP" ? "accept" : "reject";
  return resolveGroup(editor, action.groupId, mode);
}

export function handleAcceptAllSuggestions(editor: EditorState): Edit | null {
  return resolveEdit(acceptAll(editor.state));
}

export function handleRejectAllSuggestions(editor: EditorState): Edit | null {
  return resolveEdit(rejectAll(editor.state));
}
