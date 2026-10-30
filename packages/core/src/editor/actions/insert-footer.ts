import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { insertHeaderFooter } from "./helpers/insert-header-footer";

/** `INSERT_FOOTER` — insert (or enter) the active section's footer. */
export function handleInsertFooter(editor: EditorState): Edit | null {
  return insertHeaderFooter(editor, "footer");
}
