import type { EditorState, EditorConfig } from "../editor-state";
import { rebuildTrees } from "./helpers";

export function handleRedo(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const result = editor.history.redo();
  // `redo()` returns null both when there is nothing to redo and when a redo
  // StackItem was left dead by a non-undoable same-block resolve (mirror of
  // handleUndo; see history.ts redo() for the dead-StackItem rationale).
  if (result === null) return editor;
  const selection = result.selection ?? editor.selection;
  // See handleUndo for why result.dirtyIds is non-empty on a non-null (real)
  // redo result.
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
