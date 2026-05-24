import type { EditorState, EditorConfig } from "../editor-state";
import { rebuildTrees } from "./helpers";

export function handleRedo(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const result = editor.history.redo();
  if (result === null) return editor;
  const selection = result.selection ?? editor.selection;
  // See handleUndo for why result.dirtyIds is always non-empty on a
  // successful redo.
  return rebuildTrees(
    { ...editor, state: result.state, selection },
    editor,
    config,
    result.dirtyIds,
  );
}
