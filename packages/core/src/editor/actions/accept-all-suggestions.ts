import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { acceptAll } from "../../state";
import { resolveEdit } from "./helpers/resolve-edit";

export function handleAcceptAllSuggestions(editor: EditorState): Edit | null {
  return resolveEdit(acceptAll(editor.state));
}
