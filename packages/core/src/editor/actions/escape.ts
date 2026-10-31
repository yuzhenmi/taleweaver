import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { isObjectSelection } from "../../cursor/object-selection";
import { moveOffObject } from "./helpers/move-off-object";

/**
 * ESCAPE on an object selection: collapse the caret to just AFTER the
 * atomic-leaf object (Google Docs), leaving the object intact. A no-op for any
 * other selection — Escape has no editor-level meaning for a text caret (the
 * DOM/React UI layer handles Escape for overlays such as the find bar; this
 * core action only deselects an object).
 */
export function handleEscape(editor: EditorState): Edit | null {
  const { config } = editor;
  const objId = isObjectSelection(editor.document, editor.selection, config.componentRegistry);
  if (objId !== null) return moveOffObject(editor, objId, "forward");
  return null;
}
