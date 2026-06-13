import type { EditorState, EditorConfig } from "../editor-state";
import { rebuildTrees } from "./helpers";

export function handleUndo(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const result = editor.history.undo();
  // `undo()` returns null in TWO cases, both handled the same way (no-op): (a)
  // nothing to undo (`canUndo()` was false); (b) `canUndo()` was true but every
  // remaining StackItem was dead — its content was replaced by a non-undoable
  // same-block resolve (see history.ts undo() for the dead-StackItem rationale).
  if (result === null) return editor;
  const selection = result.selection ?? editor.selection;
  // On a non-null result, result.dirtyIds is non-empty: Y.UndoManager skips
  // no-op groups at commit time (see history.ts "Yjs no-op behavior" docstring),
  // so a recorded undo entry always corresponds to a real Y.Doc mutation, and a
  // dead-StackItem pop returns null (handled above) rather than an empty-dirty
  // result. The incremental rebuilder is safe even on an empty set, but the
  // assumption is documented here so a future reader doesn't add a defensive
  // fall-back that would silently lose the optimization.
  // #323: clear the non-undoable `caretPageHint`. After an undo the restored
  // selection may put the caret anywhere (and on a different page count); a
  // stale pre-undo slot hint would render the caret on the wrong page's slot.
  // The body `{ ...editor }` spread would otherwise INHERIT it, so clear it
  // explicitly. `rebuildTrees` spreads `...newEditor` and never reintroduces it.
  return rebuildTrees(
    { ...editor, state: result.state, selection, caretPageHint: undefined },
    editor,
    config,
    result.dirtyIds,
  );
}
