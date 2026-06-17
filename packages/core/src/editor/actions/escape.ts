import type { EditorState, EditorConfig } from "../editor-state";
import { isObjectSelection } from "../../cursor/object-selection";
import { moveOffObject } from "./object-edits";

/**
 * ESCAPE on an object selection (#525): collapse the caret to just AFTER the
 * atomic-leaf object (Google Docs), leaving the object intact. A no-op for any
 * other selection — Escape has no editor-level meaning for a text caret (the
 * DOM/React UI layer handles Escape for overlays such as the find bar; this
 * core action only deselects an object).
 */
export function handleEscape(editor: EditorState, config: EditorConfig): EditorState {
  const objId = isObjectSelection(editor.state, editor.selection, config.componentRegistry);
  if (objId !== null) return moveOffObject(editor, objId, "forward");
  return editor;
}
