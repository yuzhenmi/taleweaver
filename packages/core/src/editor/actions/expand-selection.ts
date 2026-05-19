import type { EditorState } from "../editor-state";
import { expandSelectionByCharacter } from "../../cursor/cursor-ops-legacy";

export function handleExpandSelection(
  editor: EditorState,
  direction: "forward" | "backward",
): EditorState {
  const newSelection = expandSelectionByCharacter(
    editor.stateLegacy,
    editor.selection,
    direction,
  );
  return { ...editor, selection: newSelection };
}
