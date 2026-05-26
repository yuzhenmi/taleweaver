import type { EditorState, EditorConfig } from "../editor-state";
import { createSpan } from "../../state";
import { moveToLine } from "../../cursor/line-navigation";

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
  if (result === null) return editor;
  return {
    ...editor,
    selection: createSpan(editor.selection.anchor, result.position),
    targetX: result.targetX,
  };
}
