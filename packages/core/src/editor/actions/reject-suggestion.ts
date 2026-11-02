import type { Editor } from "../editor";
import type { Edit } from "../edit";
import type { ActionOf } from "../editor-action";
import { resolveOne } from "./helpers/resolve-one";

export function handleRejectSuggestion(
  editor: Editor,
  { id }: ActionOf<"REJECT_SUGGESTION">,
): Edit | null {
  return resolveOne(editor, id, "reject");
}
