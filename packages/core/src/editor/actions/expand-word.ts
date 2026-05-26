import type { EditorState } from "../editor-state";
import { createSpan } from "../../state";
import { moveByWord } from "../../cursor/cursor-ops";

export function handleExpandWord(
  editor: EditorState,
  direction: "forward" | "backward",
): EditorState {
  const newFocus = moveByWord(
    editor.state,
    editor.selection.focus,
    direction,
  );
  return {
    ...editor,
    selection: createSpan(editor.selection.anchor, newFocus),
  };
}
