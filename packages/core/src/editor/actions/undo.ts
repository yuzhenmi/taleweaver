import type { EditorState, EditorConfig } from "../editor-state";
import { rebuildTrees } from "./helpers";

export function handleUndo(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const result = editor.history.undo();
  if (result === null) return editor;
  const selection = result.selection ?? editor.selection;
  // result.dirtyIds is non-empty whenever undo succeeded: Y.UndoManager
  // skips no-op groups at commit time (see history.ts "Yjs no-op
  // behavior" docstring), so a recorded undo entry always corresponds
  // to a real Y.Doc mutation. The incremental rebuilder is safe even
  // on an empty set, but the assumption is documented here so a future
  // reader doesn't add a defensive fall-back that would silently lose
  // the optimization.
  return rebuildTrees(
    { ...editor, state: result.state, selection },
    editor,
    config,
    result.dirtyIds,
  );
}
