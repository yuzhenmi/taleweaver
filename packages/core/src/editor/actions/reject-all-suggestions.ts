import type { Editor } from "../editor";
import type { Edit } from "../edit";
import { rejectAll } from "../../state";
import { resolveEdit } from "./helpers/resolve-edit";

export function handleRejectAllSuggestions(editor: Editor): Edit | null {
  return resolveEdit(rejectAll(editor.document));
}
