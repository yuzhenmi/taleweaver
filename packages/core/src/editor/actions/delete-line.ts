import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { createCursor, isCollapsed } from "../../cursor/selection";
import { createSpan, positionsEqual } from "../../state/position";
import { deleteRange } from "../../state/transformations";
import { moveToLineBoundary } from "../line-navigation";
import { rebuildTrees, deleteSelectionRange } from "./helpers";

export function handleDeleteLine(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  if (!isCollapsed(editor.selection)) {
    return deleteSelectionRange(editor, config);
  }

  const pos = editor.selection.focus;
  const lineStart = moveToLineBoundary(
    editor.state,
    pos,
    editor.layoutTree,
    config.measurer,
    "start",
  );
  if (!lineStart) return editor;

  // If already at line start, nothing to delete
  if (positionsEqual(lineStart, pos)) {
    return editor;
  }

  const span = createSpan(lineStart, pos);
  const change = deleteRange(editor.state, span);
  const newSelection = createCursor(lineStart.path, lineStart.offset);

  return rebuildTrees(
    {
      ...editor,
      state: change.newState,
      selection: newSelection,
      history: pushEditorChange(editor.history, {
        change,
        selectionBefore: editor.selection,
        selectionAfter: newSelection,
      }),
    },
    editor,
    config,
  );
}
