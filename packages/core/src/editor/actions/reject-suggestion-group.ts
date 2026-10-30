import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import type { ActionOf } from "../editor-action";
import { resolveGroup } from "./helpers/resolve-group";

export function handleRejectSuggestionGroup(
  editor: EditorState,
  { groupId }: ActionOf<"REJECT_SUGGESTION_GROUP">,
): Edit | null {
  return resolveGroup(editor, groupId, "reject");
}
