import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import type { ActionOf } from "../editor-action";
import { insertPageFieldAtCaret } from "./helpers/insert-page-field-at-caret";

/** `INSERT_PAGE_COUNT` — splice a page-count field at the caret. */
export function handleInsertPageCount(editor: EditorState, action: ActionOf<"INSERT_PAGE_COUNT">): Edit | null {
  return insertPageFieldAtCaret(editor, "page-count", action.numberStyle);
}
