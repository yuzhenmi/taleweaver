import type { Editor } from "../editor";
import type { Edit } from "../edit";
import { acceptAll } from "../../state";
import { resolveEdit } from "./helpers/resolve-edit";

export function handleAcceptAllSuggestions(editor: Editor): Edit | null {
  return resolveEdit(acceptAll(editor.document));
}
