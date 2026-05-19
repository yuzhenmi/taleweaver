import type { EditorState, EditorConfig } from "../editor-state";
import type { Selection } from "../../state/block-position";
import { rebuildTrees } from "./helpers";

export function handleUndo(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const result = editor.history.undo();
  if (result === null) return editor;
  const selection = (result.selection as Selection | null) ?? editor.selection;
  return rebuildTrees(
    { ...editor, state: result.state, selection },
    editor,
    config,
  );
}
