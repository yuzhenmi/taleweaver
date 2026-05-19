import type { Selection } from "../../state/block-position";
import type { EditorState } from "../editor-state";

export function handleSetSelection(
  editor: EditorState,
  selection: Selection,
): EditorState {
  return { ...editor, selection };
}
