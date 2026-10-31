import type { EditorState } from "../../editor-state";
import type { Edit } from "../../edit";
import { acceptSuggestionGroup, rejectSuggestionGroup } from "../../../state";
import { resolveEdit } from "./resolve-edit";

/** Accept / reject every suggestion of group `groupId` atomically (one undo step). */
export function resolveGroup(
  editor: EditorState,
  groupId: string,
  mode: "accept" | "reject",
): Edit | null {
  const op = mode === "accept" ? acceptSuggestionGroup : rejectSuggestionGroup;
  return resolveEdit(op(editor.document, groupId));
}
