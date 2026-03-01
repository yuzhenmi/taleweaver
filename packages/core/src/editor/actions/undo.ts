import type { EditorState, EditorConfig, EditorHistory } from "../editor-state";
import { rebuildTrees } from "./helpers";

export function handleUndo(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const { undoStack } = editor.history;
  if (undoStack.length === 0) return editor;

  const entry = undoStack[undoStack.length - 1];
  const newHistory: EditorHistory = {
    undoStack: undoStack.slice(0, -1),
    redoStack: [...editor.history.redoStack, entry],
    lastEditTimestamp: 0,
    lastEditTag: "",
  };

  return rebuildTrees(
    {
      ...editor,
      state: entry.change.oldState,
      selection: entry.selectionBefore,
      history: newHistory,
    },
    editor,
    config,
  );
}
