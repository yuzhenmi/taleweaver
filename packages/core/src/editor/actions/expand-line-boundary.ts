import type { EditorState, EditorConfig } from "../editor-state";
import { createSelection } from "../../cursor/selection";
import { moveToLineBoundary } from "../line-navigation";

export function handleExpandLineBoundary(
  editor: EditorState,
  boundary: "start" | "end",
  config: EditorConfig,
): EditorState {
  const pos = moveToLineBoundary(
    editor.state,
    editor.selection.focus,
    editor.layoutTree,
    config.measurer,
    boundary,
  );
  if (!pos) return editor;
  return {
    ...editor,
    selection: createSelection(
      editor.selection.anchor,
      pos,
    ),
  };
}
