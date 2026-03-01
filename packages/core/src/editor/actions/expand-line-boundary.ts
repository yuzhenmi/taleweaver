import type { EditorState, EditorConfig } from "../editor-state";
import { createSelection } from "../../cursor/selection";
import { createPosition } from "../../state/position";
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
      createPosition(pos.path, pos.offset),
    ),
  };
}
