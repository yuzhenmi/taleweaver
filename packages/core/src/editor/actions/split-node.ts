import type { EditorState, EditorConfig } from "../editor-state";
import { pushEditorChange } from "../editor-state";
import { createCursor, isCollapsed } from "../../cursor/selection";
import { splitNode } from "../../state/transformations";
import { createNode, createTextNode } from "../../state/create-node";
import { getNodeByPath, updateAtPath } from "../../state/operations";
import { getTextContentLength } from "../../state/text-utils";
import { rebuildTrees, deleteSelectionRange, findFirstTextDescendant } from "./helpers";

export function handleSplitNode(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  // If selection is expanded, delete selection first
  let current = editor;
  if (!isCollapsed(editor.selection)) {
    current = deleteSelectionRange(editor, config);
  }

  const pos = current.selection.focus;
  const paraIdx = pos.path[0];
  const block = current.state.children[paraIdx];

  // Special handling: enter on list item
  if (block.type === "list" && pos.path.length >= 3) {
    return handleSplitListItem(current, editor, config);
  }

  // Special handling: enter inside table cell
  if (block.type === "table" && pos.path.length >= 5) {
    return handleSplitTableCell(current, editor, config);
  }

  const nodeId = `node-${current.nextId}`;
  const change = splitNode(current.state, pos, nodeId, 0);

  // Special handling: enter on heading → new paragraph (convert the new block)
  let newState = change.newState;
  if (block.type === "heading") {
    const newBlock = newState.children[paraIdx + 1];
    const converted = createNode(
      newBlock.id,
      "paragraph",
      {},
      newBlock.children,
    );
    newState = updateAtPath(newState, [paraIdx + 1], converted);
  }

  // Find the first text node in the new block for cursor placement
  const newBlock = newState.children[paraIdx + 1];
  const firstText = findFirstTextDescendant(newBlock, [paraIdx + 1]);
  const newSelection = firstText
    ? createCursor(firstText.path, 0)
    : createCursor([paraIdx + 1, 0], 0);

  return rebuildTrees(
    {
      ...current,
      state: newState,
      selection: newSelection,
      history: pushEditorChange(current.history, {
        change: { oldState: current.state, newState, timestamp: 0 },
        selectionBefore: editor.selection,
        selectionAfter: newSelection,
      }),
      nextId: current.nextId + 1,
    },
    current,
    config,
  );
}

function handleSplitListItem(
  current: EditorState,
  originalEditor: EditorState,
  config: EditorConfig,
): EditorState {
  const pos = current.selection.focus;
  const listIdx = pos.path[0];
  const itemIdx = pos.path[1];
  const list = current.state.children[listIdx];
  const item = list.children[itemIdx];

  // Check if current list item is empty (enter on empty → exit list)
  const textNode = getNodeByPath(current.state, pos.path);
  if (textNode && getTextContentLength(textNode) === 0 && item.children.length === 1) {
    // Remove the empty item from the list
    const newListChildren = [...list.children];
    newListChildren.splice(itemIdx, 1);

    // Create a new paragraph after the list
    const newPara = createNode(
      `node-${current.nextId}-para`,
      "paragraph",
      {},
      [createTextNode(`node-${current.nextId}-text`, "")],
    );

    const docChildren = [...current.state.children];

    if (newListChildren.length === 0) {
      // Empty list — replace with paragraph
      docChildren[listIdx] = newPara;
    } else {
      // Update list and insert paragraph after
      const newList = createNode(list.id, list.type, { ...list.properties }, newListChildren);
      docChildren[listIdx] = newList;
      docChildren.splice(listIdx + 1, 0, newPara);
    }

    const newDoc = createNode(
      current.state.id,
      current.state.type,
      { ...current.state.properties },
      docChildren,
    );

    const newParaIdx = newListChildren.length === 0 ? listIdx : listIdx + 1;
    const newSelection = createCursor([newParaIdx, 0], 0);

    return rebuildTrees(
      {
        ...current,
        state: newDoc,
        selection: newSelection,
        history: pushEditorChange(current.history, {
          change: { oldState: current.state, newState: newDoc, timestamp: 0 },
          selectionBefore: originalEditor.selection,
          selectionAfter: newSelection,
        }),
        nextId: current.nextId + 1,
      },
      current,
      config,
    );
  }

  // Normal split: create a new list item
  const nodeId = `node-${current.nextId}`;

  // Split within the list item (splitDepth = 1 to split the list-item within the list)
  const change = splitNode(current.state, pos, nodeId, 1);

  // Find first text descendant in the new list item for cursor placement
  const newItem = change.newState.children[listIdx]?.children[itemIdx + 1];
  const firstText = newItem ? findFirstTextDescendant(newItem, [listIdx, itemIdx + 1]) : null;
  const newSelection = firstText
    ? createCursor(firstText.path, 0)
    : createCursor([listIdx, itemIdx + 1, 0], 0);

  return rebuildTrees(
    {
      ...current,
      state: change.newState,
      selection: newSelection,
      history: pushEditorChange(current.history, {
        change,
        selectionBefore: originalEditor.selection,
        selectionAfter: newSelection,
      }),
      nextId: current.nextId + 1,
    },
    current,
    config,
  );
}

function handleSplitTableCell(
  current: EditorState,
  originalEditor: EditorState,
  config: EditorConfig,
): EditorState {
  const pos = current.selection.focus;
  const tableIdx = pos.path[0];
  const rowIdx = pos.path[1];
  const cellIdx = pos.path[2];
  const paraIdx = pos.path[3];

  const nodeId = `node-${current.nextId}`;

  // Split within the cell: splitDepth = 3 splits the paragraph within the cell
  const change = splitNode(current.state, pos, nodeId, 3);

  // Cursor → first text in the new paragraph within the same cell
  const newCell = change.newState.children[tableIdx]?.children[rowIdx]?.children[cellIdx];
  const newPara = newCell?.children[paraIdx + 1];
  const firstText = newPara
    ? findFirstTextDescendant(newPara, [tableIdx, rowIdx, cellIdx, paraIdx + 1])
    : null;
  const newSelection = firstText
    ? createCursor(firstText.path, 0)
    : createCursor([tableIdx, rowIdx, cellIdx, paraIdx + 1, 0], 0);

  return rebuildTrees(
    {
      ...current,
      state: change.newState,
      selection: newSelection,
      history: pushEditorChange(current.history, {
        change,
        selectionBefore: originalEditor.selection,
        selectionAfter: newSelection,
      }),
      nextId: current.nextId + 1,
    },
    current,
    config,
  );
}
