import type { EditorState } from "../editor-state";
import { moveByWord } from "../../cursor/cursor-ops-legacy";

export function handleMoveWord(
  editor: EditorState,
  direction: "forward" | "backward",
): EditorState {
  const newSelection = moveByWord(
    editor.stateLegacy,
    editor.selection.focus,
    direction,
  );
  return { ...editor, selection: newSelection };
}
