import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { createCursor, isCollapsed } from "../../cursor/selection";
import { createSpan, positionsEqual } from "../../state/position";
import { deleteRange } from "../../state/transformations-legacy";
import { moveToLineBoundary } from "../line-navigation-legacy";
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
    editor.stateLegacy,
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
  const change = deleteRange(editor.stateLegacy, span);
  const newSelection = createCursor(lineStart.path, lineStart.offset);

  return rebuildTrees(
    {
      ...editor,
      stateLegacy: change.newState,
      selection: newSelection,
      historyLegacy: pushEditorChange(editor.historyLegacy, {
        change,
        selectionBefore: editor.selection,
        selectionAfter: newSelection,
      }),
    },
    editor,
    config,
  );
}
