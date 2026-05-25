import type { EditorState, EditorConfig } from "../editor-state";
import { createSpan } from "../../state/block-position";
import { moveToLineBoundary } from "../../cursor/line-navigation";

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
  if (pos === null) return editor;
  return {
    ...editor,
    selection: createSpan(editor.selection.anchor, pos),
  };
}
