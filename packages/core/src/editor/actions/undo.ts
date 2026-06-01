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
