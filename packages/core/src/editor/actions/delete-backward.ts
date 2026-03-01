import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { createCursor, isCollapsed } from "../../cursor/selection";
import { createPosition, createSpan } from "../../state/position";
import { deleteRange } from "../../state/transformations";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { getNodeByPath } from "../../state/operations";
import { getTextContentLength } from "../../state/text-utils";
import { rebuildTrees, deleteSelectionRange } from "./helpers";

export function handleDeleteBackward(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  // If selection is expanded, delete the range
  if (!isCollapsed(editor.selection)) {
    return deleteSelectionRange(editor, config);
  }

  const pos = editor.selection.focus;

  // At very start of document — nothing to delete
  if (pos.path.every((v) => v === 0) && pos.offset === 0) {
    return editor;
  }

  if (pos.offset > 0) {
    // Delete within the same text node
    const prevSel = moveByCharacter(editor.state, pos, "backward");
    const deleteSpan = createSpan(prevSel.focus, pos);
    const change = deleteRange(editor.state, deleteSpan);
    const newSelection = createCursor(prevSel.focus.path, prevSel.focus.offset);

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

  // At start of a text node with offset 0 — merge with previous block
  // Use moveByCharacter to find previous position, which handles all nesting
  const prevSel = moveByCharacter(editor.state, pos, "backward");
  const prevPos = prevSel.focus;

  // If we didn't move (already at document start), nothing to delete
  if (
    prevPos.path.length === pos.path.length &&
    prevPos.path.every((v, i) => v === pos.path[i]) &&
    prevPos.offset === pos.offset
  ) {
    return editor;
  }

  // Find the end of the previous text node (one char forward from where moveByCharacter landed)
  const prevTextNode = getNodeByPath(editor.state, prevPos.path);
  if (!prevTextNode) return editor;
  const prevTextEnd = createPosition(prevPos.path, getTextContentLength(prevTextNode));

  const deleteSpan = createSpan(prevTextEnd, pos);
  const change = deleteRange(editor.state, deleteSpan);
  const newSelection = createCursor(prevTextEnd.path, prevTextEnd.offset);

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
