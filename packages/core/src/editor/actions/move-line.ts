import type { EditorState, EditorConfig } from "../editor-state";
import {
  createCursor,
  isCollapsed,
  selectionStart,
  selectionEnd,
} from "../../cursor/selection";
import { moveToLine } from "../line-navigation";

export function handleMoveLine(
  editor: EditorState,
  direction: "up" | "down",
  config: EditorConfig,
): EditorState {
  // If selection is expanded, collapse to appropriate end then move to adjacent line
  const moveFocus = !isCollapsed(editor.selection)
    ? (direction === "up"
        ? selectionStart(editor.selection)
        : selectionEnd(editor.selection))
    : editor.selection.focus;

  const result = moveToLine(
    editor.state,
    moveFocus,
    editor.layoutTree,
    config.measurer,
    direction,
    editor.targetX,
  );
  if (!result) return editor;
  return {
    ...editor,
    selection: createCursor(result.position.path, result.position.offset),
    targetX: result.targetX,
  };
}
