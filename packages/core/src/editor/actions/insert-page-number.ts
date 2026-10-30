import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import type { ActionOf } from "../editor-action";
import { insertPageFieldAtCaret } from "./helpers/insert-page-field-at-caret";

/** `INSERT_PAGE_NUMBER` — splice a page-number field at the caret. */
export function handleInsertPageNumber(editor: EditorState, action: ActionOf<"INSERT_PAGE_NUMBER">): Edit | null {
  return insertPageFieldAtCaret(editor, "page-number", action.numberStyle);
}
