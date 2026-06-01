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
  // #323: clear the non-undoable `caretPageHint` (see handleUndo for the
  // rationale — the post-restore page is ambiguous, and the `{ ...editor }`
  // spread would otherwise inherit a stale hint).
  return rebuildTrees(
    { ...editor, state: result.state, selection, caretPageHint: undefined },
    editor,
    config,
    result.dirtyIds,
  );
}
