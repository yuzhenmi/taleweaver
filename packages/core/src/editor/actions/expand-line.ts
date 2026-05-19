import type { EditorState, EditorConfig } from "../editor-state";
import { createSelection } from "../../cursor/selection";
import { moveToLine } from "../line-navigation-legacy";

export function handleExpandLine(
  editor: EditorState,
  direction: "up" | "down",
  config: EditorConfig,
): EditorState {
  const result = moveToLine(
    editor.stateLegacy,
    editor.selection.focus,
    editor.layoutTree,
    config.measurer,
    direction,
    editor.targetX,
  );
  if (!result) return editor;
  return {
    ...editor,
    selection: createSelection(
      editor.selection.anchor,
      result.position,
    ),
    targetX: result.targetX,
  };
}
