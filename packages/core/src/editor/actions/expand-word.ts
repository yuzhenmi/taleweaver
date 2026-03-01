import type { EditorState } from "../editor-state";
import { createSelection } from "../../cursor/selection";
import { moveByWord } from "../../cursor/cursor-ops";

export function handleExpandWord(
  editor: EditorState,
  direction: "forward" | "backward",
): EditorState {
  const moved = moveByWord(editor.state, editor.selection.focus, direction);
  return {
    ...editor,
    selection: createSelection(editor.selection.anchor, moved.focus),
  };
}
