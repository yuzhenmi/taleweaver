import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { createCursor, isCollapsed } from "../../cursor/selection";
import { createSpan, positionsEqual } from "../../state/position";
import { deleteRange } from "../../state/transformations";
import { moveByWord } from "../../cursor/cursor-ops";
import { rebuildTrees, deleteSelectionRange } from "./helpers";

export function handleDeleteWord(
  editor: EditorState,
  direction: "forward" | "backward",
  config: EditorConfig,
): EditorState {
  if (!isCollapsed(editor.selection)) {
    return deleteSelectionRange(editor, config);
  }

  const pos = editor.selection.focus;
  const target = moveByWord(editor.state, pos, direction);
  const targetPos = target.focus;

  // If we didn't move, nothing to delete
  if (positionsEqual(targetPos, pos)) {
    return editor;
  }

  const span =
    direction === "backward"
      ? createSpan(targetPos, pos)
      : createSpan(pos, targetPos);
  const change = deleteRange(editor.state, span);
  const newCursorPos =
    direction === "backward" ? targetPos : pos;
  const newSelection = createCursor(newCursorPos.path, newCursorPos.offset);

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
