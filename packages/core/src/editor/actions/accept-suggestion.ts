import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import type { ActionOf } from "../editor-action";
import { resolveOne } from "./helpers/resolve-one";

export function handleAcceptSuggestion(
  editor: EditorState,
  { id }: ActionOf<"ACCEPT_SUGGESTION">,
): Edit | null {
  return resolveOne(editor, id, "accept");
}
