import type { Editor } from "../editor";
import type { Edit } from "../edit";
import { insertHeaderFooter } from "./helpers/insert-header-footer";

/** `INSERT_FOOTER` — insert (or enter) the active section's footer. */
export function handleInsertFooter(editor: Editor): Edit | null {
  return insertHeaderFooter(editor, "footer");
}
