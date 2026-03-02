import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { createCursor, isCollapsed } from "../../cursor/selection";
import { createPosition, createSpan, positionsEqual } from "../../state/position";
import { deleteRange } from "../../state/transformations";
import { moveByCharacter } from "../../cursor/cursor-ops";
import { getNodeByPath } from "../../state/operations";
import { getTextContentLength } from "../../state/text-utils";
import { createNode } from "../../state/create-node";
import { rebuildTrees, deleteSelectionRange, findFirstTextDescendant, isAtCellBoundary } from "./helpers";

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

  // At start of a table cell — prevent cross-cell merge
  if (isAtCellBoundary(editor.state, pos, "start")) {
    return editor;
  }

  // At start of a block (offset 0), check if previous sibling is a void block
  if (pos.offset === 0 && pos.path[0] > 0) {
    const prevIdx = pos.path[0] - 1;
    const prevBlock = editor.state.children[prevIdx];
    if (prevBlock && prevBlock.children.length === 0) {
      // Remove the void block
      const docChildren = [...editor.state.children];
      docChildren.splice(prevIdx, 1);
      const newDoc = createNode(
        editor.state.id,
        editor.state.type,
        { ...editor.state.properties },
        docChildren,
      );

      // Adjust cursor path: the current block moved up by 1
      const newBlockIdx = pos.path[0] - 1;
      const currentBlock = newDoc.children[newBlockIdx];
      const firstText = currentBlock ? findFirstTextDescendant(currentBlock, [newBlockIdx]) : null;
      const newSelection = firstText
        ? createCursor(firstText.path, 0)
        : createCursor([newBlockIdx, 0], 0);

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
  if (positionsEqual(prevPos, pos)) {
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
