import type { Editor } from "../editor";
import type { Edit } from "../edit";
import type { ActionOf } from "../editor-action";
import { resolveGroup } from "./helpers/resolve-group";

export function handleAcceptSuggestionGroup(
  editor: Editor,
  { groupId }: ActionOf<"ACCEPT_SUGGESTION_GROUP">,
): Edit | null {
  return resolveGroup(editor, groupId, "accept");
}
