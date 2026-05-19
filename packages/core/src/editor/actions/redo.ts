import type { EditorState, EditorConfig } from "../editor-state";
import type { Selection } from "../../state/block-position";
import { rebuildTrees } from "./helpers";

export function handleRedo(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const result = editor.history.redo();
  if (result === null) return editor;
  const selection = (result.selection as Selection | null) ?? editor.selection;
  return rebuildTrees(
    { ...editor, state: result.state, selection },
    editor,
    config,
  );
}
