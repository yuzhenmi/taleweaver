import type { Selection } from "../../cursor/selection";
import type { EditorState } from "../editor-state";

export function handleSetSelection(
  editor: EditorState,
  selection: Selection,
): EditorState {
  return { ...editor, selection };
}
