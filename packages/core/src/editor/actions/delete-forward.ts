import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { createCursor, isCollapsed } from "../../cursor/selection";
import { createSpan } from "../../state/position";
import { deleteRange } from "../../state/transformations";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { rebuildTrees, deleteSelectionRange } from "./helpers";

export function handleDeleteForward(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  // If selection is expanded, delete the range
  if (!isCollapsed(editor.selection)) {
    return deleteSelectionRange(editor, config);
  }

  const pos = editor.selection.focus;

  // Use moveByCharacter to find the next position (handles all nesting)
  const nextSel = moveByCharacter(editor.state, pos, "forward");
  const nextPos = nextSel.focus;

  // If we didn't move (at end of document), nothing to delete
  if (
    nextPos.path.length === pos.path.length &&
    nextPos.path.every((v, i) => v === pos.path[i]) &&
    nextPos.offset === pos.offset
  ) {
    return editor;
  }

  const deleteSpan = createSpan(pos, nextPos);
  const change = deleteRange(editor.state, deleteSpan);
  const newSelection = createCursor(pos.path, pos.offset);

  return rebuildTrees(
    {
      ...editor,
      state: change.newState,
      selection: newSelection,
      history: pushEditorChange(editor.history, {
        change,
        selectionBefore: editor.selection,
        selectionAfter: newSelection,
      }, "delete"),
    },
    editor,
    config,
  );
}
