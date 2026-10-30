import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";

export function handleUndo(editor: EditorState): Edit | null {
  const result = editor.history.undo();
  // `undo()` returns null in TWO cases, both handled the same way (no-op): (a)
  // nothing to undo (`canUndo()` was false); (b) `canUndo()` was true but every
  // remaining StackItem was dead — its content was replaced by a non-undoable
  // same-block resolve (see history.ts undo() for the dead-StackItem rationale).
  if (result === null) return null;
  // On a non-null result, result.dirtyIds is non-empty: Y.UndoManager skips
  // no-op groups at commit time (see history.ts "Yjs no-op behavior" docstring),
  // so a recorded undo entry always corresponds to a real Y.Doc mutation, and a
  // dead-StackItem pop returns null (handled above) rather than an empty-dirty
  // result.
  return {
    change: { state: result.state, dirtyIds: result.dirtyIds },
    // An unresolvable stored selection (its block is gone, or its anchor character
    // was deleted and not restored) falls back to the selection this undo's own
    // change produces: the current selection rebased through it.
    selection: result.selection ?? "rebase",
    // No view hints: after an undo the restored selection may put the caret anywhere
    // (and on a different page count); a stale pre-undo `caretPageHint` would render
    // the caret on the wrong page's slot.
    view: {},
    // Undo is the history's own move, not a new entry.
    undoable: false,
  };
}
