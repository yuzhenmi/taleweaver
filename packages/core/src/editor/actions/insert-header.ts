import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { insertHeaderFooter } from "./helpers/insert-header-footer";

/** `INSERT_HEADER` — insert (or enter) the active section's header. */
export function handleInsertHeader(editor: EditorState): Edit | null {
  return insertHeaderFooter(editor, "header");
}
