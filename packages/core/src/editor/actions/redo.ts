import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";

export function handleRedo(editor: EditorState): Edit | null {
  const result = editor.history.redo();
  // `redo()` returns null both when there is nothing to redo and when a redo
  // StackItem was left dead by a non-undoable same-block resolve (mirror of
  // handleUndo; see history.ts redo() for the dead-StackItem rationale).
  if (result === null) return null;
  // As for undo: an unresolvable stored selection falls back to the current one rebased
  // through the redo's change; the post-restore page is ambiguous, so no view hints.
  return {
    change: { document: result.document, dirtyIds: result.dirtyIds },
    selection: result.selection ?? "rebase",
    view: {},
    undoable: false,
  };
}
