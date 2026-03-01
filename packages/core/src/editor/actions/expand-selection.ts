import type { EditorState } from "../editor-state";
import { expandSelectionByCharacter } from "../../cursor/cursor-ops";

export function handleExpandSelection(
  editor: EditorState,
  direction: "forward" | "backward",
): EditorState {
  const newSelection = expandSelectionByCharacter(
    editor.state,
    editor.selection,
    direction,
  );
  return { ...editor, selection: newSelection };
}
