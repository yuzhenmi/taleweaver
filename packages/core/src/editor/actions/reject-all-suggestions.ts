import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { rejectAll } from "../../state";
import { resolveEdit } from "./helpers/resolve-edit";

export function handleRejectAllSuggestions(editor: EditorState): Edit | null {
  return resolveEdit(rejectAll(editor.document));
}
