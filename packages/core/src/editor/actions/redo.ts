import type { EditorState } from "../editor-state";
import type { EditorConfig } from "../editor-config";
import { rebuildTrees } from "./helpers";
import { recordChange } from "../document-change";
import { rebaseSelection } from "../foreign-change";

export function handleRedo(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const result = editor.history.redo();
  // `redo()` returns null both when there is nothing to redo and when a redo
  // StackItem was left dead by a non-undoable same-block resolve (mirror of
  // handleUndo; see history.ts redo() for the dead-StackItem rationale).
  if (result === null) return editor;
  // An unresolvable stored selection (its block is gone, or its anchor character
  // was deleted and not restored) falls back to the selection this redo's own
  // change produces: the current selection rebased through it.
  const lastChange = recordChange(editor.lastChange, editor.state, result.dirtyIds);
  const selection = result.selection ?? rebaseSelection(editor, { ...editor, state: result.state, lastChange });
  // See handleUndo for why result.dirtyIds is non-empty on a non-null (real)
  // redo result.
  // Clear the non-undoable `caretPageHint` (see handleUndo for the
  // rationale — the post-restore page is ambiguous, and the `{ ...editor }`
  // spread would otherwise inherit a stale hint).
  return rebuildTrees(
    { ...editor, state: result.state, selection, caretPageHint: undefined },
    editor,
    config,
    result.dirtyIds,
  );
}
