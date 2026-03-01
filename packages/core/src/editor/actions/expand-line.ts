import type { EditorState, EditorConfig } from "../editor-state";
import { createSelection } from "../../cursor/selection";
import { createPosition } from "../../state/position";
import { moveToLine } from "../line-navigation";

export function handleExpandLine(
  editor: EditorState,
  direction: "up" | "down",
  config: EditorConfig,
): EditorState {
  const result = moveToLine(
    editor.state,
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
      createPosition(result.position.path, result.position.offset),
    ),
    targetX: result.targetX,
  };
}
