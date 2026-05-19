import type { EditorState } from "../editor-state";
import { createSpan } from "../../state/block-position";
import { moveByWord } from "../../cursor/cursor-ops";

export function handleMoveWord(
  editor: EditorState,
  direction: "forward" | "backward",
): EditorState {
  const newFocus = moveByWord(editor.state, editor.selection.focus, direction);
  return { ...editor, selection: createSpan(newFocus, newFocus) };
}
