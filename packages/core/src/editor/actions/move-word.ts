import type { EditorState } from "../editor-state";
import { moveByWord } from "../../cursor/cursor-ops";

export function handleMoveWord(
  editor: EditorState,
  direction: "forward" | "backward",
): EditorState {
  const newSelection = moveByWord(
    editor.state,
    editor.selection.focus,
    direction,
  );
  return { ...editor, selection: newSelection };
}
