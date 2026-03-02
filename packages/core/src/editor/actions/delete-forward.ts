import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { createCursor, isCollapsed } from "../../cursor/selection";
import { createSpan, positionsEqual } from "../../state/position";
import { deleteRange } from "../../state/transformations";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { getNodeByPath } from "../../state/operations";
import { getTextContentLength } from "../../state/text-utils";
import { createNode } from "../../state/create-node";
import { rebuildTrees, deleteSelectionRange, findLastTextDescendant, isAtCellBoundary } from "./helpers";

export function handleDeleteForward(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  // If selection is expanded, delete the range
  if (!isCollapsed(editor.selection)) {
    return deleteSelectionRange(editor, config);
  }

  const pos = editor.selection.focus;

  // At end of a table cell — prevent cross-cell merge
  if (isAtCellBoundary(editor.state, pos, "end")) {
    return editor;
  }

  // Check if cursor is at end of current block and next sibling is a void block
  const blockIdx = pos.path[0];
  if (blockIdx < editor.state.children.length - 1) {
    const nextBlock = editor.state.children[blockIdx + 1];
    if (nextBlock && nextBlock.children.length === 0) {
      // Verify cursor is at end of the current block
      const currentBlock = editor.state.children[blockIdx];
      const lastText = findLastTextDescendant(currentBlock, [blockIdx]);
      if (lastText) {
        const textLen = getTextContentLength(lastText.node);
        const pathMatch = pos.path.length === lastText.path.length &&
          pos.path.every((v, i) => v === lastText.path[i]);
        if (pathMatch && pos.offset === textLen) {
          // Remove the void block
          const docChildren = [...editor.state.children];
          docChildren.splice(blockIdx + 1, 1);
          const newDoc = createNode(
            editor.state.id,
            editor.state.type,
            { ...editor.state.properties },
            docChildren,
          );
          const newSelection = createCursor(pos.path, pos.offset);

          return rebuildTrees(
            {
              ...editor,
              state: newDoc,
              selection: newSelection,
              history: pushEditorChange(editor.history, {
                change: { oldState: editor.state, newState: newDoc, timestamp: 0 },
                selectionBefore: editor.selection,
                selectionAfter: newSelection,
              }),
            },
            editor,
            config,
          );
        }
      }
    }
  }

  // Use moveByCharacter to find the next position (handles all nesting)
  const nextSel = moveByCharacter(editor.state, pos, "forward");
  const nextPos = nextSel.focus;

  // If we didn't move (at end of document), nothing to delete
  if (positionsEqual(nextPos, pos)) {
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
