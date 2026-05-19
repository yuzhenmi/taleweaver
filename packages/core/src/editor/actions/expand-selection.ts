import type { EditorState } from "../editor-state";
import { expandSelection } from "../../cursor/cursor-ops";

export function handleExpandSelection(
  editor: EditorState,
  direction: "forward" | "backward",
): EditorState {
  const newSelection = expandSelection(
    editor.state,
    editor.selection,
    direction,
  );
  return { ...editor, selection: newSelection };
}
