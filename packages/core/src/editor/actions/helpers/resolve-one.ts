import type { EditorState } from "../../editor-state";
import type { Edit } from "../../edit";
import { readSuggestionRecordFromState, suggestionGroupOf, type SuggestionId } from "../../../state";
import { resolveGroup } from "./resolve-group";

/**
 * Accept / reject ONE suggestion — which, for a suggestion that belongs to a group (a
 * host proposal), means its whole group: groups are reviewed as one unit.
 */
export function resolveOne(editor: EditorState, id: SuggestionId, mode: "accept" | "reject"): Edit | null {
  const record = readSuggestionRecordFromState(editor.document, id);
  if (record === null) return null;
  return resolveGroup(editor, suggestionGroupOf(record), mode);
}
