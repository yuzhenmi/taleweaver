import type { EditorState, EditorConfig, EditorHistory } from "../editor-state";
import { rebuildTrees } from "./helpers";

export function handleRedo(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const { redoStack } = editor.history;
  if (redoStack.length === 0) return editor;

  const entry = redoStack[redoStack.length - 1];
  const newHistory: EditorHistory = {
    undoStack: [...editor.history.undoStack, entry],
    redoStack: redoStack.slice(0, -1),
    lastEditTimestamp: 0,
    lastEditTag: "",
  };

  return rebuildTrees(
    {
      ...editor,
      state: entry.change.newState,
      selection: entry.selectionAfter,
      history: newHistory,
    },
    editor,
    config,
  );
}
